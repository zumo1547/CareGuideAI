"use client";

import type { IScannerControls } from "@zxing/browser";
import { Camera, CheckCircle2, Loader2, ScanLine, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  computeScanGuidance,
  guidanceToThaiSpeech,
  type DetectionFrame,
} from "@/lib/scan/guidance";
import { speakThai, stopThaiSpeech, warmupSpeechSynthesis } from "@/lib/voice/speak";
import type { ScanGuidanceState } from "@/types/domain";

interface ScanResponse {
  guidance: ScanGuidanceState;
  scannedBarcode?: string;
  barcodeDetected?: boolean;
  matchStatus?: "matched" | "detected_only";
  foundMedicine: boolean;
  medicine?: {
    id: string;
    name: string;
    strength: string | null;
  };
}

type MealTiming = "before_meal" | "after_meal" | "unspecified";
type DayPeriod = "morning" | "noon" | "evening" | "night";

interface ParsedMedicationDetails {
  medicineQuery: string;
  medicineNameEn: string | null;
  medicineNameTh: string | null;
  dosageText: string;
  quantityPerDose: string | null;
  frequencyPerDay: number | null;
  mealTiming: MealTiming;
  periods: DayPeriod[];
  customTimes: string[];
  confidence: number;
  rawText: string;
}

interface OcrResponse {
  guidance: ScanGuidanceState;
  foundMedicine: boolean;
  medicine?: {
    id: string;
    name: string;
    strength: string | null;
  };
  ocrText?: string;
  query?: string;
  parsedDetails?: ParsedMedicationDetails;
}

interface MedicationScannerProps {
  patientId: string;
}

type ScannerEngine = "barcode_detector" | "zxing";
type ZxingPointLike = { getX: () => number; getY: () => number };
type ZxingResultLike = {
  getText?: () => string;
  getResultPoints?: () => ZxingPointLike[];
};

type OcrBlockLike = {
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence?: number;
};

type OcrWorkerLike = {
  recognize: (
    image: HTMLCanvasElement | File | Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{
    data?: {
      text?: string;
      confidence?: number;
      blocks?: OcrBlockLike[] | null;
    };
  }>;
  setParameters?: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

const COOL_DOWN_MS = 2500;
const DETECT_INTERVAL_MS = 1000;
const SPEAK_COOLDOWN_MS = 1400;
const AUTO_OCR_INTERVAL_MS = 2800;
const OCR_MIN_TEXT_LENGTH = 12;
const OCR_SUCCESS_MIN_CONFIDENCE = 0.38;
const AUTO_FINALIZE_MIN_COMPLETION = 66;
const AUTO_FINALIZE_MIN_CONFIDENCE = 0.05;
const AUTO_FINALIZE_MIN_TEXT_LENGTH = 12;
const AUTO_FINALIZE_STABLE_FRAMES = 1;

interface ScanCandidate {
  text: string;
  previewDataUrl: string;
  completion: number;
  confidence: number;
}

const preferredVideoConstraints = (): MediaTrackConstraints => ({
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
});

const isValidCustomTime = (value: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
const normalizeComparableText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const periodToThai = (period: DayPeriod) => {
  switch (period) {
    case "morning":
      return "เช้า";
    case "noon":
      return "กลางวัน";
    case "evening":
      return "เย็น";
    case "night":
      return "ก่อนนอน";
    default:
      return period;
  }
};

const mealTimingToThai = (mealTiming: MealTiming) => {
  switch (mealTiming) {
    case "before_meal":
      return "ก่อนอาหาร";
    case "after_meal":
      return "หลังอาหาร";
    default:
      return "ไม่ระบุ";
  }
};

const buildDosageFromParsed = (details: ParsedMedicationDetails) => {
  const parts: string[] = [];
  if (details.quantityPerDose) {
    parts.push(`ครั้งละ ${details.quantityPerDose}`);
  }

  if (details.frequencyPerDay) {
    parts.push(`วันละ ${details.frequencyPerDay} ครั้ง`);
  }

  if (details.periods.length) {
    parts.push(`ช่วงเวลา ${details.periods.map(periodToThai).join(" / ")}`);
  }

  if (details.mealTiming !== "unspecified") {
    parts.push(mealTimingToThai(details.mealTiming));
  }

  return (parts.join(" ").trim() || details.dosageText || "ทานตามฉลากยา").slice(0, 250);
};

const scheduleFromParsed = (details: ParsedMedicationDetails) => {
  const presets = new Set<"morning" | "noon" | "evening">();
  const customTimes = new Set<string>();

  for (const period of details.periods) {
    if (period === "morning") presets.add("morning");
    if (period === "noon") presets.add("noon");
    if (period === "evening") presets.add("evening");
    if (period === "night") customTimes.add("21:00");
  }

  for (const time of details.customTimes) {
    if (isValidCustomTime(time)) {
      customTimes.add(time);
    }
  }

  if (!presets.size && !customTimes.size) {
    if (details.frequencyPerDay === 1) {
      presets.add("morning");
    } else if (details.frequencyPerDay === 2) {
      presets.add("morning");
      presets.add("evening");
    } else if ((details.frequencyPerDay ?? 0) >= 3) {
      presets.add("morning");
      presets.add("noon");
      presets.add("evening");
    } else {
      presets.add("morning");
      presets.add("evening");
    }
  }

  return {
    presets: [...presets],
    customTimes: [...customTimes].sort(),
  };
};

const extractFrameFromZxingResult = (
  result: ZxingResultLike | undefined,
  videoEl: HTMLVideoElement | null,
): DetectionFrame | undefined => {
  if (!result?.getResultPoints || !videoEl) {
    return undefined;
  }

  const points = result.getResultPoints();
  if (!points?.length) {
    return undefined;
  }

  const xs = points.map((point) => point.getX()).filter((value) => Number.isFinite(value));
  const ys = points.map((point) => point.getY()).filter((value) => Number.isFinite(value));
  if (!xs.length || !ys.length) {
    return undefined;
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  return {
    frameWidth: videoEl.videoWidth || 1,
    frameHeight: videoEl.videoHeight || 1,
    x: minX,
    y: minY,
    width,
    height,
  };
};

const extractFrameFromOcrBlocks = (
  blocks: OcrBlockLike[] | null | undefined,
  frameWidth: number,
  frameHeight: number,
): DetectionFrame | undefined => {
  if (!blocks?.length) {
    return undefined;
  }

  const usable = blocks.filter((block) => {
    const bbox = block.bbox;
    if (!bbox) return false;
    const width = bbox.x1 - bbox.x0;
    const height = bbox.y1 - bbox.y0;
    return width > 8 && height > 8;
  });

  if (!usable.length) {
    return undefined;
  }

  const minX = Math.min(...usable.map((block) => block.bbox?.x0 ?? 0));
  const minY = Math.min(...usable.map((block) => block.bbox?.y0 ?? 0));
  const maxX = Math.max(...usable.map((block) => block.bbox?.x1 ?? 0));
  const maxY = Math.max(...usable.map((block) => block.bbox?.y1 ?? 0));

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return {
    frameWidth: Math.max(1, frameWidth),
    frameHeight: Math.max(1, frameHeight),
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width,
    height,
  };
};

const createCanvasFromFile = (file: File) =>
  new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const maxWidth = 1400;
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(280, Math.floor(image.width * scale));
      canvas.height = Math.max(280, Math.floor(image.height * scale));

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("ไม่สามารถเตรียมภาพสำหรับ OCR ได้"));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas);
    };

    image.onerror = () => {
      reject(new Error("ไม่สามารถอ่านไฟล์รูปได้"));
    };

    image.src = URL.createObjectURL(file);
  });

export const MedicationScanner = ({ patientId }: MedicationScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const timerRef = useRef<number | null>(null);
  const autoOcrTimerRef = useRef<number | null>(null);
  const inflightDetectRef = useRef(false);
  const ocrBusyRef = useRef(false);
  const isScanningRef = useRef(false);
  const lastSpokenAtRef = useRef(0);
  const lastScannedAtRef = useRef(0);
  const lastGuidanceRef = useRef<ScanGuidanceState>("move_closer");
  const ocrWorkerRef = useRef<OcrWorkerLike | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resultSectionRef = useRef<HTMLDivElement | null>(null);
  const isFinalizingRef = useRef(false);
  const stableCandidateCountRef = useRef(0);
  const lastCandidateFingerprintRef = useRef("");
  const bestCandidateRef = useRef<ScanCandidate | null>(null);

  const [status, setStatus] = useState("พร้อมสแกน");
  const [guidance, setGuidance] = useState<ScanGuidanceState>("move_closer");
  const [manualBarcode, setManualBarcode] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResponse | OcrResponse | null>(null);
  const [lastDetectedBarcode, setLastDetectedBarcode] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [activeEngine, setActiveEngine] = useState<ScannerEngine | null>(null);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [scanCompletion, setScanCompletion] = useState(0);
  const [parsedDetails, setParsedDetails] = useState<ParsedMedicationDetails | null>(null);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [ocrPreviewDataUrl, setOcrPreviewDataUrl] = useState<string | null>(null);

  const isCameraSupported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBarcodeDetectorSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  const updateGuidance = useCallback(
    (nextGuidance: ScanGuidanceState, forceSpeak = false) => {
      setGuidance((previous) => (previous === nextGuidance ? previous : nextGuidance));

      if (!isScanningRef.current && !forceSpeak) {
        return;
      }

      if (!voiceEnabled) {
        return;
      }

      const now = Date.now();
      if (!forceSpeak && now - lastSpokenAtRef.current < SPEAK_COOLDOWN_MS) return;

      if (
        !forceSpeak &&
        lastGuidanceRef.current === nextGuidance &&
        now - lastSpokenAtRef.current < SPEAK_COOLDOWN_MS * 2
      ) {
        return;
      }

      lastSpokenAtRef.current = now;
      lastGuidanceRef.current = nextGuidance;
      speakThai(guidanceToThaiSpeech(nextGuidance), 1.02);
    },
    [voiceEnabled],
  );

  const stopAutoLabelLoop = useCallback(() => {
    if (autoOcrTimerRef.current !== null) {
      window.clearTimeout(autoOcrTimerRef.current);
      autoOcrTimerRef.current = null;
    }
  }, []);

  const moveToConfirmationSection = useCallback(() => {
    window.requestAnimationFrame(() => {
      resultSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      window.setTimeout(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      }, 240);
    });
  }, []);

  const stopScanner = useCallback(() => {
    isScanningRef.current = false;
    stopThaiSpeech();

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    stopAutoLabelLoop();
    inflightDetectRef.current = false;
    detectorRef.current = null;

    if (zxingControlsRef.current) {
      zxingControlsRef.current.stop();
      zxingControlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopAutoLabelLoop]);

  const resetAutoScanState = useCallback(() => {
    isFinalizingRef.current = false;
    stableCandidateCountRef.current = 0;
    lastCandidateFingerprintRef.current = "";
    bestCandidateRef.current = null;
  }, []);

  const ensureOcrWorker = useCallback(async () => {
    if (ocrWorkerRef.current) {
      return ocrWorkerRef.current;
    }

    const { createWorker } = await import("tesseract.js");
    const worker = (await createWorker(["tha", "eng"], 1, {
      logger: (message: { status?: string; progress?: number }) => {
        if (message?.status === "recognizing text" && typeof message.progress === "number") {
          setOcrProgress(Math.round(message.progress * 100));
        }
      },
    })) as unknown as OcrWorkerLike;

    await worker.setParameters?.({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
    });

    ocrWorkerRef.current = worker;
    return worker;
  }, []);

  const terminateOcrWorker = useCallback(async () => {
    const worker = ocrWorkerRef.current;
    if (!worker) return;
    ocrWorkerRef.current = null;
    await worker.terminate().catch(() => undefined);
  }, []);

  const callBarcodeApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch("/api/scan/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, ...payload }),
      });

      const result = (await response.json()) as ScanResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "สแกนบาร์โค้ดไม่สำเร็จ");
      }

      updateGuidance(result.guidance);
      setScanResult(result);
      setParsedDetails(null);
      setPlanError(null);
      setPlanSuccess(null);

      return result;
    },
    [patientId, updateGuidance],
  );

  const submitScannedBarcode = useCallback(
    async (barcode: string, frame?: DetectionFrame) => {
      const now = Date.now();
      if (now - lastScannedAtRef.current < COOL_DOWN_MS) return;
      lastScannedAtRef.current = now;

      try {
        updateGuidance("hold_steady");
        const result = await callBarcodeApi({
          barcode,
          frame,
        });

        const detectedCode = result.scannedBarcode ?? barcode;
        setLastDetectedBarcode(detectedCode);

        if (result.foundMedicine && result.medicine?.name) {
          setStatus(`สแกนสำเร็จ: ${result.medicine.name}`);
          if (voiceEnabled) {
            speakThai(`ยืนยันผลสแกนแล้ว พบยา ${result.medicine.name}`);
          }
          return;
        }

        setStatus(`อ่านบาร์โค้ดได้แล้ว: ${detectedCode} (ยังไม่พบชื่อยาในฐานข้อมูล)`);
        if (voiceEnabled) {
          speakThai(`สแกนสำเร็จ อ่านบาร์โค้ดได้แล้ว ${detectedCode}`);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "สแกนไม่สำเร็จ");
      }
    },
    [callBarcodeApi, updateGuidance, voiceEnabled],
  );

  const captureFrameForOcr = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    const sourceWidth = video.videoWidth || 0;
    const sourceHeight = video.videoHeight || 0;
    if (!sourceWidth || !sourceHeight) {
      return null;
    }

    const cropWidth = Math.floor(sourceWidth * 0.84);
    const cropHeight = Math.floor(sourceHeight * 0.7);
    const cropX = Math.floor((sourceWidth - cropWidth) / 2);
    const cropY = Math.floor((sourceHeight - cropHeight) / 2);

    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / cropWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(320, Math.floor(cropWidth * scale));
    canvas.height = Math.max(260, Math.floor(cropHeight * scale));

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return {
      canvas,
      previewDataUrl: canvas.toDataURL("image/jpeg", 0.9),
    };
  }, []);

  const recognizeLabelImage = useCallback(
    async (image: HTMLCanvasElement | File | Blob) => {
      const worker = await ensureOcrWorker();
      const result = await worker.recognize(image, {}, { blocks: true });
      const text = String(result?.data?.text ?? "")
        .replace(/\r/g, "")
        .trim();
      const confidenceRaw = Number(result?.data?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw / 100))
        : 0;

      return {
        text,
        confidence,
        blocks: result?.data?.blocks ?? [],
      };
    },
    [ensureOcrWorker],
  );

  const submitOcrText = useCallback(
    async (text: string, speakResult = true) => {
      const response = await fetch("/api/scan/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          extractedText: text,
        }),
      });

      const result = (await response.json()) as OcrResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "วิเคราะห์ OCR ไม่สำเร็จ");
      }

      updateGuidance(result.guidance);
      setScanResult(result);
      setParsedDetails(result.parsedDetails ?? null);
      setOcrText(result.ocrText ?? text);
      setPlanError(null);
      setPlanSuccess(null);

      if (result.foundMedicine && result.medicine?.name) {
        setStatus(`จับคู่ยาได้แล้ว: ${result.medicine.name}`);
        if (voiceEnabled && speakResult) {
          speakThai(`พบข้อมูลยา ${result.medicine.name} กรุณาตรวจสอบแล้วกดยืนยัน`);
        }
      } else {
        setStatus("อ่านฉลากได้แล้ว กรุณาตรวจสอบข้อมูลและกดยืนยัน");
        if (voiceEnabled && speakResult) {
          speakThai("อ่านฉลากได้แล้ว กรุณาตรวจสอบข้อมูลแล้วกดยืนยัน");
        }
      }

      return result;
    },
    [patientId, updateGuidance, voiceEnabled],
  );

  const finalizeScanAndAnalyze = useCallback(
    async (candidate: ScanCandidate) => {
      if (isFinalizingRef.current) return;

      isFinalizingRef.current = true;
      setScanCompletion(100);
      setStatus("สแกนเสร็จสิ้น กำลังหยุดกล้องและวิเคราะห์อัตโนมัติ");
      stopScanner();
      setIsScanning(false);
      setOcrText(candidate.text);
      setOcrPreviewDataUrl(candidate.previewDataUrl);

      if (voiceEnabled) {
        speakThai("สแกนเสร็จสิ้น ถ้าต้องการเริ่มใหม่ให้กดสแกนใหม่");
      }

      try {
        await submitOcrText(candidate.text, false);
        setStatus("วิเคราะห์อัตโนมัติเสร็จแล้ว เลื่อนลงเพื่อกดยืนยันได้เลย");
        moveToConfirmationSection();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "วิเคราะห์อัตโนมัติไม่สำเร็จ");
        isFinalizingRef.current = false;
      }
    },
    [moveToConfirmationSection, stopScanner, submitOcrText, voiceEnabled],
  );

  const scanManualBarcode = async () => {
    if (!manualBarcode.trim()) return;

    setLoading(true);
    setStatus("กำลังตรวจสอบบาร์โค้ด...");

    try {
      await submitScannedBarcode(manualBarcode.trim());
    } finally {
      setLoading(false);
    }
  };

  const scanFromUploadedImage = async (file: File) => {
    if (ocrBusyRef.current) return;

    ocrBusyRef.current = true;
    setIsOcrLoading(true);
    setOcrProgress(0);
    setStatus("กำลังอ่านรูปฉลากยา...");
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const canvas = await createCanvasFromFile(file);
      setOcrPreviewDataUrl(canvas.toDataURL("image/jpeg", 0.9));

      const ocr = await recognizeLabelImage(canvas);
      const frame = extractFrameFromOcrBlocks(ocr.blocks, canvas.width, canvas.height);
      const nextGuidance = frame ? computeScanGuidance(frame) : "move_closer";
      updateGuidance(nextGuidance);

      if (!ocr.text || ocr.text.length < OCR_MIN_TEXT_LENGTH) {
        setStatus("อ่านข้อความจากรูปยังไม่ครบ ลองอัปโหลดรูปที่ชัดขึ้น");
        return;
      }

      setOcrText(ocr.text);
      await submitOcrText(ocr.text, false);
      setStatus("อ่านฉลากจากรูปเสร็จแล้ว กรุณาตรวจสอบข้อมูลและกดยืนยัน");
      if (voiceEnabled) {
        speakThai("อ่านฉลากจากรูปสำเร็จ กรุณากดยืนยัน");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "อ่านรูปฉลากไม่สำเร็จ");
    } finally {
      setIsOcrLoading(false);
      setOcrProgress(null);
      ocrBusyRef.current = false;
    }
  };

  const confirmAndCreateMedicationPlan = useCallback(async () => {
    if (!parsedDetails) {
      setPlanError("ยังไม่มีผล OCR สำหรับยืนยัน กรุณาสแกนฉลากยาก่อน");
      return;
    }

    const medicineQuery =
      parsedDetails.medicineQuery.trim() ||
      parsedDetails.medicineNameEn?.trim() ||
      parsedDetails.medicineNameTh?.trim() ||
      (scanResult?.medicine?.name ?? "").trim();

    if (!medicineQuery) {
      setPlanError("ไม่พบชื่อยาที่ใช้งานได้ กรุณาลองสแกนใหม่");
      return;
    }

    const dosage = buildDosageFromParsed(parsedDetails);
    const schedule = scheduleFromParsed(parsedDetails);

    setIsCreatingPlan(true);
    setPlanError(null);
    setPlanSuccess(null);

    try {
      const response = await fetch("/api/medication-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          medicineQuery,
          selectedSourceId: scanResult?.medicine?.id ?? undefined,
          dosage,
          notes:
            parsedDetails.dosageText?.trim() || `OCR confidence: ${(parsedDetails.confidence * 100).toFixed(0)}%`,
          schedule,
        }),
      });

      const payload = (await response.json()) as { error?: string; planId?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "ยืนยันและสร้างแผนยาไม่สำเร็จ");
      }

      setPlanSuccess("ยืนยันผลสแกนแล้ว และสร้างตารางยา/แจ้งเตือน SMS สำเร็จ");
      setStatus("บันทึกแผนยาเรียบร้อยแล้ว");
      if (voiceEnabled) {
        speakThai("บันทึกแผนยาเรียบร้อยแล้ว ระบบเตือนพร้อมใช้งาน");
      }
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "ยืนยันผลไม่สำเร็จ");
    } finally {
      setIsCreatingPlan(false);
    }
  }, [parsedDetails, patientId, scanResult, voiceEnabled]);

  useEffect(() => {
    if (!isScanning || !isCameraSupported) {
      return;
    }

    let cancelled = false;

    const startWithBarcodeDetector = async () => {
      if (!videoRef.current) return;

      const openStream = async () => {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: preferredVideoConstraints(),
            audio: false,
          });
        } catch {
          return navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      };

      const stream = await openStream();
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const Detector = window.BarcodeDetector;
      if (!Detector) {
        throw new Error("BarcodeDetector ไม่พร้อมใช้งาน");
      }

      detectorRef.current = new Detector({
        formats: ["qr_code", "ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });

      const scheduleNextDetection = () => {
        if (cancelled) return;
        timerRef.current = window.setTimeout(() => {
          void detectLoop();
        }, DETECT_INTERVAL_MS);
      };

      const detectLoop = async () => {
        if (
          cancelled ||
          inflightDetectRef.current ||
          !detectorRef.current ||
          !videoRef.current ||
          videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          scheduleNextDetection();
          return;
        }

        inflightDetectRef.current = true;

        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);

          if (!barcodes.length) {
            updateGuidance("move_closer");
            return;
          }

          const current = barcodes[0];
          if (!current.rawValue || !current.boundingBox) {
            return;
          }

          const frame: DetectionFrame = {
            frameWidth: videoRef.current.videoWidth || 1,
            frameHeight: videoRef.current.videoHeight || 1,
            x: current.boundingBox.x,
            y: current.boundingBox.y,
            width: current.boundingBox.width,
            height: current.boundingBox.height,
          };

          await submitScannedBarcode(current.rawValue, frame);
        } catch {
          setStatus("กำลังอ่านภาพจากกล้อง...");
        } finally {
          inflightDetectRef.current = false;
          scheduleNextDetection();
        }
      };

      setStatus("พร้อมสแกนแบบกล้อง");
      scheduleNextDetection();
    };

    const startWithZxing = async () => {
      if (!videoRef.current) return;

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: DETECT_INTERVAL_MS,
        delayBetweenScanSuccess: DETECT_INTERVAL_MS,
      });

      const callback = (result: unknown) => {
        if (!isScanningRef.current) return;

        const decoded = result as ZxingResultLike | undefined;
        const value = decoded?.getText?.();
        if (!value) {
          updateGuidance("move_closer");
          return;
        }

        const frame = extractFrameFromZxingResult(decoded, videoRef.current);
        void submitScannedBarcode(value, frame);
      };

      let controls: IScannerControls;
      try {
        controls = await reader.decodeFromConstraints(
          {
            video: preferredVideoConstraints(),
            audio: false,
          },
          videoRef.current,
          (result) => callback(result),
        );
      } catch {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) =>
          callback(result),
        );
      }

      if (cancelled) {
        controls.stop();
        return;
      }

      zxingControlsRef.current = controls;
      setStatus("พร้อมสแกนแบบกล้อง (ZXing)");
    };

    const startScanner = async () => {
      setIsStartingCamera(true);

      const engine: ScannerEngine = isBarcodeDetectorSupported ? "barcode_detector" : "zxing";
      setActiveEngine(engine);

      try {
        if (engine === "barcode_detector") {
          await startWithBarcodeDetector();
        } else {
          await startWithZxing();
        }
      } catch {
        setStatus("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตสิทธิ์กล้อง");
        setIsScanning(false);
      } finally {
        if (!cancelled) {
          setIsStartingCamera(false);
        }
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopScanner();
      setActiveEngine(null);
    };
  }, [
    isBarcodeDetectorSupported,
    isCameraSupported,
    isScanning,
    stopScanner,
    submitScannedBarcode,
    updateGuidance,
  ]);

  useEffect(() => {
    if (!isScanning) {
      return;
    }

    let cancelled = false;

    const scheduleNext = (delay = AUTO_OCR_INTERVAL_MS) => {
      if (cancelled) return;
      autoOcrTimerRef.current = window.setTimeout(() => {
        void runLoop();
      }, delay);
    };

    const runLoop = async () => {
      if (cancelled || ocrBusyRef.current) {
        scheduleNext(1200);
        return;
      }

      const capture = captureFrameForOcr();
      if (!capture) {
        updateGuidance("move_closer");
        scheduleNext(1200);
        return;
      }

      ocrBusyRef.current = true;
      setIsOcrLoading(true);
      setOcrProgress(0);
      setOcrPreviewDataUrl(capture.previewDataUrl);

      try {
        const ocr = await recognizeLabelImage(capture.canvas);
        const frame = extractFrameFromOcrBlocks(ocr.blocks, capture.canvas.width, capture.canvas.height);
        const nextGuidance = frame ? computeScanGuidance(frame) : "move_closer";
        updateGuidance(nextGuidance);

        const normalizedText = ocr.text.trim();
        let completion = 0;
        completion += nextGuidance === "hold_steady" ? 45 : 20;
        completion += Math.min(25, Math.round((Math.min(normalizedText.length, 90) / 90) * 25));
        completion += Math.min(30, Math.round((Math.min(ocr.confidence, 1) / 1) * 30));
        const boundedCompletion = Math.min(99, completion);
        setScanCompletion((previous) => {
          const smoothed = Math.round(previous * 0.5 + boundedCompletion * 0.5);
          return Math.max(previous > 85 ? previous - 1 : 0, smoothed);
        });

        const currentCandidate: ScanCandidate = {
          text: normalizedText,
          previewDataUrl: capture.previewDataUrl,
          completion: boundedCompletion,
          confidence: ocr.confidence,
        };

        const best = bestCandidateRef.current;
        if (
          !best ||
          currentCandidate.completion > best.completion + 3 ||
          (currentCandidate.completion >= best.completion - 2 &&
            currentCandidate.confidence > best.confidence + 0.03)
        ) {
          bestCandidateRef.current = currentCandidate;
        }

        const canAutoFinalize =
          normalizedText.length >= AUTO_FINALIZE_MIN_TEXT_LENGTH &&
          ocr.confidence >= AUTO_FINALIZE_MIN_CONFIDENCE &&
          boundedCompletion >= AUTO_FINALIZE_MIN_COMPLETION;

        if (canAutoFinalize) {
          const fingerprint = normalizeComparableText(normalizedText).slice(0, 180);
          if (fingerprint && fingerprint === lastCandidateFingerprintRef.current) {
            stableCandidateCountRef.current += 1;
          } else {
            stableCandidateCountRef.current = 1;
            lastCandidateFingerprintRef.current = fingerprint;
          }
        } else {
          stableCandidateCountRef.current = 0;
          lastCandidateFingerprintRef.current = "";
        }

        if (
          (nextGuidance === "hold_steady" &&
            normalizedText.length >= OCR_MIN_TEXT_LENGTH &&
            ocr.confidence >= OCR_SUCCESS_MIN_CONFIDENCE) ||
          stableCandidateCountRef.current >= AUTO_FINALIZE_STABLE_FRAMES
        ) {
          const finalCandidate = bestCandidateRef.current ?? currentCandidate;
          void finalizeScanAndAnalyze(finalCandidate);
          return;
        }

        if (normalizedText.length < OCR_MIN_TEXT_LENGTH) {
          setStatus("กำลังหาโฟกัสฉลากยา... จัดฉลากให้อยู่กลางกรอบและใกล้อีกนิด");
        } else {
          setStatus("อ่านข้อความบางส่วนได้แล้ว ขยับเล็กน้อยและค้างกล้องไว้");
        }
      } catch {
        setStatus("OCR อัตโนมัติยังอ่านไม่ชัด ลองปรับแสงหรือมุมกล้อง");
      } finally {
        ocrBusyRef.current = false;
        setIsOcrLoading(false);
        setOcrProgress(null);
        if (!cancelled && isScanningRef.current) {
          scheduleNext();
        }
      }
    };

    scheduleNext(500);

    return () => {
      cancelled = true;
      if (autoOcrTimerRef.current !== null) {
        window.clearTimeout(autoOcrTimerRef.current);
        autoOcrTimerRef.current = null;
      }
    };
  }, [
    captureFrameForOcr,
    finalizeScanAndAnalyze,
    isScanning,
    recognizeLabelImage,
    updateGuidance,
  ]);

  useEffect(() => {
    if (!isScanning) {
      return;
    }

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      setStatus("หยุดสแกนชั่วคราวเมื่อออกจากหน้าจอ");
      setIsScanning(false);
      resetAutoScanState();
      stopScanner();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isScanning, resetAutoScanState, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
      resetAutoScanState();
      void terminateOcrWorker();
    };
  }, [resetAutoScanState, stopScanner, terminateOcrWorker]);

  const guidanceLabel = useMemo(() => guidanceToThaiSpeech(guidance), [guidance]);

  const resolvedStatus = useMemo(() => {
    if (!isCameraSupported) {
      return "อุปกรณ์นี้ไม่รองรับการเปิดกล้องผ่านเบราว์เซอร์";
    }

    if (activeEngine === "zxing" && isScanning) {
      return `${status} (โหมดรองรับมือถือ)`;
    }

    return status;
  }, [activeEngine, isCameraSupported, isScanning, status]);

  const parsedPeriodsLabel =
    parsedDetails?.periods.length ? parsedDetails.periods.map(periodToThai).join(", ") : "-";

  const parsedMealLabel = parsedDetails ? mealTimingToThai(parsedDetails.mealTiming) : "-";

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="h-5 w-5" />
          สแกนฉลากยาและบาร์โค้ดแบบใช้งานจริง
        </CardTitle>
        <CardDescription>
          รองรับการอ่านฉลากยาไทย/อังกฤษจากกล้องโดยไม่ต้องพึ่งบาร์โค้ด พร้อมเสียงนำทางและยืนยันเพื่อสร้างเตือน SMS
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>สถานะสแกน</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{resolvedStatus}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{guidanceLabel}</Badge>
              {isOcrLoading ? <Badge variant="outline">OCR กำลังทำงาน</Badge> : null}
              {ocrProgress !== null ? <Badge variant="outline">{ocrProgress}%</Badge> : null}
              {isScanning ? <Badge>โหมดสแกนฉลากอัตโนมัติ</Badge> : null}
              {isScanning || scanCompletion > 0 ? (
                <Badge variant={scanCompletion === 100 ? "default" : "outline"}>
                  ความครบถ้วน {scanCompletion}%
                </Badge>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>

        {isCameraSupported ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  resetAutoScanState();
                  setScanResult(null);
                  setParsedDetails(null);
                  setPlanError(null);
                  setPlanSuccess(null);
                  setLastDetectedBarcode(null);
                  setScanCompletion(0);
                  setStatus("กำลังเตรียมกล้องและเริ่มสแกนอัตโนมัติ...");
                  isScanningRef.current = true;
                  warmupSpeechSynthesis();
                  updateGuidance("move_closer", true);
                  if (voiceEnabled) {
                    speakThai("เริ่มสแกนอัตโนมัติแล้ว กรุณาหันกล้องไปที่ฉลากยา");
                  }
                  setIsScanning(true);
                }}
                disabled={isScanning || isStartingCamera}
              >
                {isStartingCamera ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                <span>{isStartingCamera ? "กำลังเปิดกล้อง" : "เริ่มสแกนด้วยกล้อง"}</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  resetAutoScanState();
                  stopScanner();
                  setScanCompletion(0);
                  setStatus("หยุดการสแกนแล้ว");
                  setIsScanning(false);
                }}
                disabled={!isScanning}
              >
                หยุดสแกน
              </Button>

              <Button
                variant={voiceEnabled ? "secondary" : "outline"}
                onClick={() => {
                  setVoiceEnabled((previous) => {
                    const next = !previous;
                    if (next) {
                      warmupSpeechSynthesis();
                      speakThai("เปิดเสียงนำทางแล้ว");
                    }
                    return next;
                  });
                }}
              >
                {voiceEnabled ? "ปิดเสียงนำทาง" : "เปิดเสียงนำทาง"}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  warmupSpeechSynthesis();
                  speakThai("ทดสอบเสียงนำทาง หากได้ยินแปลว่าเสียงพร้อมใช้งาน");
                }}
              >
                ทดสอบเสียง
              </Button>
            </div>

            {isScanning ? (
              <div className="relative overflow-hidden rounded-xl border bg-black">
                <video ref={videoRef} className="h-72 w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-[68%] w-[84%] rounded-2xl border-2 border-cyan-300/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]" />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
                <Camera className="mx-auto mb-2 h-6 w-6" />
                แนะนำให้กดปุ่ม &quot;เริ่มสแกนด้วยกล้อง&quot; เฉพาะตอนต้องการใช้งาน
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
            <Camera className="mx-auto mb-2 h-6 w-6" />
            โหมดกล้องไม่พร้อมใช้งานในเบราว์เซอร์นี้
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="manualBarcode">กรอกบาร์โค้ดด้วยตนเอง</Label>
            <Input
              id="manualBarcode"
              value={manualBarcode}
              onChange={(event) => setManualBarcode(event.target.value)}
              placeholder="เช่น 4901777300442"
            />
            <Button onClick={scanManualBarcode} disabled={loading || !manualBarcode.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span>ตรวจสอบบาร์โค้ด</span>
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ocrUpload">อัปโหลดรูปซองยา / ฉลากยา</Label>
            <Input
              ref={fileInputRef}
              id="ocrUpload"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void scanFromUploadedImage(file);
                }
                event.currentTarget.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              รองรับถ่ายจากมือถือหรือเลือกรูปที่มีฉลากยาชัดเจน
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ocrText">ข้อความ OCR (วิเคราะห์อัตโนมัติแล้ว)</Label>
          <Textarea
            id="ocrText"
            value={ocrText}
            readOnly
            placeholder="เมื่อสแกนเกิน 65% ระบบจะหยุดและเติมข้อความ OCR อัตโนมัติ"
            rows={5}
          />
          <p className="text-xs text-muted-foreground">
            ไม่ต้องกดวิเคราะห์เอง ระบบจะหยุดสแกนและวิเคราะห์ให้อัตโนมัติทันทีเมื่อสแกนเกิน 65%
          </p>
        </div>

        {lastDetectedBarcode && !scanResult?.medicine ? (
          <Alert>
            <AlertTitle>ยืนยันการสแกนบาร์โค้ดแล้ว</AlertTitle>
            <AlertDescription>
              อ่านบาร์โค้ดได้: <strong>{lastDetectedBarcode}</strong> แต่ยังไม่พบชื่อยาในฐานข้อมูล
            </AlertDescription>
          </Alert>
        ) : null}

        {scanResult?.medicine ? (
          <Alert>
            <AlertTitle>ผลการจับคู่ยา</AlertTitle>
            <AlertDescription>
              พบยา <strong>{scanResult.medicine.name}</strong>{" "}
              {scanResult.medicine.strength ? `(${scanResult.medicine.strength})` : ""}
            </AlertDescription>
          </Alert>
        ) : null}

        {ocrPreviewDataUrl ? (
          <div className="space-y-2">
            <Label>ภาพล่าสุดที่ใช้วิเคราะห์ OCR</Label>
            <div className="overflow-hidden rounded-xl border bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ocrPreviewDataUrl} alt="OCR preview" className="h-auto w-full object-contain" />
            </div>
          </div>
        ) : null}

        <div ref={resultSectionRef} className="scroll-mt-24">
          {parsedDetails ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">ผลอ่านฉลากยา (AI OCR)</CardTitle>
                <CardDescription>
                  ตรวจสอบข้อมูลก่อนกดยืนยันเพื่อสร้างแผนยาและแจ้งเตือน SMS
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="grid gap-2 md:grid-cols-2">
                  <p>
                    <span className="text-muted-foreground">ชื่อยา (EN): </span>
                    <strong>{parsedDetails.medicineNameEn || "-"}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ชื่อยา (TH): </span>
                    <strong>{parsedDetails.medicineNameTh || "-"}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">คำค้นยา: </span>
                    <strong>{parsedDetails.medicineQuery || "-"}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ความมั่นใจ OCR: </span>
                    <strong>{Math.round(parsedDetails.confidence * 100)}%</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">จำนวนต่อครั้ง: </span>
                    <strong>{parsedDetails.quantityPerDose || "-"}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ความถี่ต่อวัน: </span>
                    <strong>
                      {parsedDetails.frequencyPerDay ? `${parsedDetails.frequencyPerDay} ครั้ง` : "-"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ช่วงเวลา: </span>
                    <strong>{parsedPeriodsLabel}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ก่อน/หลังอาหาร: </span>
                    <strong>{parsedMealLabel}</strong>
                  </p>
                </div>
                <p>
                  <span className="text-muted-foreground">เวลาที่อ่านได้: </span>
                  <strong>{parsedDetails.customTimes.length ? parsedDetails.customTimes.join(", ") : "-"}</strong>
                </p>
                <p className="rounded-md bg-muted/40 p-2 text-sm">
                  <span className="text-muted-foreground">สรุปการใช้ยา: </span>
                  {buildDosageFromParsed(parsedDetails)}
                </p>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button onClick={() => void confirmAndCreateMedicationPlan()} disabled={isCreatingPlan}>
                    {isCreatingPlan ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    ยืนยันผลและสร้างแผนยา + แจ้งเตือน SMS
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    disabled={isCreatingPlan || isOcrLoading}
                  >
                    <Upload className="h-4 w-4" />
                    อัปโหลดรูปใหม่
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {planError ? (
          <Alert variant="destructive">
            <AlertTitle>ยืนยันผลไม่สำเร็จ</AlertTitle>
            <AlertDescription>{planError}</AlertDescription>
          </Alert>
        ) : null}

        {planSuccess ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{planSuccess}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
};
