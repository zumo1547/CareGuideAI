"use client";

import { Loader2, MailPlus } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const InviteDoctorForm = () => {
  const [email, setEmail] = useState("");
  const [expiresHours, setExpiresHours] = useState("72");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setToken(null);

    const response = await fetch("/api/admin/invite-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        expiresInHours: Number(expiresHours),
      }),
    });

    const payload = (await response.json()) as { error?: string; inviteToken?: string };
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "ส่งคำเชิญไม่สำเร็จ");
      return;
    }

    setToken(payload.inviteToken ?? null);
    setEmail("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailPlus className="h-5 w-5 text-cyan-700" />
          Invite คุณหมอ
        </CardTitle>
        <CardDescription>เฉพาะแอดมินที่สามารถออก token เชิญหมอได้</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {token ? (
          <Alert>
            <AlertTitle>สร้าง token สำเร็จ</AlertTitle>
            <AlertDescription className="break-all">
              Invite token: <strong>{token}</strong>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="doctor-email">อีเมลหมอ</Label>
          <Input
            id="doctor-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expires-hours">หมดอายุภายใน (ชั่วโมง)</Label>
          <Input
            id="expires-hours"
            value={expiresHours}
            onChange={(event) => setExpiresHours(event.target.value)}
          />
        </div>
        <Button onClick={submit} disabled={loading || !email.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          <span>{loading ? "กำลังสร้าง..." : "สร้างคำเชิญหมอ"}</span>
        </Button>
      </CardContent>
    </Card>
  );
};
