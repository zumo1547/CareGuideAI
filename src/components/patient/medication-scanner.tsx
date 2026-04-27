"use client";

import { Camera, Loader2, ScanLine } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guidanceToThaiSpeech } from "@/lib/scan/guidance";
import { speakThai } from "@/lib/voice/speak";
import type { ScanGuidanceState } from "@/types/domain";

interface ScanResponse {
  guidance: ScanGuidanceState;
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

const COOL_DOWN_MS = 2500;

export const MedicationScanner = ({ patientId }: MedicationScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetector | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSpokenAtRef = useRef(0);
  const lastScannedAtRef = useRef(0);
  const [status, setStatus] = useState("พร้อมสแกน");
  const [guidance, setGuidance] = useState<ScanGuidanceState>("move_closer");
  const [manualBarcode, setManualBarcode] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResponse | OcrResponse | null>(null);
  const isBarcodeDetectorSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  const speakGuidance = useCallback((nextGuidance: ScanGuidanceState) => {
    const now = Date.now();
    if (now - lastSpokenAtRef.current < 1400) return;
    lastSpokenAtRef.current = now;
    speakThai(guidanceToThaiSpeech(nextGuidance), 1.02);
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

      setGuidance(result.guidance);
      setScanResult(result);
      speakGuidance(result.guidance);
      if (result.foundMedicine && result.medicine?.name) {
        speakThai(`พบยา ${result.medicine.name} สแกนเสร็จสิ้นแล้ว`);
      }
    },
    [patientId, speakGuidance],
  );

  const scanManualBarcode = async () => {
    if (!manualBarcode.trim()) return;
    setLoading(true);
    setStatus("กำลังตรวจสอบบาร์โค้ด...");
    try {
      await callBarcodeApi({ barcode: manualBarcode.trim() });
      setStatus("สแกนบาร์โค้ดสำเร็จ");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "สแกนไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const scanViaOcrFallback = async () => {
    if (!ocrText.trim()) return;
    setLoading(true);
    setStatus("กำลังวิเคราะห์ฉลากยา...");
    const response = await fetch("/api/scan/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        extractedText: ocrText,
      }),
    });
    const result = (await response.json()) as OcrResponse & { error?: string };
    setLoading(false);

    if (!response.ok) {
      setStatus(result.error ?? "วิเคราะห์ OCR ไม่สำเร็จ");
      return;
    }

    setGuidance(result.guidance);
    setScanResult(result);
    setStatus(result.foundMedicine ? "พบข้อมูลยาแล้ว" : "ยังไม่พบยา ลองพิมพ์ชื่อยาละเอียดขึ้น");
    speakGuidance(result.guidance);
    if (result.foundMedicine && result.medicine?.name) {
      speakThai(`จับคู่ได้กับยา ${result.medicine.name}`);
    }
  };

  useEffect(() => {
    if (!isBarcodeDetectorSupported) {
      return;
    }

    const startScanner = async () => {
      if (!videoRef.current) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const Detector = window.BarcodeDetector;
        if (!Detector) {
          setStatus("BarcodeDetector ไม่พร้อมใช้งาน");
          return;
        }

        detectorRef.current = new Detector({
          formats: ["qr_code", "ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
        });

        timerRef.current = window.setInterval(async () => {
          if (!detectorRef.current || !videoRef.current) return;
          try {
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (!barcodes.length) {
              setGuidance("move_closer");
              speakGuidance("move_closer");
              return;
            }

            const current = barcodes[0];
            if (!current.rawValue || !current.boundingBox) return;
            const now = Date.now();
            if (now - lastScannedAtRef.current < COOL_DOWN_MS) return;
            lastScannedAtRef.current = now;

            const frame = {
              frameWidth: videoRef.current.videoWidth || 1,
              frameHeight: videoRef.current.videoHeight || 1,
              x: current.boundingBox.x,
              y: current.boundingBox.y,
              width: current.boundingBox.width,
              height: current.boundingBox.height,
            };

            await callBarcodeApi({
              barcode: current.rawValue,
              frame,
            });
            setStatus("จับบาร์โค้ดได้แล้ว");
          } catch {
            setStatus("กำลังอ่านภาพจากกล้อง...");
          }
        }, 850);
      } catch {
        setStatus("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตสิทธิ์กล้อง");
      }
    };

    void startScanner();

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [callBarcodeApi, isBarcodeDetectorSupported, speakGuidance]);

  const guidanceLabel = useMemo(() => guidanceToThaiSpeech(guidance), [guidance]);
  const resolvedStatus = isBarcodeDetectorSupported
    ? status
    : "เบราว์เซอร์นี้ไม่รองรับ BarcodeDetector ใช้โหมดกรอกโค้ดแทน";

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

        {isBarcodeDetectorSupported ? (
          <div className="overflow-hidden rounded-xl border bg-black">
            <video ref={videoRef} className="h-72 w-full object-cover" muted playsInline />
          </div>
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
