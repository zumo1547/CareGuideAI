"use client";

import { Loader2, MessageCircleHeart, RefreshCcw, Send, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  SupportCaseMessage,
  SupportCaseStatus,
  SupportCaseSummary,
} from "@/types/support-case";

interface DoctorOption {
  id: string;
  fullName: string;
  phone: string | null;
}

interface PatientSupportDeskProps {
  patientId: string;
  doctorOptions: DoctorOption[];
}

const statusLabel: Record<SupportCaseStatus, string> = {
  pending: "รอหมอตอบรับ",
  active: "กำลังคุย",
  closed: "ปิดเคสแล้ว",
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

const chooseDefaultCaseId = (
  cases: SupportCaseSummary[],
  currentId: string | null,
) => {
  if (currentId && cases.some((item) => item.id === currentId)) {
    return currentId;
  }
  const active = cases.find((item) => item.status === "active");
  if (active) return active.id;
  const pending = cases.find((item) => item.status === "pending");
  if (pending) return pending.id;
  return cases[0]?.id ?? null;
};

export const PatientSupportDesk = ({ patientId, doctorOptions }: PatientSupportDeskProps) => {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current == null) {
    supabaseRef.current = createSupabaseBrowserClient();
  }

  const [cases, setCases] = useState<SupportCaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportCaseMessage[]>([]);
  const [isLoadingCases, setLoadingCases] = useState(true);
  const [isLoadingMessages, setLoadingMessages] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctorOptions[0]?.id ?? "");
  const [chatInput, setChatInput] = useState("");
  const [isCreatingCase, setCreatingCase] = useState(false);
  const [isSendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  const refreshCases = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoadingCases(true);
      }

      try {
        const response = await fetch("/api/support/cases", {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          error?: string;
          cases?: SupportCaseSummary[];
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "โหลดเคสไม่สำเร็จ");
        }

        const nextCases = payload.cases ?? [];
        setCases(nextCases);
        setSelectedCaseId((currentId) => chooseDefaultCaseId(nextCases, currentId));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "โหลดเคสไม่สำเร็จ");
      } finally {
        setLoadingCases(false);
      }
    },
    [],
  );

  const refreshMessages = useCallback(async (caseId: string) => {
    setLoadingMessages(true);
    try {
      const response = await fetch(`/api/support/cases/${caseId}/messages`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        messages?: SupportCaseMessage[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "โหลดข้อความไม่สำเร็จ");
      }

      setMessages(payload.messages ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อความไม่สำเร็จ");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const createCase = async () => {
    if (!selectedDoctorId || requestMessage.trim().length < 3) {
      setError("กรุณาระบุข้อความอย่างน้อย 3 ตัวอักษร");
      return;
    }

    setCreatingCase(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/support/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedDoctorId: selectedDoctorId,
          requestMessage: requestMessage.trim(),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "ส่งคำร้องไม่สำเร็จ");
      }

      setRequestMessage("");
      setSuccess("ส่งคำร้องถึงคุณหมอแล้ว รอคุณหมอตอบรับเพื่อเริ่มแชท");
      await refreshCases(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "ส่งคำร้องไม่สำเร็จ");
    } finally {
      setCreatingCase(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedCase || !chatInput.trim()) return;

    setSendingMessage(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/support/cases/${selectedCase.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: chatInput.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "ส่งข้อความไม่สำเร็จ");
      }

      setChatInput("");
      await refreshMessages(selectedCase.id);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSendingMessage(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCases();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshCases]);

  useEffect(() => {
    if (!selectedCaseId) return;
    const timer = window.setTimeout(() => {
      void refreshMessages(selectedCaseId);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshMessages, selectedCaseId]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    const casesChannel = supabase
      .channel(`patient-support-cases-${patientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_cases",
          filter: `patient_id=eq.${patientId}`,
        },
        () => {
          void refreshCases(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(casesChannel);
    };
  }, [patientId, refreshCases]);

  useEffect(() => {
    const caseId = selectedCaseId;
    const supabase = supabaseRef.current;
    if (!caseId || !supabase) return;

    const messagesChannel = supabase
      .channel(`patient-support-messages-${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_case_messages",
          filter: `case_id=eq.${caseId}`,
        },
        () => {
          void refreshMessages(caseId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(messagesChannel);
    };
  }, [refreshMessages, selectedCaseId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircleHeart className="h-5 w-5 text-cyan-700" />
          ระบบคุยกับคุณหมอแบบเรียลไทม์
        </CardTitle>
        <CardDescription>
          เริ่มจากส่งคำร้องขอความช่วยเหลือ แล้วรอคุณหมอรับเคสก่อนเปิดห้องแชท
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        {!doctorOptions.length ? (
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>ยังไม่พบคุณหมอที่ดูแล</AlertTitle>
            <AlertDescription>
              กรุณาติดต่อแอดมินเพื่อผูกผู้ป่วยกับคุณหมอก่อนใช้งานระบบช่วยเหลือ
            </AlertDescription>
          </Alert>
        ) : (
          <section className="space-y-3 rounded-xl border p-3">
            <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="doctor-select">เลือกคุณหมอ</Label>
                <select
                  id="doctor-select"
                  value={selectedDoctorId}
                  onChange={(event) => setSelectedDoctorId(event.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {doctorOptions.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="request-message">ข้อความร้องขอ</Label>
                <Textarea
                  id="request-message"
                  rows={3}
                  value={requestMessage}
                  onChange={(event) => setRequestMessage(event.target.value)}
                  placeholder="เช่น วิงเวียนหลังทานยา อยากปรึกษาคุณหมอด่วน"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={() => void createCase()}
                  disabled={isCreatingCase || requestMessage.trim().length < 3}
                  className="w-full md:w-auto"
                >
                  {isCreatingCase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  ส่งคำร้อง
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">เคสของฉัน</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshCases()} disabled={isLoadingCases}>
              {isLoadingCases ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              รีเฟรช
            </Button>
          </div>
          {isLoadingCases ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดรายการเคส...</p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีเคสที่ส่งถึงคุณหมอ</p>
          ) : (
            <div className="space-y-2">
              {cases.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    item.id === selectedCaseId ? "border-cyan-500 bg-cyan-50" : "hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedCaseId(item.id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{item.requestedDoctor?.fullName ?? "คุณหมอ"}</p>
                    <Badge variant={item.status === "active" ? "default" : "secondary"}>
                      {statusLabel[item.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.requestMessage}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    ส่งเมื่อ {formatDateTime(item.requestedAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        {selectedCase ? (
          <section className="space-y-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  ห้องแชทกับ {selectedCase.assignedDoctor?.fullName ?? selectedCase.requestedDoctor?.fullName ?? "คุณหมอ"}
                </p>
                <p className="text-xs text-muted-foreground">
                  สถานะ: {statusLabel[selectedCase.status]} | อัปเดตล่าสุด {formatDateTime(selectedCase.updatedAt)}
                </p>
              </div>
              <Badge variant={selectedCase.status === "active" ? "default" : "outline"}>
                {statusLabel[selectedCase.status]}
              </Badge>
            </div>

            {selectedCase.status === "pending" ? (
              <Alert>
                <AlertTitle>รอคุณหมอตอบรับเคส</AlertTitle>
                <AlertDescription>
                  ตอนนี้ยังอยู่ในคิวของคุณหมอ เมื่อคุณหมอตอบรับแล้วจะส่งข้อความได้ทันทีแบบเรียลไทม์
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
              <div className="rounded-lg bg-white p-3 text-sm shadow-sm">
                <p className="font-medium">คำร้องเริ่มต้น</p>
                <p className="mt-1 whitespace-pre-wrap">{selectedCase.requestMessage}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ส่งเมื่อ {formatDateTime(selectedCase.requestedAt)}
                </p>
              </div>

              {isLoadingMessages ? (
                <p className="text-sm text-muted-foreground">กำลังโหลดข้อความ...</p>
              ) : (
                messages.map((message) => {
                  const isMine = message.senderId === patientId;
                  return (
                    <div
                      key={message.id}
                      className={`max-w-[90%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        isMine
                          ? "ml-auto bg-cyan-600 text-white"
                          : "mr-auto bg-white text-slate-900"
                      }`}
                    >
                      <p className={`text-xs ${isMine ? "text-cyan-100" : "text-muted-foreground"}`}>
                        {message.senderName}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{message.message}</p>
                      <p className={`mt-1 text-[11px] ${isMine ? "text-cyan-100" : "text-muted-foreground"}`}>
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={
                  selectedCase.status === "active"
                    ? "พิมพ์ข้อความถึงคุณหมอ"
                    : "ส่งข้อความได้เมื่อคุณหมอตอบรับเคสแล้ว"
                }
                disabled={selectedCase.status !== "active" || isSendingMessage}
              />
              <Button
                type="button"
                onClick={() => void sendMessage()}
                disabled={selectedCase.status !== "active" || !chatInput.trim() || isSendingMessage}
              >
                {isSendingMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                ส่ง
              </Button>
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
};
