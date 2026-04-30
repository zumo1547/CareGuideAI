"use client";

import { Activity, Camera, CheckCircle2, Loader2, Upload, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBmiTrend, type BiologicalSex, type BmiTrend } from "@/lib/onboarding";
import {
  assessBloodPressure,
  buildBloodPressureSpeech,
  buildBmiLinkedBloodPressureSummary,
  parseBloodPressureFromText,
  type ParsedBloodPressureReading,
} from "@/lib/scan/blood-pressure";
import { speakThai, stopThaiSpeech, warmupSpeechSynthesis } from "@/lib/voice/speak";

interface BloodPressureScannerProps {
  patientId: string;
  biologicalSex: BiologicalSex | null;
  bmi: number | null;
}

interface OcrWorkerLike {
  recognize: (
    image: HTMLCanvasElement | File | Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{
    data?: {
      text?: string;
      confidence?: number;
    };
  }>;
  setParameters?: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
}

interface FrameQuality {
  brightness: number;
  contrast: number;
  sharpness: number;
}

type FrameIssue = "too_dark" | "too_bright" | "too_blurry" | "low_contrast";

interface FrameSafetyResult {
  metrics: FrameQuality;
  blockingIssue: FrameIssue | null;
  statusMessage: string;
  voiceMessage: string | null;
}

interface SavedReading {
  id: string;
  measuredAt: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category: string;
  categoryLabelTh: string;
  trendSummaryTh: string;
  bmiAtMeasurement: number | null;
  bmiTrendLabel: string | null;
  source: string;
  ocrConfidence: number | null;
}

const AUTO_SCAN_INTERVAL_MS = 1700;
const OCR_MIN_TEXT_LENGTH = 6;
const AUTO_FINALIZE_MIN_COMPLETION = 65;
const AUTO_FINALIZE_MIN_CONFIDENCE = 0.55;
const SPEAK_COOLDOWN_MS = 2000;
const SAFETY_SPEAK_COOLDOWN_MS = 2600;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const qualityToScore = (quality: FrameQuality) => {
  const brightnessScore =
    quality.brightness < 0.15
      ? clamp(quality.brightness / 0.15, 0, 1)
      : quality.brightness > 0.95
        ? clamp((1 - quality.brightness) / 0.05, 0, 1)
        : 1;
  const contrastScore = clamp(quality.contrast / 0.055, 0, 1);
  const sharpnessScore = clamp(quality.sharpness / 0.03, 0, 1);
  return Number(clamp(brightnessScore * 0.25 + contrastScore * 0.35 + sharpnessScore * 0.4, 0, 1).toFixed(2));
};

const analyzeFrameQuality = (canvas: HTMLCanvasElement): FrameQuality | null => {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const maxEdge = 220;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const sampleWidth = Math.max(80, Math.floor(width * scale));
  const sampleHeight = Math.max(80, Math.floor(height * scale));

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const frame = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const pixels = frame.data;
  const pixelCount = sampleWidth * sampleHeight;
  if (!pixelCount) return null;

  const gray = new Float32Array(pixelCount);
  let sum = 0;
  for (let index = 0, pixel = 0; pixel < pixelCount; pixel += 1, index += 4) {
    const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    gray[pixel] = luminance;
    sum += luminance;
  }

  const mean = sum / pixelCount;
  let variance = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const offset = y * sampleWidth + x;
      const center = gray[offset];
      const diff = center - mean;
      variance += diff * diff;

      const laplace =
        4 * center -
        gray[offset - 1] -
        gray[offset + 1] -
        gray[offset - sampleWidth] -
        gray[offset + sampleWidth];
      edgeSum += Math.abs(laplace);
      edgeCount += 1;
    }
  }

  const brightness = Number(clamp(mean / 255, 0, 1).toFixed(3));
  const contrast = Number(clamp(Math.sqrt(variance / pixelCount) / 255, 0, 1).toFixed(3));
  const sharpness = Number(clamp((edgeCount ? edgeSum / edgeCount : 0) / 255, 0, 1).toFixed(3));
  return { brightness, contrast, sharpness };
};

const evaluateFrameSafety = (canvas: HTMLCanvasElement, text: string): FrameSafetyResult => {
  const metrics =
    analyzeFrameQuality(canvas) ??
    ({
      brightness: 0.5,
      contrast: 0.2,
      sharpness: 0.2,
    } satisfies FrameQuality);
  const hasValuePattern = /(?:\d{2,3}\s*[\/\\-]\s*\d{2,3}|sys|dia|mmhg|ความดัน|ชีพจร|pulse|bpm)/iu.test(text);

  if (metrics.brightness < 0.11) {
    return {
      metrics,
      blockingIssue: "too_dark",
      statusMessage: "ภาพมืดเกินไป เพิ่มแสงแล้วสแกนใหม่",
      voiceMessage: "ภาพมืดเกินไป กรุณาเพิ่มแสงแล้วสแกนใหม่",
    };
  }

  if (metrics.brightness > 0.97) {
    return {
      metrics,
      blockingIssue: "too_bright",
      statusMessage: "ภาพสว่างจ้าหรือสะท้อนแสง ปรับมุมกล้องใหม่",
      voiceMessage: "ภาพสว่างเกินไป กรุณาปรับมุมกล้องใหม่",
    };
  }

  if (metrics.sharpness < 0.022 && !hasValuePattern) {
    return {
      metrics,
      blockingIssue: "too_blurry",
      statusMessage: "ภาพยังเบลอ กรุณาค้างกล้องนิ่งขึ้นเล็กน้อย",
      voiceMessage: "ภาพเบลอ กรุณาค้างกล้องให้นิ่งขึ้น",
    };
  }

  if (metrics.contrast < 0.038 && !hasValuePattern) {
    return {
      metrics,
      blockingIssue: "low_contrast",
      statusMessage: "คอนทราสต์ต่ำเกินไป ลองขยับกล้องให้ชัดขึ้น",
      voiceMessage: "ตัวเลขไม่ชัด กรุณาปรับแสงหรือระยะกล้อง",
    };
  }

  return {
    metrics,
    blockingIssue: null,
    statusMessage: "ภาพพร้อมอ่านค่า",
    voiceMessage: null,
  };
};

const createCanvasFromFile = (file: File) =>
  new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const maxWidth = 1500;
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(300, Math.floor(image.width * scale));
      canvas.height = Math.max(300, Math.floor(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("ไม่สามารถเตรียมภาพสำหรับ OCR ได้"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas);
    };

    image.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปได้"));
    image.src = URL.createObjectURL(file);
  });

const formatDateTimeTh = (iso: string) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));

const toNullableNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
};

export const BloodPressureScanner = ({ patientId, biologicalSex, bmi }: BloodPressureScannerProps) => {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ocrWorkerRef = useRef<OcrWorkerLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const isBusyRef = useRef(false);
  const isScanningRef = useRef(false);
  const lastSpeakAtRef = useRef(0);
  const lastSafetySpeakAtRef = useRef(0);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const finalizedRef = useRef(false);

  const [isCameraSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function",
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState("พร้อมสแกนค่าความดันจากกล้องหรือรูปภาพ");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [scanCompletion, setScanCompletion] = useState(0);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [scanText, setScanText] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [lastSafetyMessage, setLastSafetyMessage] = useState<string | null>(null);
  const [resultSource, setResultSource] = useState<"ocr_camera" | "ocr_upload" | "manual">("ocr_camera");
  const [parsedReading, setParsedReading] = useState<ParsedBloodPressureReading | null>(null);
  const [systolicInput, setSystolicInput] = useState("");
  const [diastolicInput, setDiastolicInput] = useState("");
  const [pulseInput, setPulseInput] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStorage, setHistoryStorage] = useState<"blood_pressure_readings" | "scan_sessions_fallback" | null>(null);
  const [historyRows, setHistoryRows] = useState<SavedReading[]>([]);

  const bmiTrend: BmiTrend | null = useMemo(() => {
    if (!biologicalSex) return null;
    if (!Number.isFinite(Number(bmi)) || Number(bmi) <= 0) return null;
    return getBmiTrend(Number(bmi), biologicalSex);
  }, [biologicalSex, bmi]);

  const currentReading = useMemo(() => {
    const systolic = toNullableNumber(systolicInput);
    const diastolic = toNullableNumber(diastolicInput);
    const pulse = toNullableNumber(pulseInput);
    if (!systolic || !diastolic) return null;
    if (systolic < 70 || systolic > 260) return null;
    if (diastolic < 40 || diastolic > 160) return null;
    if (systolic <= diastolic) return null;
    return {
      systolic,
      diastolic,
      pulse: pulse && pulse >= 35 && pulse <= 220 ? pulse : null,
    };
  }, [diastolicInput, pulseInput, systolicInput]);

  const currentAssessment = useMemo(() => {
    if (!currentReading) return null;
    return assessBloodPressure(currentReading.systolic, currentReading.diastolic);
  }, [currentReading]);

  const combinedSummary = useMemo(() => {
    if (!currentAssessment) return null;
    return buildBmiLinkedBloodPressureSummary(currentAssessment, bmiTrend);
  }, [currentAssessment, bmiTrend]);

  const speakWithCooldown = useCallback(
    (message: string, force = false) => {
      if (!voiceEnabled || !message.trim()) return;
      const now = Date.now();
      if (!force && now - lastSpeakAtRef.current < SPEAK_COOLDOWN_MS) return;
      lastSpeakAtRef.current = now;
      speakThai(message, 1.02);
    },
    [voiceEnabled],
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopScanning = useCallback(
    (message?: string) => {
      isScanningRef.current = false;
      setIsScanning(false);
      setIsAnalyzing(false);
      clearTimer();
      stopCamera();
      if (message) {
        setStatus(message);
      }
      stopThaiSpeech();
    },
    [clearTimer, stopCamera],
  );

  const resetResult = useCallback(() => {
    setParsedReading(null);
    setSystolicInput("");
    setDiastolicInput("");
    setPulseInput("");
    setScanText("");
    setPreviewDataUrl(null);
    setScanCompletion(0);
    setConfirmError(null);
    setConfirmSuccess(null);
    setLastSafetyMessage(null);
  }, []);

  const moveToResult = useCallback(() => {
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const ensureOcrWorker = useCallback(async () => {
    if (ocrWorkerRef.current) return ocrWorkerRef.current;

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

  const recognizeText = useCallback(
    async (canvas: HTMLCanvasElement) => {
      const worker = await ensureOcrWorker();
      const result = await worker.recognize(canvas);
      const text = (result?.data?.text ?? "").replace(/\r/g, "").trim();
      const confidenceRaw = Number(result?.data?.confidence ?? 0);
      const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw / 100))
        : 0;
      return { text, confidence };
    },
    [ensureOcrWorker],
  );

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const setResultFromReading = useCallback(
    (
      reading: ParsedBloodPressureReading,
      nextText: string,
      nextPreviewDataUrl: string | null,
      source: "ocr_camera" | "ocr_upload" | "manual",
      completionScore: number,
    ) => {
      finalizedRef.current = true;
      setParsedReading(reading);
      setSystolicInput(String(reading.systolic));
      setDiastolicInput(String(reading.diastolic));
      setPulseInput(reading.pulse ? String(reading.pulse) : "");
      setScanText(nextText);
      setPreviewDataUrl(nextPreviewDataUrl);
      setResultSource(source);
      setScanCompletion(Math.max(completionScore, 100));
      setConfirmError(null);
      setConfirmSuccess(null);

      const assessment = assessBloodPressure(reading.systolic, reading.diastolic);
      const speech = buildBloodPressureSpeech({ reading, assessment, bmiTrend });
      setStatus("อ่านค่าความดันได้แล้ว เลื่อนลงไปยืนยันผล");
      stopScanning("สแกนเสร็จสิ้นแล้ว เลื่อนลงไปยืนยันผลได้เลย");
      moveToResult();
      speakWithCooldown(speech, true);
    },
    [bmiTrend, moveToResult, speakWithCooldown, stopScanning],
  );

  const analyzeCanvas = useCallback(
    async (
      canvas: HTMLCanvasElement,
      source: "ocr_camera" | "ocr_upload",
      opts?: { autoFinalizeFromCamera?: boolean },
    ) => {
      const ocr = await recognizeText(canvas);
      const safety = evaluateFrameSafety(canvas, ocr.text);
      setLastSafetyMessage(safety.blockingIssue ? safety.statusMessage : null);

      if (safety.blockingIssue) {
        const now = Date.now();
        if (
          voiceEnabled &&
          safety.voiceMessage &&
          now - lastSafetySpeakAtRef.current >= SAFETY_SPEAK_COOLDOWN_MS
        ) {
          lastSafetySpeakAtRef.current = now;
          speakThai(safety.voiceMessage);
        }
      }

      const parsed = parseBloodPressureFromText(ocr.text);
      const qualityScore = qualityToScore(safety.metrics);
      let completion = Math.round(Math.min(24, (ocr.text.length / 36) * 24));
      completion += Math.round(qualityScore * 30);
      completion += parsed ? Math.round(Math.max(parsed.confidence, ocr.confidence) * 46) : 0;
      completion = clamp(completion, 0, 100);

      setScanCompletion(completion);
      setStatus(safety.statusMessage);

      if (parsed && source === "ocr_upload") {
        setResultFromReading(parsed, ocr.text, canvas.toDataURL("image/jpeg", 0.9), source, completion);
        return;
      }

      if (!parsed || ocr.text.length < OCR_MIN_TEXT_LENGTH) {
        if (source === "ocr_camera") {
          setStatus("ยังอ่านค่าไม่ครบ กรุณาค้างกล้องให้นิ่งและเห็นตัวเลขชัด");
        }
        return;
      }

      if (
        source === "ocr_camera" &&
        opts?.autoFinalizeFromCamera &&
        !safety.blockingIssue &&
        completion >= AUTO_FINALIZE_MIN_COMPLETION &&
        Math.max(parsed.confidence, ocr.confidence) >= AUTO_FINALIZE_MIN_CONFIDENCE &&
        !finalizedRef.current
      ) {
        setResultFromReading(parsed, ocr.text, canvas.toDataURL("image/jpeg", 0.9), source, completion);
      } else {
        setStatus("พบค่าความดันแล้ว กำลังรอความชัดเพิ่มอีกเล็กน้อย");
      }
    },
    [recognizeText, setResultFromReading, voiceEnabled],
  );

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/scan/blood-pressure?patientId=${patientId}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        readings?: SavedReading[];
        storage?: "blood_pressure_readings" | "scan_sessions_fallback";
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "โหลดประวัติความดันไม่สำเร็จ");
      }

      setHistoryRows(payload.readings ?? []);
      setHistoryStorage(payload.storage ?? null);
    } catch (error) {
      setHistoryRows([]);
      setHistoryStorage(null);
      setConfirmError(error instanceof Error ? error.message : "โหลดประวัติความดันไม่สำเร็จ");
    } finally {
      setHistoryLoading(false);
    }
  }, [patientId]);

  const startCameraScan = useCallback(async () => {
    if (!isCameraSupported) {
      setStatus("อุปกรณ์นี้ไม่รองรับกล้อง");
      return;
    }

    finalizedRef.current = false;
    resetResult();
    warmupSpeechSynthesis();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error("ไม่พบส่วนแสดงกล้อง");
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play();

      isScanningRef.current = true;
      setIsScanning(true);
      setStatus("เปิดกล้องแล้ว กำลังสแกนค่าความดันอัตโนมัติ");
      speakWithCooldown("เริ่มสแกนความดันอัตโนมัติแล้ว", true);
    } catch {
      stopScanning("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตสิทธิ์กล้องแล้วลองใหม่");
    }
  }, [isCameraSupported, resetResult, speakWithCooldown, stopScanning]);

  const runUploadScan = useCallback(
    async (file: File) => {
      finalizedRef.current = false;
      resetResult();
      setStatus("กำลังอ่านค่าความดันจากรูปภาพ");
      setIsAnalyzing(true);
      isBusyRef.current = true;
      setOcrProgress(0);

      try {
        const canvas = await createCanvasFromFile(file);
        await analyzeCanvas(canvas, "ocr_upload");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "อ่านค่าจากรูปไม่สำเร็จ");
      } finally {
        setIsAnalyzing(false);
        isBusyRef.current = false;
        setOcrProgress(null);
      }
    },
    [analyzeCanvas, resetResult],
  );

  const confirmReading = useCallback(async () => {
    if (!currentReading || !currentAssessment) {
      setConfirmError("กรุณาสแกนหรือกรอกค่าความดันให้ครบก่อนยืนยัน");
      return;
    }

    setConfirmLoading(true);
    setConfirmError(null);
    setConfirmSuccess(null);

    try {
      const response = await fetch("/api/scan/blood-pressure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          extractedText: scanText || undefined,
          systolic: currentReading.systolic,
          diastolic: currentReading.diastolic,
          pulse: currentReading.pulse,
          confidence: parsedReading?.confidence ?? null,
          source: resultSource,
          capturedAt: new Date().toISOString(),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        reading?: SavedReading;
        storage?: "blood_pressure_readings" | "scan_sessions_fallback";
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "ยืนยันค่าความดันไม่สำเร็จ");
      }

      setConfirmSuccess("บันทึกค่าความดันเรียบร้อยแล้ว");
      setHistoryStorage(payload.storage ?? historyStorage);
      if (payload.reading) {
        setHistoryRows((previous) => [payload.reading as SavedReading, ...previous].slice(0, 20));
      } else {
        await loadHistory();
      }

      speakWithCooldown(
        `บันทึกค่าความดันเรียบร้อย ${currentReading.systolic} ต่อ ${currentReading.diastolic}`,
        true,
      );
      router.refresh();
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "ยืนยันค่าความดันไม่สำเร็จ");
    } finally {
      setConfirmLoading(false);
    }
  }, [
    currentAssessment,
    currentReading,
    historyStorage,
    loadHistory,
    parsedReading,
    patientId,
    resultSource,
    router,
    scanText,
    speakWithCooldown,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    if (!isScanning) return;

    let cancelled = false;
    const scheduleNext = (delay = AUTO_SCAN_INTERVAL_MS) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        void tick();
      }, delay);
    };

    const tick = async () => {
      if (cancelled || !isScanningRef.current) return;
      if (isBusyRef.current) {
        scheduleNext(420);
        return;
      }

      const frame = captureFrame();
      if (!frame) {
        scheduleNext(520);
        return;
      }

      isBusyRef.current = true;
      setIsAnalyzing(true);
      setOcrProgress(0);

      try {
        await analyzeCanvas(frame, "ocr_camera", { autoFinalizeFromCamera: true });
      } catch {
        setStatus("วิเคราะห์ค่าความดันอัตโนมัติไม่สำเร็จ");
      } finally {
        isBusyRef.current = false;
        setIsAnalyzing(false);
        setOcrProgress(null);
        if (!cancelled && isScanningRef.current) {
          scheduleNext();
        }
      }
    };

    scheduleNext(200);
    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [analyzeCanvas, captureFrame, clearTimer, isScanning]);

  useEffect(() => {
    return () => {
      stopScanning();
      void terminateOcrWorker();
    };
  }, [stopScanning, terminateOcrWorker]);

  return (
    <Card className="border-cyan-200/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-700" />
          สแกนค่าความดันอัตโนมัติ
        </CardTitle>
        <CardDescription>
          รองรับหน้าจอเครื่องวัดความดันหลายรูปแบบ และกระดาษจดค่า เมื่ออ่านได้ระบบจะหยุดสแกนแล้วเลื่อนไปส่วนยืนยันทันที
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-4 text-sm text-cyan-900">
          {status}
          {scanCompletion > 0 ? (
            <div className="mt-3">
              <div className="h-2 w-full rounded-full bg-cyan-100">
                <div
                  className="h-2 rounded-full bg-cyan-600 transition-all duration-500"
                  style={{ width: `${scanCompletion}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-cyan-700">ความครบถ้วนสแกน {scanCompletion}%</p>
            </div>
          ) : null}
          {isAnalyzing && ocrProgress !== null ? (
            <p className="mt-2 text-xs text-cyan-700">กำลัง OCR {ocrProgress}%</p>
          ) : null}
        </div>

        {lastSafetyMessage ? (
          <Alert variant="destructive">
            <AlertTitle>คุณภาพภาพยังไม่พอ</AlertTitle>
            <AlertDescription>{lastSafetyMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void startCameraScan()} disabled={!isCameraSupported || isScanning}>
            <Camera className="mr-2 h-4 w-4" />
            เริ่มสแกนความดัน
          </Button>
          <Button type="button" variant="outline" onClick={() => stopScanning("หยุดสแกนแล้ว")} disabled={!isScanning}>
            หยุดสแกน
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setVoiceEnabled((prev) => !prev);
              if (voiceEnabled) {
                stopThaiSpeech();
              } else {
                speakThai("เปิดเสียงอ่านผลแล้ว");
              }
            }}
          >
            {voiceEnabled ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
            {voiceEnabled ? "ปิดเสียง" : "เปิดเสียง"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
          >
            <Upload className="mr-2 h-4 w-4" />
            อัปโหลดรูปหน้าจอ/กระดาษ
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void runUploadScan(file);
              event.target.value = "";
            }}
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-cyan-100 bg-slate-950/95">
          <video ref={videoRef} className="aspect-[16/10] w-full object-cover" autoPlay muted playsInline />
        </div>

        {previewDataUrl ? (
          <div className="overflow-hidden rounded-2xl border border-cyan-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewDataUrl} alt="ภาพที่ใช้วิเคราะห์ความดัน" className="w-full object-cover" />
          </div>
        ) : null}

        <section ref={resultRef} className="space-y-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
          <h3 className="text-lg font-semibold text-cyan-950">ผลสแกนความดัน</h3>

          {parsedReading ? (
            <p className="text-sm text-cyan-900">
              อ่านจาก OCR สำเร็จ ({Math.round(parsedReading.confidence * 100)}%)
            </p>
          ) : (
            <p className="text-sm text-cyan-900">เมื่อระบบอ่านค่าได้ จะหยุดสแกนและแสดงผลที่ส่วนนี้ทันที</p>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor="systolic-input">Systolic (ตัวบน)</Label>
              <Input
                id="systolic-input"
                inputMode="numeric"
                placeholder="เช่น 120"
                value={systolicInput}
                onChange={(event) => setSystolicInput(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="diastolic-input">Diastolic (ตัวล่าง)</Label>
              <Input
                id="diastolic-input"
                inputMode="numeric"
                placeholder="เช่น 80"
                value={diastolicInput}
                onChange={(event) => setDiastolicInput(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pulse-input">Pulse (ชีพจร)</Label>
              <Input
                id="pulse-input"
                inputMode="numeric"
                placeholder="เช่น 72"
                value={pulseInput}
                onChange={(event) => setPulseInput(event.target.value)}
              />
            </div>
          </div>

          {currentAssessment ? (
            <div className="rounded-xl border border-cyan-200 bg-white/90 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-cyan-700 hover:bg-cyan-700">
                  ระดับ: {currentAssessment.categoryLabelTh}
                </Badge>
                {parsedReading ? (
                  <Badge variant="secondary">แหล่งที่มา OCR: {parsedReading.source}</Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-slate-700">{combinedSummary}</p>
              <p className="mt-1 text-sm text-slate-700">{currentAssessment.actionTh}</p>
              {bmiTrend ? (
                <p className="mt-1 text-xs text-slate-500">
                  BMI ล่าสุด {bmiTrend.bmi.toFixed(2)} ({bmiTrend.sexLabel}) | {bmiTrend.bloodPressureTrendLabel}
                </p>
              ) : null}
            </div>
          ) : null}

          {confirmError ? (
            <Alert variant="destructive">
              <AlertTitle>ยืนยันผลไม่สำเร็จ</AlertTitle>
              <AlertDescription>{confirmError}</AlertDescription>
            </Alert>
          ) : null}

          {confirmSuccess ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>บันทึกสำเร็จ</AlertTitle>
              <AlertDescription>{confirmSuccess}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void confirmReading()} disabled={confirmLoading || !currentReading}>
              {confirmLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              ยืนยันผลความดัน
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetResult();
                setStatus("รีเซ็ตผลแล้ว สามารถเริ่มสแกนใหม่ได้");
              }}
              disabled={isScanning}
            >
              เริ่มสแกนใหม่
            </Button>
          </div>
        </section>

        <section className="space-y-2 rounded-2xl border border-cyan-100 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">ประวัติค่าความดันล่าสุด</h3>
            {historyStorage ? (
              <Badge variant="secondary">
                โหมดเก็บข้อมูล: {historyStorage === "blood_pressure_readings" ? "ตารางหลัก" : "โหมดสำรอง"}
              </Badge>
            ) : null}
          </div>

          {historyLoading ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดประวัติ...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เวลา</TableHead>
                  <TableHead>ค่า</TableHead>
                  <TableHead>ชีพจร</TableHead>
                  <TableHead>ระดับ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      ยังไม่มีประวัติความดัน
                    </TableCell>
                  </TableRow>
                ) : (
                  historyRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDateTimeTh(row.measuredAt)}</TableCell>
                      <TableCell className="font-medium">
                        {row.systolic}/{row.diastolic}
                      </TableCell>
                      <TableCell>{row.pulse ?? "-"}</TableCell>
                      <TableCell>{row.categoryLabelTh}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </section>
      </CardContent>
    </Card>
  );
};
