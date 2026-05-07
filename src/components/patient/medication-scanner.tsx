"use client";

import type { IScannerControls } from "@zxing/browser";
import { Camera, CheckCircle2, Loader2, ScanLine, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
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
import {
  parseMedicationDetailsFromText,
  validateParsedMedicationDetails,
  type OcrValidationResult,
} from "@/lib/scan/ocr";
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
  quantityPerDoseValue: number | null;
  frequencyPerDay: number | null;
  mealTiming: MealTiming;
  periods: DayPeriod[];
  customTimes: string[];
  totalPillsInPackage: number | null;
  isDoctorPrescribed: boolean | null;
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
  validation?: OcrValidationResult;
  externalInfo?: {
    source: "local" | "openfda";
    matchedNameEn: string;
    matchedNameTh: string | null;
    genericNameEn: string | null;
    indicationEn: string | null;
    indicationTh: string | null;
    symptomTagsTh: string[];
    matchScore: number;
  } | null;
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
const AUTO_OCR_INTERVAL_MS = 2000;
const OCR_MIN_TEXT_LENGTH = 12;
const AUTO_FINALIZE_MIN_COMPLETION = 66;
const AUTO_FINALIZE_MIN_CONFIDENCE = 0.05;
const AUTO_FINALIZE_MIN_TEXT_LENGTH = 12;
const AUTO_FINALIZE_STABLE_FRAMES = 1;
const SAFETY_WARNING_COOLDOWN_MS = 2800;
const QUALITY_MIN_BRIGHTNESS = 0.16;
const QUALITY_MAX_BRIGHTNESS = 0.94;
const QUALITY_MIN_CONTRAST = 0.07;
const QUALITY_MIN_SHARPNESS = 0.045;
const QUALITY_HARD_MIN_BRIGHTNESS = 0.11;
const QUALITY_HARD_MAX_BRIGHTNESS = 0.97;
const QUALITY_HARD_MIN_CONTRAST = 0.045;
const QUALITY_HARD_MIN_SHARPNESS = 0.028;
const NAME_CLARITY_MIN_SCORE = 0.54;
const AUTO_FINALIZE_MIN_SAFETY_SCORE = 0.42;

interface ScanCandidate {
  text: string;
  previewDataUrl: string;
  completion: number;
  confidence: number;
}

type ScanSafetyIssue =
  | "too_dark"
  | "too_bright"
  | "too_blurry"
  | "low_contrast"
  | "name_unclear";

interface ScanQualityMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
}

interface ScanSafetyResult {
  quality: ScanQualityMetrics;
  hasThaiName: boolean;
  hasEnglishName: boolean;
  nameClarityScore: number;
  overallScore: number;
  blockingIssue: ScanSafetyIssue | null;
  statusMessage: string;
  voiceMessage: string | null;
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

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parsePositiveInt = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded <= 0) return null;
  return rounded;
};

const parsePositiveNumber = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
};

type MedicationTypeChoice = "prescription" | "otc";

const THAI_LINE_REGEX = /[\u0E00-\u0E7F]/u;
const ENGLISH_LINE_REGEX = /[A-Za-z]/;
const NON_DRUG_LINE_REGEX =
  /(hospital|clinic|doctor|patient|patient name|hn\b|opd\b|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.|โรงพยาบาล|แพทย์|ผู้ป่วย|รับประทาน|วันละ|ครั้งละ|ก่อนอาหาร|หลังอาหาร|เช้า|กลางวัน|เที่ยง|เย็น|ก่อนนอน)/i;
const DOSE_HINT_REGEX =
  /(รับประทาน|วันละ|ครั้งละ|ก่อนอาหาร|หลังอาหาร|เช้า|กลางวัน|เที่ยง|เย็น|ก่อนนอน|take|daily|times?\s*(per|a)\s*day|before meal|after meal)/i;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const findEnglishNameCandidate = (lines: string[]) =>
  lines.find((line) => {
    if (!ENGLISH_LINE_REGEX.test(line)) return false;
    if (NON_DRUG_LINE_REGEX.test(line)) return false;

    const englishLetters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (englishLetters < 5) return false;

    return (
      /\d+(?:\.\d+)?\s*(mg|mcg|g|ml)\b/i.test(line) ||
      /\b[A-Za-z][A-Za-z-]{3,}\b.*\b[A-Za-z][A-Za-z-]{2,}\b/.test(line) ||
      /\([A-Za-z0-9\- ]{3,}\)/.test(line)
    );
  });

const findThaiNameCandidate = (lines: string[]) =>
  lines.find((line) => {
    if (!THAI_LINE_REGEX.test(line)) return false;
    if (NON_DRUG_LINE_REGEX.test(line)) return false;

    const thaiLength = (line.match(/[\u0E00-\u0E7F]/g) ?? []).length;
    return thaiLength >= 4;
  });

const analyzeNameClarity = (text: string) => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  const englishCandidate = findEnglishNameCandidate(lines);
  const thaiCandidate = findThaiNameCandidate(lines);
  const hasEnglishName = Boolean(englishCandidate);
  const hasThaiName = Boolean(thaiCandidate);
  const hasDoseSignal = DOSE_HINT_REGEX.test(text);

  let score = 0;
  if (hasEnglishName) score += 0.4;
  if (hasThaiName) score += 0.4;
  if (hasDoseSignal) score += 0.12;
  if (text.length >= 40) score += 0.08;

  return {
    hasEnglishName,
    hasThaiName,
    nameClarityScore: Number(clamp(score, 0, 1).toFixed(2)),
  };
};

const analyzeFrameQuality = (canvas: HTMLCanvasElement): ScanQualityMetrics | null => {
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

const evaluateScanSafety = (canvas: HTMLCanvasElement, normalizedText: string): ScanSafetyResult => {
  const parsed = parseMedicationDetailsFromText(normalizedText);
  const validation = validateParsedMedicationDetails(parsed);
  const fallbackNameClarity = analyzeNameClarity(normalizedText);
  const hasEnglishName = Boolean(parsed.medicineNameEn?.trim()) || fallbackNameClarity.hasEnglishName;
  const hasThaiName = Boolean(parsed.medicineNameTh?.trim()) || fallbackNameClarity.hasThaiName;
  const nameClarityScore = Math.max(validation.score, parsed.confidence, fallbackNameClarity.nameClarityScore);
  const quality =
    analyzeFrameQuality(canvas) ??
    ({
      brightness: 0.5,
      contrast: 0.2,
      sharpness: 0.2,
    } satisfies ScanQualityMetrics);

  const brightnessScore =
    quality.brightness < QUALITY_MIN_BRIGHTNESS
      ? clamp(quality.brightness / QUALITY_MIN_BRIGHTNESS, 0, 1)
      : quality.brightness > QUALITY_MAX_BRIGHTNESS
        ? clamp((1 - quality.brightness) / (1 - QUALITY_MAX_BRIGHTNESS), 0, 1)
        : 1;
  const contrastScore = clamp(quality.contrast / QUALITY_MIN_CONTRAST, 0, 1);
  const sharpnessScore = clamp(quality.sharpness / QUALITY_MIN_SHARPNESS, 0, 1);
  const overallScore = Number(
    clamp(
      brightnessScore * 0.22 + contrastScore * 0.23 + sharpnessScore * 0.25 + nameClarityScore * 0.3,
      0,
      1,
    ).toFixed(2),
  );

  const hasDoseSignal =
    Boolean(parsed.quantityPerDose) ||
    Boolean(parsed.frequencyPerDay) ||
    parsed.periods.length > 0 ||
    parsed.customTimes.length > 0 ||
    parsed.mealTiming !== "unspecified";
  const hasAnyNameSignal = hasEnglishName || hasThaiName || nameClarityScore >= 0.62;
  const hasRecoverableQualitySignal =
    hasAnyNameSignal || hasDoseSignal || normalizedText.length >= 28 || parsed.confidence >= 0.58;

  let blockingIssue: ScanSafetyIssue | null = null;
  let statusMessage = "Image and label text are ready for automatic analysis.";
  let voiceMessage: string | null = null;

  if (quality.brightness < QUALITY_HARD_MIN_BRIGHTNESS) {
    blockingIssue = "too_dark";
    statusMessage = "Image is too dark. Please increase light and rescan.";
    voiceMessage = "Image is too dark. Please increase light and rescan.";
  } else if (quality.brightness > QUALITY_HARD_MAX_BRIGHTNESS) {
    blockingIssue = "too_bright";
    statusMessage = "Image is too bright or has glare. Please adjust camera angle.";
    voiceMessage = "Image is too bright. Please adjust camera angle and rescan.";
  } else if (quality.sharpness < QUALITY_HARD_MIN_SHARPNESS && !hasRecoverableQualitySignal) {
    blockingIssue = "too_blurry";
    statusMessage = "Image is blurry or shaky. Hold the camera steady and move slightly closer.";
    voiceMessage = "Image is blurry. Hold camera steady and rescan.";
  } else if (quality.contrast < QUALITY_HARD_MIN_CONTRAST && !hasRecoverableQualitySignal) {
    blockingIssue = "low_contrast";
    statusMessage = "Label contrast is too low. Please adjust light or distance.";
    voiceMessage = "Label contrast is too low. Please adjust light and rescan.";
  } else if (!validation.canConfirm && !hasAnyNameSignal && !hasDoseSignal) {
    blockingIssue = "name_unclear";
    statusMessage = `Medicine name is unclear: ${validation.messageTh}`;
    voiceMessage = "Thai or English medicine name is unclear. Please rescan.";
  } else if (!hasEnglishName && !hasThaiName && nameClarityScore < 0.68) {
    blockingIssue = "name_unclear";
    statusMessage = "Cannot detect Thai or English medicine name. Please center label in frame.";
    voiceMessage = "Medicine name not detected. Please rescan.";
  } else if (nameClarityScore < NAME_CLARITY_MIN_SCORE && normalizedText.length < 24) {
    blockingIssue = "name_unclear";
    statusMessage = "Medicine name is still unclear. Hold camera steady a bit longer.";
    voiceMessage = "Medicine name is unclear. Please rescan.";
  } else if (
    quality.brightness < QUALITY_MIN_BRIGHTNESS ||
    quality.brightness > QUALITY_MAX_BRIGHTNESS ||
    quality.sharpness < QUALITY_MIN_SHARPNESS ||
    quality.contrast < QUALITY_MIN_CONTRAST
  ) {
    statusMessage = "Readable now. Capturing the best frame for automatic analysis.";
  }

  return {
    quality,
    hasEnglishName,
    hasThaiName,
    nameClarityScore,
    overallScore,
    blockingIssue,
    statusMessage,
    voiceMessage,
  };
};

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
  const router = useRouter();
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
  const lastSafetyIssueRef = useRef<ScanSafetyIssue | null>(null);
  const lastSafetyWarningAtRef = useRef(0);

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
  const [scanSafety, setScanSafety] = useState<ScanSafetyResult | null>(null);
  const [ocrValidation, setOcrValidation] = useState<OcrValidationResult | null>(null);
  const [parsedDetails, setParsedDetails] = useState<ParsedMedicationDetails | null>(null);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSuccess, setPlanSuccess] = useState<string | null>(null);
  const [ocrPreviewDataUrl, setOcrPreviewDataUrl] = useState<string | null>(null);
  const [medicationType, setMedicationType] = useState<MedicationTypeChoice>("prescription");
  const [totalPillsInput, setTotalPillsInput] = useState("");
  const [pillsPerDoseInput, setPillsPerDoseInput] = useState("1");
  const [otcReminderUntilDate, setOtcReminderUntilDate] = useState(() =>
    formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  );

  const isCameraSupported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBarcodeDetectorSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  const applyPlanDefaultsFromParsed = useCallback((details: ParsedMedicationDetails | null) => {
    if (!details) {
      setMedicationType("prescription");
      setTotalPillsInput("");
      setPillsPerDoseInput("1");
      setOtcReminderUntilDate(formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
      return;
    }

    const parsedType: MedicationTypeChoice =
      details.isDoctorPrescribed === false ? "otc" : "prescription";
    setMedicationType(parsedType);
    setTotalPillsInput(
      details.totalPillsInPackage && details.totalPillsInPackage > 0
        ? String(details.totalPillsInPackage)
        : "",
    );
    setPillsPerDoseInput(
      details.quantityPerDoseValue && details.quantityPerDoseValue > 0
        ? String(details.quantityPerDoseValue)
        : "1",
    );
    setOtcReminderUntilDate(formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  }, []);

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

  const announceSafetyIssue = useCallback(
    (result: ScanSafetyResult) => {
      if (!result.blockingIssue) {
        lastSafetyIssueRef.current = null;
        return;
      }

      setStatus(result.statusMessage);
      const now = Date.now();
      const canSpeak =
        voiceEnabled &&
        Boolean(result.voiceMessage) &&
        (lastSafetyIssueRef.current !== result.blockingIssue ||
          now - lastSafetyWarningAtRef.current >= SAFETY_WARNING_COOLDOWN_MS);

      if (canSpeak && result.voiceMessage) {
        speakThai(result.voiceMessage, 1);
        lastSafetyWarningAtRef.current = now;
      }

      lastSafetyIssueRef.current = result.blockingIssue;
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
    lastSafetyIssueRef.current = null;
    lastSafetyWarningAtRef.current = 0;
    setScanSafety(null);
    setOcrValidation(null);
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
      applyPlanDefaultsFromParsed(null);
      setOcrValidation(null);
      setPlanError(null);
      setPlanSuccess(null);

      return result;
    },
    [applyPlanDefaultsFromParsed, patientId, updateGuidance],
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
      applyPlanDefaultsFromParsed(result.parsedDetails ?? null);
      setOcrText(result.ocrText ?? text);
      setPlanError(null);
      setPlanSuccess(null);

      const resolvedValidation =
        result.validation ??
        (result.parsedDetails ? validateParsedMedicationDetails(result.parsedDetails) : null);
      setOcrValidation(resolvedValidation);

      if (resolvedValidation && !resolvedValidation.canConfirm) {
        const failMessage = `ยังยืนยันไม่ได้: ${resolvedValidation.messageTh}`;
        setStatus(failMessage);
        if (voiceEnabled && speakResult) {
          speakThai(`ยังยืนยันไม่ได้ ${resolvedValidation.messageTh}`);
        }
        return result;
      }

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
    [applyPlanDefaultsFromParsed, patientId, updateGuidance, voiceEnabled],
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
        const ocrResponse = await submitOcrText(candidate.text, false);
        if (ocrResponse.validation?.canConfirm === false) {
          setStatus(`ผล OCR ยังไม่ปลอดภัย: ${ocrResponse.validation.messageTh}`);
          if (voiceEnabled) {
            speakThai(`ผลสแกนยังไม่ปลอดภัย ${ocrResponse.validation.messageTh}`);
          }
          moveToConfirmationSection();
          isFinalizingRef.current = false;
          return;
        }

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
    setOcrValidation(null);

    try {
      const canvas = await createCanvasFromFile(file);
      setOcrPreviewDataUrl(canvas.toDataURL("image/jpeg", 0.9));

      const ocr = await recognizeLabelImage(canvas);
      const frame = extractFrameFromOcrBlocks(ocr.blocks, canvas.width, canvas.height);
      const nextGuidance = frame ? computeScanGuidance(frame) : "move_closer";
      updateGuidance(nextGuidance);

      const normalizedText = ocr.text.trim();
      const safety = evaluateScanSafety(canvas, normalizedText);
      setScanSafety(safety);
      if (safety.blockingIssue) {
        announceSafetyIssue(safety);
        return;
      }

      if (!normalizedText || normalizedText.length < OCR_MIN_TEXT_LENGTH) {
        setStatus("อ่านข้อความจากรูปยังไม่ครบ ลองอัปโหลดรูปที่ชัดขึ้น");
        return;
      }

      setOcrText(normalizedText);
      const ocrResponse = await submitOcrText(normalizedText, false);
      if (ocrResponse.validation?.canConfirm === false) {
        setStatus(`ผล OCR ยังไม่ปลอดภัย: ${ocrResponse.validation.messageTh}`);
        if (voiceEnabled) {
          speakThai(`ผล OCR ยังไม่ปลอดภัย ${ocrResponse.validation.messageTh}`);
        }
        return;
      }

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

    if (!ocrValidation) {
      setPlanError("ยังไม่ผ่านการตรวจความน่าเชื่อถือ OCR กรุณาสแกนใหม่");
      return;
    }

    if (!ocrValidation.canConfirm) {
      setPlanError(`ยังยืนยันไม่ได้: ${ocrValidation.messageTh}`);
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
    const parsedPillsPerDose =
      parsePositiveNumber(pillsPerDoseInput) ?? parsedDetails.quantityPerDoseValue ?? 1;
    const parsedTotalPills = parsePositiveInt(totalPillsInput) ?? parsedDetails.totalPillsInPackage;

    if (!parsedPillsPerDose || parsedPillsPerDose <= 0) {
      setPlanError("กรุณาระบุจำนวนเม็ดที่กินต่อครั้งให้ถูกต้อง");
      return;
    }

    if (medicationType === "prescription" && (!parsedTotalPills || parsedTotalPills <= 0)) {
      setPlanError("ยาตามแพทย์สั่งต้องระบุจำนวนเม็ดยาทั้งหมดในซองก่อนยืนยัน");
      return;
    }

    if (medicationType === "otc" && !otcReminderUntilDate) {
      setPlanError("กรุณาเลือกวันที่สิ้นสุดการแจ้งเตือนสำหรับยาทั่วไป");
      return;
    }

    const summaryText = [
      `ชื่อยา ${parsedDetails.medicineNameEn || parsedDetails.medicineNameTh || medicineQuery}`,
      `ขนาดยา ${dosage}`,
      parsedTotalPills ? `จำนวนยาในซอง ${parsedTotalPills} เม็ด` : null,
      medicationType === "otc" ? `เตือนถึงวันที่ ${otcReminderUntilDate}` : "โหมดเตือนจนยาหมด",
      `ความมั่นใจ OCR ${Math.round(parsedDetails.confidence * 100)} เปอร์เซ็นต์`,
    ]
      .filter(Boolean)
      .join(" , ");

    if (voiceEnabled) {
      speakThai(`กรุณาทวนข้อมูลก่อนบันทึก ${summaryText} หากถูกต้องให้ยืนยัน`);
    }

    const accepted = typeof window === "undefined"
      ? true
      : window.confirm(
          `กรุณาทวนข้อมูลก่อนบันทึก\\n\\n${summaryText}\\n\\nกด \"ตกลง\" เพื่อยืนยันบันทึก หรือกด \"ยกเลิก\" เพื่อกลับไปแก้ไข`,
        );

    if (!accepted) {
      setPlanError("ยกเลิกการบันทึกชั่วคราว กรุณาตรวจสอบข้อมูลและยืนยันอีกครั้ง");
      return;
    }

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
          ocrRawText: parsedDetails.rawText || ocrText || undefined,
          medicationType,
          doctorOrderedDetected: parsedDetails.isDoctorPrescribed ?? null,
          totalPills: medicationType === "prescription" ? parsedTotalPills : null,
          pillsPerDose: parsedPillsPerDose,
          reminderMode: medicationType === "prescription" ? "until_exhausted" : "until_date",
          reminderUntilDate: medicationType === "otc" ? otcReminderUntilDate : null,
        }),
      });

      const payload = (await response.json()) as { error?: string; planId?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "ยืนยันและสร้างแผนยาไม่สำเร็จ");
      }

      setPlanSuccess("ยืนยันผลสแกนแล้ว และสร้างตารางยา/แจ้งเตือน SMS สำเร็จ");
      setStatus("บันทึกแผนยาเรียบร้อยแล้ว");
      router.refresh();
      if (voiceEnabled) {
        speakThai("บันทึกแผนยาเรียบร้อยแล้ว ระบบเตือนพร้อมใช้งาน");
      }
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "ยืนยันผลไม่สำเร็จ");
    } finally {
      setIsCreatingPlan(false);
    }
  }, [
    medicationType,
    ocrText,
    ocrValidation,
    otcReminderUntilDate,
    parsedDetails,
    patientId,
    pillsPerDoseInput,
    router,
    scanResult,
    totalPillsInput,
    voiceEnabled,
  ]);

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
      if (cancelled || isFinalizingRef.current) {
        return;
      }

      if (ocrBusyRef.current) {
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
        const safety = evaluateScanSafety(capture.canvas, normalizedText);
        setScanSafety(safety);

        let completion = 0;
        completion += nextGuidance === "hold_steady" ? 40 : 18;
        completion += Math.min(25, Math.round((Math.min(normalizedText.length, 90) / 90) * 25));
        completion += Math.min(26, Math.round((Math.min(ocr.confidence, 1) / 1) * 26));
        completion += Math.round(safety.overallScore * 22);
        if (safety.hasEnglishName) completion += 8;
        if (safety.hasThaiName) completion += 8;
        if (safety.nameClarityScore >= 0.62) completion += 6;
        const boundedCompletionRaw = Math.min(99, completion);
        const boundedCompletion = safety.blockingIssue
          ? Math.min(AUTO_FINALIZE_MIN_COMPLETION - 1, boundedCompletionRaw)
          : boundedCompletionRaw;
        setScanCompletion((previous) => {
          const smoothed = Math.round(previous * 0.5 + boundedCompletion * 0.5);
          return Math.max(previous > 85 ? previous - 1 : 0, smoothed);
        });

        const currentCandidate: ScanCandidate = {
          text: normalizedText,
          previewDataUrl: capture.previewDataUrl,
          completion: boundedCompletionRaw,
          confidence: ocr.confidence,
        };

        if (safety.blockingIssue) {
          stableCandidateCountRef.current = 0;
          lastCandidateFingerprintRef.current = "";
          announceSafetyIssue(safety);
          return;
        }

        const best = bestCandidateRef.current;
        if (
          !best ||
          currentCandidate.completion > best.completion + 3 ||
          (currentCandidate.completion >= best.completion - 2 &&
            currentCandidate.confidence > best.confidence + 0.03)
        ) {
          bestCandidateRef.current = currentCandidate;
        }

        const effectiveMinConfidence =
          boundedCompletionRaw >= 90 && safety.nameClarityScore >= 0.62
            ? Math.min(AUTO_FINALIZE_MIN_CONFIDENCE, 0.02)
            : AUTO_FINALIZE_MIN_CONFIDENCE;

        const canAutoFinalize =
          normalizedText.length >= AUTO_FINALIZE_MIN_TEXT_LENGTH &&
          ocr.confidence >= effectiveMinConfidence &&
          boundedCompletionRaw >= AUTO_FINALIZE_MIN_COMPLETION &&
          safety.overallScore >= AUTO_FINALIZE_MIN_SAFETY_SCORE &&
          (safety.hasEnglishName || safety.hasThaiName || safety.nameClarityScore >= 0.62);

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

        if (canAutoFinalize && stableCandidateCountRef.current >= AUTO_FINALIZE_STABLE_FRAMES) {
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
    announceSafetyIssue,
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
  const canSubmitByMedicationType = useMemo(() => {
    const pillsPerDose = parsePositiveNumber(pillsPerDoseInput) ?? parsedDetails?.quantityPerDoseValue ?? 1;
    if (!pillsPerDose || pillsPerDose <= 0) return false;

    if (medicationType === "prescription") {
      const totalPills = parsePositiveInt(totalPillsInput) ?? parsedDetails?.totalPillsInPackage ?? null;
      return Boolean(totalPills && totalPills > 0);
    }

    return Boolean(otcReminderUntilDate);
  }, [
    medicationType,
    otcReminderUntilDate,
    parsedDetails?.quantityPerDoseValue,
    parsedDetails?.totalPillsInPackage,
    pillsPerDoseInput,
    totalPillsInput,
  ]);
  const externalInfo =
    scanResult && "externalInfo" in scanResult ? scanResult.externalInfo ?? null : null;

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
              {scanSafety ? (
                <>
                  <Badge variant="outline">แสง {Math.round(scanSafety.quality.brightness * 100)}%</Badge>
                  <Badge variant="outline">คมชัด {Math.round(scanSafety.quality.sharpness * 100)}%</Badge>
                  <Badge variant="outline">
                    ชื่อยาไทย/EN {Math.round(scanSafety.nameClarityScore * 100)}%
                  </Badge>
                  {scanSafety.blockingIssue ? (
                    <Badge variant="destructive">ภาพหรือชื่อยาไม่ชัด กรุณาสแกนใหม่</Badge>
                  ) : null}
                </>
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
                  setOcrValidation(null);
                  setPlanError(null);
                  setPlanSuccess(null);
                  setLastDetectedBarcode(null);
                  setScanCompletion(0);
                  setMedicationType("prescription");
                  setTotalPillsInput("");
                  setPillsPerDoseInput("1");
                  setOtcReminderUntilDate(formatDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
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
                aria-label="เริ่มสแกนยาด้วยกล้อง"
                data-voice-action="start-med-camera-scan"
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
                {ocrValidation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ocrValidation.canConfirm ? "default" : "destructive"}>
                      ตรวจสอบความน่าเชื่อถือ {Math.round(ocrValidation.score * 100)}%
                    </Badge>
                  </div>
                ) : null}

                {ocrValidation && !ocrValidation.canConfirm ? (
                  <Alert variant="destructive">
                    <AlertTitle>ยังไม่อนุญาตให้ยืนยันผล</AlertTitle>
                    <AlertDescription>
                      {ocrValidation.messageTh} กรุณาสแกนใหม่ด้วยภาพที่สว่างและคมชัดกว่าเดิม
                    </AlertDescription>
                  </Alert>
                ) : null}

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
                    <span className="text-muted-foreground">จำนวนเม็ดในซอง (OCR): </span>
                    <strong>{parsedDetails.totalPillsInPackage ? `${parsedDetails.totalPillsInPackage} เม็ด` : "-"}</strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ความถี่ต่อวัน: </span>
                    <strong>
                      {parsedDetails.frequencyPerDay ? `${parsedDetails.frequencyPerDay} ครั้ง` : "-"}
                    </strong>
                  </p>
                  <p>
                    <span className="text-muted-foreground">สถานะยาตามแพทย์สั่ง: </span>
                    <strong>
                      {parsedDetails.isDoctorPrescribed === true
                        ? "พบข้อความยาตามแพทย์สั่ง"
                        : parsedDetails.isDoctorPrescribed === false
                          ? "ไม่พบข้อความบังคับแพทย์สั่ง"
                          : "ยังไม่แน่ชัด"}
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
                <div className="space-y-3 rounded-md border bg-cyan-50/40 p-3">
                  <p className="text-sm font-semibold">ตั้งค่านโยบายแจ้งเตือนตามชนิดยา</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="medicationType">ชนิดยา</Label>
                      <select
                        id="medicationType"
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={medicationType}
                        onChange={(event) => setMedicationType(event.target.value as MedicationTypeChoice)}
                        disabled={isCreatingPlan}
                      >
                        <option value="prescription">ยาตามแพทย์สั่ง (เตือนจนยาหมด)</option>
                        <option value="otc">ยาทั่วไป (กำหนดวันสิ้นสุดเตือนได้)</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        ระบบตรวจจับจากฉลาก:{" "}
                        {parsedDetails.isDoctorPrescribed === true
                          ? "พบข้อความยาตามแพทย์สั่ง"
                          : parsedDetails.isDoctorPrescribed === false
                            ? "ไม่พบข้อความบังคับแพทย์สั่ง"
                            : "ยังไม่แน่ชัด"}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pillsPerDoseInput">จำนวนเม็ดต่อครั้ง</Label>
                      <Input
                        id="pillsPerDoseInput"
                        type="number"
                        min="0.25"
                        step="0.25"
                        value={pillsPerDoseInput}
                        onChange={(event) => setPillsPerDoseInput(event.target.value)}
                        disabled={isCreatingPlan}
                        placeholder="เช่น 1"
                      />
                    </div>
                  </div>

                  {medicationType === "prescription" ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="totalPillsInput">จำนวนเม็ดยาในซอง</Label>
                        <Input
                          id="totalPillsInput"
                          type="number"
                          min="1"
                          step="1"
                          value={totalPillsInput}
                          onChange={(event) => setTotalPillsInput(event.target.value)}
                          disabled={isCreatingPlan}
                          placeholder="เช่น 180"
                        />
                        <p className="text-xs text-muted-foreground">
                          OCR ตรวจพบ:{" "}
                          {parsedDetails.totalPillsInPackage ? `${parsedDetails.totalPillsInPackage} เม็ด` : "-"}
                        </p>
                      </div>
                      <div className="rounded-md border bg-background/70 p-3 text-xs text-muted-foreground">
                        เมื่อยืนยันแล้ว ระบบจะสร้างแจ้งเตือนต่อเนื่องตามเวลาในแผนยา จนจำนวนเม็ดคงเหลือเป็น 0
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="otcReminderUntilDate">แจ้งเตือนถึงวันที่</Label>
                        <Input
                          id="otcReminderUntilDate"
                          type="date"
                          value={otcReminderUntilDate}
                          onChange={(event) => setOtcReminderUntilDate(event.target.value)}
                          disabled={isCreatingPlan}
                        />
                      </div>
                      <div className="rounded-md border bg-background/70 p-3 text-xs text-muted-foreground">
                        ยาทั่วไปไม่จำเป็นต้องเตือนจนยาหมด สามารถกำหนดวันสิ้นสุดการเตือนได้ตามต้องการ
                      </div>
                    </div>
                  )}
                </div>
                {externalInfo ? (
                  <div className="space-y-2 rounded-md border bg-cyan-50/60 p-3">
                    <p className="text-sm font-semibold">ข้อมูลยาจริงจากฐานข้อมูลภายนอก</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <p>
                        <span className="text-muted-foreground">ชื่อยาที่เทียบได้ (EN): </span>
                        <strong>{externalInfo.matchedNameEn}</strong>
                      </p>
                      <p>
                        <span className="text-muted-foreground">ชื่อยาภาษาไทย: </span>
                        <strong>{externalInfo.matchedNameTh || "-"}</strong>
                      </p>
                      <p>
                        <span className="text-muted-foreground">ตัวยาสำคัญ (Generic): </span>
                        <strong>{externalInfo.genericNameEn || "-"}</strong>
                      </p>
                      <p>
                        <span className="text-muted-foreground">ความตรงกับผลสแกน: </span>
                        <strong>{Math.round(externalInfo.matchScore * 100)}%</strong>
                      </p>
                    </div>
                    <p>
                      <span className="text-muted-foreground">ยานี้ทำอะไร: </span>
                      <strong>{externalInfo.indicationTh || "-"}</strong>
                    </p>
                    {externalInfo.symptomTagsTh.length ? (
                      <p>
                        <span className="text-muted-foreground">อาการที่ช่วยบรรเทา: </span>
                        <strong>{externalInfo.symptomTagsTh.join(", ")}</strong>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    onClick={() => void confirmAndCreateMedicationPlan()}
                    disabled={isCreatingPlan || !ocrValidation?.canConfirm || !canSubmitByMedicationType}
                    aria-label="ยืนยันผลยาและบันทึกแผนยา"
                    data-voice-action="confirm-med-plan"
                  >
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
