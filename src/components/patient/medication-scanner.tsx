"use client";

import type { IScannerControls } from "@zxing/browser";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guidanceToThaiSpeech, type DetectionFrame } from "@/lib/scan/guidance";
import { speakThai, warmupSpeechSynthesis } from "@/lib/voice/speak";
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

interface OcrResponse {
  guidance: ScanGuidanceState;
  foundMedicine: boolean;
  medicine?: {
    id: string;
    name: string;
    strength: string | null;
  };
  ocrText?: string;
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

const COOL_DOWN_MS = 2500;
const DETECT_INTERVAL_MS = 1000;
const SPEAK_COOLDOWN_MS = 1400;

const preferredVideoConstraints = (): MediaTrackConstraints => ({
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
});

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

export const MedicationScanner = ({ patientId }: MedicationScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const timerRef = useRef<number | null>(null);
  const inflightDetectRef = useRef(false);
  const isScanningRef = useRef(false);
  const lastSpokenAtRef = useRef(0);
  const lastScannedAtRef = useRef(0);
  const lastGuidanceRef = useRef<ScanGuidanceState>("move_closer");

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

  const isCameraSupported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBarcodeDetectorSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  const updateGuidance = useCallback((nextGuidance: ScanGuidanceState, forceSpeak = false) => {
    setGuidance((previous) => (previous === nextGuidance ? previous : nextGuidance));

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
  }, [voiceEnabled]);

  const stopScanner = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

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

  const scanViaOcrFallback = async () => {
    if (!ocrText.trim()) return;

    setLoading(true);
    setStatus("กำลังวิเคราะห์ฉลากยา...");

    try {
      const response = await fetch("/api/scan/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          extractedText: ocrText,
        }),
      });

      const result = (await response.json()) as OcrResponse & { error?: string };

      if (!response.ok) {
        setStatus(result.error ?? "วิเคราะห์ OCR ไม่สำเร็จ");
        return;
      }

      updateGuidance(result.guidance);
      setScanResult(result);
      setStatus(
        result.foundMedicine
          ? "พบข้อมูลยาแล้ว"
          : "ยังไม่พบยา ลองพิมพ์ชื่อยาให้ละเอียดขึ้น",
      );

      if (voiceEnabled && result.foundMedicine && result.medicine?.name) {
        speakThai(`จับคู่ได้กับยา ${result.medicine.name}`);
      }
    } catch {
      setStatus("วิเคราะห์ OCR ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

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

    const onVisibilityChange = () => {
      if (!document.hidden) return;
      setStatus("หยุดสแกนชั่วคราวเมื่อออกจากหน้าจอ");
      setIsScanning(false);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isScanning]);

  useEffect(() => () => stopScanner(), [stopScanner]);

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

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScanLine className="h-5 w-5" />
          สแกนยาแบบ Hybrid
        </CardTitle>
        <CardDescription>
          ระบบจะช่วยบอกทิศทางด้วยเสียงเพื่อให้สแกนยาได้ถูกต้อง (ไทยเป็นหลัก)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>สถานะสแกน</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{resolvedStatus}</p>
            <Badge variant="secondary">{guidanceLabel}</Badge>
          </AlertDescription>
        </Alert>

        {isCameraSupported ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setScanResult(null);
                  setLastDetectedBarcode(null);
                  setStatus("กำลังเตรียมกล้อง...");
                  warmupSpeechSynthesis();
                  updateGuidance("move_closer", true);
                  if (voiceEnabled) {
                    speakThai("เริ่มสแกนยาแล้ว กรุณาหันกล้องไปที่บาร์โค้ดยา", 1);
                  }
                  setIsScanning(true);
                }}
                disabled={isScanning || isStartingCamera}
              >
                {isStartingCamera ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                <span>{isStartingCamera ? "กำลังเปิดกล้อง" : "เริ่มสแกนด้วยกล้อง"}</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  stopScanner();
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
              <div className="overflow-hidden rounded-xl border bg-black">
                <video ref={videoRef} className="h-72 w-full object-cover" muted playsInline />
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
            <Label htmlFor="ocrText">OCR fallback (พิมพ์ข้อความบนกล่องยา)</Label>
            <Input
              id="ocrText"
              value={ocrText}
              onChange={(event) => setOcrText(event.target.value)}
              placeholder="เช่น Paracetamol 500 mg"
            />
            <Button variant="outline" onClick={scanViaOcrFallback} disabled={loading || !ocrText.trim()}>
              วิเคราะห์ OCR
            </Button>
          </div>
        </div>

        {lastDetectedBarcode && !scanResult?.medicine ? (
          <Alert>
            <AlertTitle>ยืนยันการสแกนแล้ว</AlertTitle>
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
      </CardContent>
    </Card>
  );
};
