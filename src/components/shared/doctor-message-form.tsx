"use client";

import { Loader2, MessageSquare } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface DoctorMessageFormProps {
  defaultDoctorId?: string;
  defaultPatientId?: string;
  heading?: string;
}

export const DoctorMessageForm = ({
  defaultDoctorId,
  defaultPatientId,
  heading = "ส่งข้อความถึงคุณหมอ",
}: DoctorMessageFormProps) => {
  const [doctorId, setDoctorId] = useState(defaultDoctorId ?? "");
  const [patientId, setPatientId] = useState(defaultPatientId ?? "");
  const [subject, setSubject] = useState("ติดตามอาการ");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSending, setSending] = useState(false);

  const onSubmit = async () => {
    if (!doctorId || !message.trim()) return;
    setSending(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/doctor/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doctorId,
        patientId: patientId || undefined,
        subject,
        message,
      }),
    });

    const payload = (await response.json()) as { error?: string };
    setSending(false);
    if (!response.ok) {
      setError(payload.error ?? "ส่งข้อความไม่สำเร็จ");
      return;
    }

    setSuccess("ส่งข้อความแล้ว");
    setMessage("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {heading}
        </CardTitle>
        <CardDescription>ใช้ส่งอาการหรือคำถามเพื่อให้หมอติดตามผล</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>ส่งไม่สำเร็จ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="doctorId">Doctor ID</Label>
            <Input id="doctorId" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="patientId">Patient ID (สำหรับหมอตอบกลับ)</Label>
            <Input id="patientId" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="subject">หัวข้อ</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">ข้อความ</Label>
          <Textarea
            id="message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="กรอกอาการหรือคำถาม"
          />
        </div>
        <Button type="button" onClick={onSubmit} disabled={isSending || !doctorId || !message.trim()}>
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span>{isSending ? "กำลังส่ง..." : "ส่งข้อความ"}</span>
        </Button>
      </CardContent>
    </Card>
  );
};
