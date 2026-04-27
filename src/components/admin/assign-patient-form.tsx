"use client";

import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const AssignPatientForm = () => {
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/assign-patient-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        doctorId,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "จับคู่ไม่สำเร็จ");
      return;
    }

    setMessage("จับคู่ patient-doctor สำเร็จ");
    setPatientId("");
    setDoctorId("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-cyan-700" />
          Assign ผู้ป่วยให้คุณหมอ
        </CardTitle>
        <CardDescription>เชื่อมผู้ป่วยกับหมอเพื่อเปิดสิทธิ์ติดตามผล</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="assign-patient-id">Patient ID</Label>
          <Input
            id="assign-patient-id"
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="assign-doctor-id">Doctor ID</Label>
          <Input
            id="assign-doctor-id"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={loading || !patientId || !doctorId}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span>{loading ? "กำลังจับคู่..." : "จับคู่ผู้ป่วย-หมอ"}</span>
        </Button>
      </CardContent>
    </Card>
  );
};
