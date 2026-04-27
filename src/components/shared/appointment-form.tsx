"use client";

import { CalendarClock, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface AppointmentFormProps {
  defaultDoctorId?: string;
}

export const AppointmentForm = ({ defaultDoctorId }: AppointmentFormProps) => {
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doctorId,
        scheduledAt: scheduledAt || null,
        requestNote,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "สร้างคำขอนัดหมายไม่สำเร็จ");
      return;
    }

    setMessage("ส่งคำขอนัดหมายเรียบร้อย");
    setScheduledAt("");
    setRequestNote("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          ขอนัดหมายแพทย์
        </CardTitle>
        <CardDescription>สร้างคำขอนัดหมายพร้อมบันทึกอาการ</CardDescription>
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
          <Label htmlFor="appointment-doctor-id">Doctor ID</Label>
          <Input
            id="appointment-doctor-id"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="appointment-time">เวลาที่สะดวก (optional)</Label>
          <Input
            id="appointment-time"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="appointment-note">อาการหรือสิ่งที่ต้องการปรึกษา</Label>
          <Textarea
            id="appointment-note"
            rows={4}
            value={requestNote}
            onChange={(event) => setRequestNote(event.target.value)}
          />
        </div>
        <Button type="button" onClick={submit} disabled={loading || !doctorId}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span>{loading ? "กำลังส่ง..." : "ส่งคำขอนัดหมาย"}</span>
        </Button>
      </CardContent>
    </Card>
  );
};
