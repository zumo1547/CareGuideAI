"use client";

import {
  Activity,
  Camera,
  CheckCircle2,
  Loader2,
  ScanLine,
  Upload,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

interface FrameQuality {
  brightness: number;
  contrast: number;
  sharpness: number;
}

interface SafetyResult {
  quality: FrameQuality;
  canProceed: boolean;
  message: string;
  voiceMessage: string | null;
}

type CameraState = "idle" | "requesting" | "streaming" | "error";
type OcrSource = "ocr_camera" | "ocr_upload" | "manual";
type OcrMode = "quick" | "aggressive";

const AUTO_SCAN_INTERVAL_MS = 1200;
const AUTO_SCAN_BUSY_RETRY_MS = 650;
const AUTO_SCAN_NO_FRAME_RETRY_MS = 850;
const AUTO_SCAN_INITIAL_DELAY_MS = 360;
const AUTO_FINALIZE_MIN_COMPLETION = 65;
const AUTO_FINALIZE_STABLE_FRAMES = 2;
const AUTO_FINALIZE_MIN_CONFIDENCE = 0.62;
const OCR_MIN_TEXT_LENGTH = 6;
const SPEAK_COOLDOWN_MS = 2000;
const SAFETY_SPEAK_COOLDOWN_MS = 2600;
const CAMERA_CAPTURE_MAX_EDGE = 1440;
const CAMERA_AGGRESSIVE_RETRY_COOLDOWN_MS = 2800;
const COMPLETION_SMOOTHING_FACTOR = 0.36;
const COMPLETION_MAX_DROP_PER_TICK = 3;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
};

const resizeCanvasForOcr = (source: HTMLCanvasElement, maxEdge: number) => {
  const { width, height } = source;
  if (!width || !height) return source;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale >= 0.995) return source;

  const resized = createCanvas(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
  const context = resized.getContext("2d");
  if (!context) return source;
  context.drawImage(source, 0, 0, resized.width, resized.height);
  return resized;
};

const analyzeFrameQuality = (canvas: HTMLCanvasElement): FrameQuality | null => {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const maxEdge = 220;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const sampleWidth = Math.max(80, Math.floor(width * scale));
  const sampleHeight = Math.max(80, Math.floor(height * scale));

  const sampleCanvas = createCanvas(sampleWidth, sampleHeight);
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

const evaluateFrameSafety = (canvas: HTMLCanvasElement, text: string): SafetyResult => {
  const quality =
    analyzeFrameQuality(canvas) ??
    ({
      brightness: 0.5,
      contrast: 0.2,
      sharpness: 0.2,
    } satisfies FrameQuality);

  const hasValueSignal = /(?:\d{2,3}\s*[\/\\-]\s*\d{2,3}|sys|dia|pulse|mmhg|bp)/iu.test(text);

  if (quality.brightness < 0.1) {
    return {
      quality,
      canProceed: false,
      message: "ภาพมืดเกินไป กรุณาเพิ่มแสง",
      voiceMessage: "ภาพมืดเกินไป กรุณาเพิ่มแสงแล้วสแกนใหม่",
    };
  }
  if (quality.brightness > 0.98) {
    return {
      quality,
      canProceed: false,
      message: "ภาพสว่างจ้า/สะท้อนแสงเกินไป กรุณาปรับมุมกล้อง",
      voiceMessage: "ภาพสว่างเกินไป กรุณาปรับมุมกล้อง",
    };
  }
  if (quality.sharpness < 0.02 && !hasValueSignal) {
    return {
      quality,
      canProceed: false,
      message: "ภาพยังเบลอ กรุณาค้างกล้องให้นิ่ง",
      voiceMessage: "ภาพเบลอ กรุณาค้างกล้องให้นิ่ง",
    };
  }
  if (quality.contrast < 0.034 && !hasValueSignal) {
    return {
      quality,
      canProceed: false,
      message: "ตัวเลขยังไม่ชัด ลองปรับระยะหรือแสง",
      voiceMessage: "ตัวเลขไม่ชัด กรุณาปรับแสงหรือระยะ",
    };
  }

  return {
    quality,
    canProceed: true,
    message: "ภาพพร้อมอ่านค่า",
    voiceMessage: null,
  };
};

const cropCanvas = (source: HTMLCanvasElement, x: number, y: number, width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
};

const enhanceCanvas = ({
  source,
  contrast,
  threshold,
}: {
  source: HTMLCanvasElement;
  contrast: number;
  threshold?: number | null;
}) => {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;

  context.drawImage(source, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    let value = (luminance - 128) * contrast + 128;
    if (threshold !== null && threshold !== undefined) {
      value = value >= threshold ? 255 : 0;
    }
    const clamped = Math.max(0, Math.min(255, value));
    pixels[index] = clamped;
    pixels[index + 1] = clamped;
    pixels[index + 2] = clamped;
  }

  context.putImageData(frame, 0, 0);
  return canvas;
};

const buildVariants = (canvas: HTMLCanvasElement, mode: OcrMode) => {
  const width = canvas.width;
  const height = canvas.height;
  const centerCrop = cropCanvas(
    canvas,
    Math.floor(width * 0.15),
    Math.floor(height * 0.15),
    Math.floor(width * 0.7),
    Math.floor(height * 0.7),
  );
  const displayCrop = cropCanvas(
    canvas,
    Math.floor(width * 0.2),
    Math.floor(height * 0.2),
    Math.floor(width * 0.62),
    Math.floor(height * 0.55),
  );

  if (mode === "quick") {
    return [
      {
        id: "full-original",
        canvas,
        params: {
          tessedit_pageseg_mode: "6",
        },
      },
      {
        id: "display-threshold",
        canvas: enhanceCanvas({ source: displayCrop, contrast: 2.4, threshold: 145 }),
        params: {
          tessedit_pageseg_mode: "11",
          tessedit_char_whitelist: "0123456789SYSDIAPULSEBPHR/:- ",
        },
      },
    ];
  }

  const rightCrop = cropCanvas(
    canvas,
    Math.floor(width * 0.35),
    Math.floor(height * 0.1),
    Math.floor(width * 0.6),
    Math.floor(height * 0.78),
  );

  return [
    {
      id: "full-original",
      canvas,
      params: {
        tessedit_pageseg_mode: "6",
      },
    },
    {
      id: "full-enhanced",
      canvas: enhanceCanvas({ source: canvas, contrast: 1.8, threshold: null }),
      params: {
        tessedit_pageseg_mode: "11",
      },
    },
    {
      id: "display-threshold",
      canvas: enhanceCanvas({ source: displayCrop, contrast: 2.4, threshold: 145 }),
      params: {
        tessedit_pageseg_mode: "11",
        tessedit_char_whitelist: "0123456789SYSDIAPULSEBPHR/:- ",
      },
    },
    {
      id: "center-threshold",
      canvas: enhanceCanvas({ source: centerCrop, contrast: 2.2, threshold: 150 }),
      params: {
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist: "0123456789SYSDIAPULSEBPHR/:- ",
      },
    },
    {
      id: "right-threshold",
      canvas: enhanceCanvas({ source: rightCrop, contrast: 2.3, threshold: 150 }),
      params: {
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist: "0123456789SYSDIAPULSEBPHR/:- ",
      },
    },
  ];
};

const createCanvasFromFile = (file: File) =>
  new Promise<HTMLCanvasElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 1700;
      const scale = Math.min(1, maxWidth / image.width);
      const canvas = createCanvas(
        Math.max(320, Math.floor(image.width * scale)),
        Math.max(320, Math.floor(image.height * scale)),
      );
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Cannot prepare image for OCR"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error("Cannot read uploaded image"));
    image.src = URL.createObjectURL(file);
  });

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
  const stableKeyRef = useRef<string>("");
  const stableCountRef = useRef(0);
  const lastAggressiveFallbackAtRef = useRef(0);
  const finalizedRef = useRef(false);

  const [isCameraSupported] = useState(
    () =>
      typeof window !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function",
  );
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [status, setStatus] = useState("พร้อมสแกนค่าความดันจากกล้องหรือรูปภาพ");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [scanCompletion, setScanCompletion] = useState(0);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [scanText, setScanText] = useState("");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [resultSource, setResultSource] = useState<OcrSource>("ocr_camera");
  const [parsedReading, setParsedReading] = useState<ParsedBloodPressureReading | null>(null);
  const [systolicInput, setSystolicInput] = useState("");
  const [diastolicInput, setDiastolicInput] = useState("");
  const [pulseInput, setPulseInput] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStorage, setHistoryStorage] = useState<"blood_pressure_readings" | "scan_sessions_fallback" | null>(
    null,
  );
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
    (nextStatus?: string) => {
      isScanningRef.current = false;
      setIsScanning(false);
      setIsAnalyzing(false);
      clearTimer();
      stopCamera();
      setCameraState("idle");
      if (nextStatus) {
        setStatus(nextStatus);
      }
      stopThaiSpeech();
    },
    [clearTimer, stopCamera],
  );

  const moveToResult = useCallback(() => {
    window.setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  }, []);

  const resetResult = useCallback(() => {
    stableCountRef.current = 0;
    stableKeyRef.current = "";
    lastAggressiveFallbackAtRef.current = 0;
    finalizedRef.current = false;
    setParsedReading(null);
    setSystolicInput("");
    setDiastolicInput("");
    setPulseInput("");
    setScanText("");
    setPreviewDataUrl(null);
    setScanCompletion(0);
    setConfirmError(null);
    setConfirmSuccess(null);
    setCameraError(null);
  }, []);

  const ensureOcrWorker = useCallback(async () => {
    if (ocrWorkerRef.current) return ocrWorkerRef.current;

    const { createWorker } = await import("tesseract.js");
    const worker = (await createWorker(["eng", "tha"], 1, {
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

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const scale = Math.min(1, CAMERA_CAPTURE_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = createCanvas(
      Math.max(480, Math.floor(video.videoWidth * scale)),
      Math.max(320, Math.floor(video.videoHeight * scale)),
    );
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const recognizeBestReading = useCallback(
    async (canvas: HTMLCanvasElement, mode: OcrMode) => {
      const worker = await ensureOcrWorker();
      const variants = buildVariants(canvas, mode);

      let bestText = "";
      let bestConfidence = 0;
      let bestReading: ParsedBloodPressureReading | null = null;
      let bestParsedScore = -1;

      for (const variant of variants) {
        const params: Record<string, string> = {
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: variant.params.tessedit_pageseg_mode,
        };
        if (variant.params.tessedit_char_whitelist) {
          params.tessedit_char_whitelist = variant.params.tessedit_char_whitelist;
        }
        await worker.setParameters?.(params);

        const result = await worker.recognize(variant.canvas);
        const text = (result?.data?.text ?? "").replace(/\r/g, "").trim();
        const ocrConfidence = Number.isFinite(Number(result?.data?.confidence))
          ? Math.max(0, Math.min(1, Number(result?.data?.confidence) / 100))
          : 0;
        const parsed = parseBloodPressureFromText(text);

        if (text.length > bestText.length) {
          bestText = text;
          bestConfidence = Math.max(bestConfidence, ocrConfidence);
        }

        if (parsed) {
          const parsedScore = parsed.confidence * 0.7 + ocrConfidence * 0.3;
          if (!bestReading || parsedScore > bestParsedScore) {
            bestParsedScore = parsedScore;
            bestReading = parsed;
            bestText = text;
            bestConfidence = ocrConfidence;
          }

          const quickReady = mode === "quick" && parsedScore >= 0.82;
          const highConfidenceLabeled = parsed.confidence >= 0.9 && parsed.source === "labeled";
          if (quickReady || highConfidenceLabeled) {
            break;
          }
        }
      }

      return {
        text: bestText,
        confidence: bestConfidence,
        reading: bestReading,
      };
    },
    [ensureOcrWorker],
  );

  const setResultFromReading = useCallback(
    ({
      reading,
      text,
      previewDataUrl,
      source,
      completion,
    }: {
      reading: ParsedBloodPressureReading;
      text: string;
      previewDataUrl: string | null;
      source: OcrSource;
      completion: number;
    }) => {
      finalizedRef.current = true;
      setParsedReading(reading);
      setSystolicInput(String(reading.systolic));
      setDiastolicInput(String(reading.diastolic));
      setPulseInput(reading.pulse ? String(reading.pulse) : "");
      setScanText(text);
      setPreviewDataUrl(previewDataUrl);
      setResultSource(source);
      setScanCompletion(Math.max(completion, 100));
      setConfirmError(null);
      setConfirmSuccess(null);

      const assessment = assessBloodPressure(reading.systolic, reading.diastolic);
      const speech = buildBloodPressureSpeech({
        reading,
        assessment,
        bmiTrend,
      });

      stopScanning("สแกนเสร็จสิ้นแล้ว เลื่อนลงไปยืนยันผลได้เลย");
      moveToResult();
      speakWithCooldown(speech, true);
    },
    [bmiTrend, moveToResult, speakWithCooldown, stopScanning],
  );

  const analyzeCanvas = useCallback(
    async (
      canvas: HTMLCanvasElement,
      source: OcrSource,
      options?: {
        autoFinalizeFromCamera?: boolean;
        mode?: OcrMode;
      },
    ) => {
      const mode = options?.mode ?? (source === "ocr_upload" ? "aggressive" : "quick");
      const ocrCanvas =
        source === "ocr_camera" ? resizeCanvasForOcr(canvas, CAMERA_CAPTURE_MAX_EDGE) : canvas;
      const safety = evaluateFrameSafety(ocrCanvas, scanText);
      setStatus(safety.message);

      if (!safety.canProceed) {
        if (voiceEnabled && safety.voiceMessage) {
          const now = Date.now();
          if (now - lastSafetySpeakAtRef.current >= SAFETY_SPEAK_COOLDOWN_MS) {
            lastSafetySpeakAtRef.current = now;
            speakThai(safety.voiceMessage);
          }
        }
        return;
      }

      const recognized = await recognizeBestReading(ocrCanvas, mode);
      const text = recognized.text;
      const reading = recognized.reading;
      const confidence = recognized.confidence;
      const combinedConfidence = reading ? Math.max(reading.confidence, confidence) : confidence;

      const qualityScore = clamp(
        safety.quality.brightness * 0.2 + safety.quality.contrast * 0.35 + safety.quality.sharpness * 0.45,
        0,
        1,
      );
      let completion = Math.round(Math.min(20, (text.length / 24) * 20));
      completion += Math.round(qualityScore * 28);
      if (reading) {
        completion = Math.max(completion, Math.round(48 + qualityScore * 18 + combinedConfidence * 34));
      } else if (confidence > 0) {
        completion += Math.round(confidence * 18);
      }
      completion = clamp(completion, 0, 100);
      setScanCompletion((previous) => {
        const smoothed = Math.round(
          previous * (1 - COMPLETION_SMOOTHING_FACTOR) + completion * COMPLETION_SMOOTHING_FACTOR,
        );
        if (completion >= previous) {
          return clamp(smoothed, 0, 100);
        }
        return clamp(Math.max(smoothed, previous - COMPLETION_MAX_DROP_PER_TICK), 0, 100);
      });
      setScanText(text);

      if (!reading || text.length < OCR_MIN_TEXT_LENGTH) {
        const shouldRetryAggressive =
          source === "ocr_camera" &&
          mode === "quick" &&
          (completion >= AUTO_FINALIZE_MIN_COMPLETION || text.length >= 12) &&
          Date.now() - lastAggressiveFallbackAtRef.current >= CAMERA_AGGRESSIVE_RETRY_COOLDOWN_MS;

        if (shouldRetryAggressive) {
          lastAggressiveFallbackAtRef.current = Date.now();
          const retry = await recognizeBestReading(ocrCanvas, "aggressive");
          if (retry.reading) {
            setResultFromReading({
              reading: retry.reading,
              text: retry.text,
              previewDataUrl: source === "ocr_camera" ? canvas.toDataURL("image/jpeg", 0.92) : null,
              source,
              completion: Math.max(completion, 70),
            });
            return;
          }
        }
        setStatus("ยังอ่านค่าไม่ครบ กรุณาค้างกล้องให้นิ่งและเห็นตัวเลขชัดเจน");
        return;
      }

      if (source === "ocr_upload") {
        setResultFromReading({
          reading,
          text,
          previewDataUrl: canvas.toDataURL("image/jpeg", 0.92),
          source,
          completion,
        });
        return;
      }

      if (options?.autoFinalizeFromCamera && !finalizedRef.current) {
        const readingKey = `${reading.systolic}-${reading.diastolic}-${reading.pulse ?? "na"}`;
        if (stableKeyRef.current === readingKey) {
          stableCountRef.current += 1;
        } else {
          stableKeyRef.current = readingKey;
          stableCountRef.current = 1;
        }

        const requiredStableCount =
          combinedConfidence >= 0.84 ? AUTO_FINALIZE_STABLE_FRAMES : AUTO_FINALIZE_STABLE_FRAMES + 1;
        const isStableEnough = stableCountRef.current >= requiredStableCount;
        if (
          completion >= AUTO_FINALIZE_MIN_COMPLETION &&
          combinedConfidence >= AUTO_FINALIZE_MIN_CONFIDENCE &&
          isStableEnough
        ) {
          setResultFromReading({
            reading,
            text,
            previewDataUrl: canvas.toDataURL("image/jpeg", 0.92),
            source,
            completion,
          });
          return;
        }
      }

      setStatus("พบค่าความดันแล้ว กำลังตรวจความชัดเพื่อยืนยันอัตโนมัติ");
    },
    [recognizeBestReading, scanText, setResultFromReading, voiceEnabled],
  );

  const openCameraStream = useCallback(async () => {
    const requested: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    let lastError: unknown = null;
    for (const constraint of requested) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraint);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Cannot open camera stream");
  }, []);

  const startCameraScan = useCallback(async () => {
    if (!isCameraSupported) {
      setStatus("อุปกรณ์นี้ไม่รองรับกล้อง");
      return;
    }

    resetResult();
    warmupSpeechSynthesis();
    setCameraState("requesting");
    setCameraError(null);
    setStatus("กำลังขอสิทธิ์กล้อง กรุณากดยอมรับในเบราว์เซอร์");

    try {
      const stream = await openCameraStream();
      streamRef.current = stream;

      let video = videoRef.current;
      if (!video) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        video = videoRef.current;
      }
      if (!video) {
        throw new Error("Video element not ready");
      }

      video.setAttribute("playsinline", "true");
      video.muted = true;
      video.autoplay = true;
      video.srcObject = stream;

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(new Error("Camera stream timeout"));
        }, 4500);
        const onReady = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        video.onloadedmetadata = onReady;
      });

      await video.play();
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error("Camera feed is not visible");
      }

      setCameraState("streaming");
      isScanningRef.current = true;
      setIsScanning(true);
      setStatus("เปิดกล้องแล้ว กำลังสแกนความดันอัตโนมัติ");
      speakWithCooldown("เริ่มสแกนความดันอัตโนมัติแล้ว", true);
    } catch {
      stopCamera();
      setCameraState("error");
      setCameraError("ไม่สามารถเปิดกล้องได้ กรุณากดยอมรับสิทธิ์กล้องหรือปิดโปรแกรมที่ใช้กล้องอยู่");
      setStatus("เปิดกล้องไม่สำเร็จ กรุณาลองใหม่");
    }
  }, [isCameraSupported, openCameraStream, resetResult, speakWithCooldown, stopCamera]);

  const runUploadScan = useCallback(
    async (file: File) => {
      resetResult();
      setStatus("กำลังอ่านค่าความดันจากรูปภาพ");
      setIsAnalyzing(true);
      isBusyRef.current = true;
      setOcrProgress(0);

      try {
        const canvas = await createCanvasFromFile(file);
        await analyzeCanvas(canvas, "ocr_upload", { mode: "aggressive" });
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
        throw new Error(payload.error ?? "Cannot load blood pressure history");
      }

      setHistoryRows(payload.readings ?? []);
      setHistoryStorage(payload.storage ?? null);
    } catch (error) {
      setHistoryRows([]);
      setHistoryStorage(null);
      setConfirmError(error instanceof Error ? error.message : "Cannot load blood pressure history");
    } finally {
      setHistoryLoading(false);
    }
  }, [patientId]);

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
        throw new Error(payload.error ?? "Cannot save blood pressure reading");
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
      setConfirmError(error instanceof Error ? error.message : "Cannot save blood pressure reading");
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
        scheduleNext(AUTO_SCAN_BUSY_RETRY_MS);
        return;
      }

      const frame = captureFrame();
      if (!frame) {
        scheduleNext(AUTO_SCAN_NO_FRAME_RETRY_MS);
        return;
      }

      isBusyRef.current = true;
      setIsAnalyzing(true);
      setOcrProgress(0);
      try {
        await analyzeCanvas(frame, "ocr_camera", {
          autoFinalizeFromCamera: true,
          mode: "quick",
        });
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

    scheduleNext(AUTO_SCAN_INITIAL_DELAY_MS);
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

  const showCameraPreview = cameraState === "streaming" && isScanning;

  return (
    <Card className="border-cyan-200/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-cyan-700" />
          สแกนค่าความดันอัตโนมัติ
        </CardTitle>
        <CardDescription>
          รองรับหน้าจอเครื่องวัดหลายรูปแบบและกระดาษจดค่า เมื่ออ่านค่าได้ ระบบจะหยุดสแกนและเลื่อนไปส่วนยืนยันอัตโนมัติ
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

        {cameraError ? (
          <Alert variant="destructive">
            <AlertTitle>เปิดกล้องไม่สำเร็จ</AlertTitle>
            <AlertDescription>{cameraError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void startCameraScan()}
            disabled={!isCameraSupported || isScanning || cameraState === "requesting"}
          >
            {cameraState === "requesting" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            {cameraState === "requesting" ? "กำลังขอสิทธิ์กล้อง..." : "เริ่มสแกนด้วยกล้อง"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => stopScanning("หยุดสแกนแล้ว")}
            disabled={!isScanning}
          >
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

        <div className={isScanning ? "mx-auto w-full max-w-3xl" : "w-full"}>
          <div className={isScanning ? "relative overflow-hidden rounded-xl border bg-black" : "hidden"}>
            <video
              ref={videoRef}
              className={`h-72 w-full object-cover transition-opacity duration-200 md:h-[22rem] ${
                showCameraPreview ? "opacity-100" : "opacity-0"
              }`}
              autoPlay
              muted
              playsInline
            />
            {!showCameraPreview ? (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/40 p-6 text-center">
                <div className="space-y-2 text-muted-foreground">
                  {cameraState === "requesting" ? (
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-700" />
                  ) : cameraState === "error" ? (
                    <VideoOff className="mx-auto h-8 w-8 text-red-600" />
                  ) : (
                    <ScanLine className="mx-auto h-8 w-8 text-cyan-700" />
                  )}
                  <p className="text-sm">
                    {cameraState === "requesting"
                      ? "Requesting camera permission..."
                      : cameraState === "error"
                        ? "Unable to open camera. Tap \\\"Start camera scan\\\" again."
                        : "Tap \\\"Start camera scan\\\" when you want to use the camera."}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          {!isScanning ? (
            <div className="rounded-xl border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
              {cameraState === "requesting" ? (
                <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-cyan-700" />
              ) : cameraState === "error" ? (
                <VideoOff className="mx-auto mb-2 h-6 w-6 text-red-600" />
              ) : (
                <Camera className="mx-auto mb-2 h-6 w-6 text-cyan-700" />
              )}
              {cameraState === "requesting"
                ? "กำลังขอสิทธิ์กล้อง..."
                : cameraState === "error"
                  ? "เปิดกล้องไม่สำเร็จ ลองกดปุ่ม \"เริ่มสแกนด้วยกล้อง\" อีกครั้ง"
                  : "แนะนำให้กดปุ่ม \"เริ่มสแกนด้วยกล้อง\" เฉพาะตอนต้องการใช้งาน"}
            </div>
          ) : null}
        </div>

        {previewDataUrl ? (
          <div className="overflow-hidden rounded-2xl border border-cyan-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewDataUrl} alt="ภาพที่ใช้วิเคราะห์ความดัน" className="h-auto w-full object-cover" />
          </div>
        ) : null}

        <section ref={resultRef} className="space-y-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
          <h3 className="text-lg font-semibold text-cyan-950">ผลสแกนความดัน</h3>
          {parsedReading ? (
            <p className="text-sm text-cyan-900">
              อ่านจาก OCR สำเร็จ ({Math.round(parsedReading.confidence * 100)}%)
            </p>
          ) : (
            <p className="text-sm text-cyan-900">
              เมื่อระบบอ่านค่าได้ จะหยุดสแกนและเลื่อนมาที่ส่วนยืนยันนี้อัตโนมัติ
            </p>
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
                {parsedReading ? <Badge variant="secondary">แหล่งที่มา OCR: {parsedReading.source}</Badge> : null}
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
              {confirmLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
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
