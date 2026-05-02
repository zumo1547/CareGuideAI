"use client";

import { CheckCircle2, Loader2, MessageCircle, RefreshCcw, Send, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  SupportCaseMessage,
  SupportCaseStatus,
  SupportCaseSummary,
} from "@/types/support-case";

interface DoctorSupportDeskProps {
  doctorId: string;
}

interface SupportApiErrorPayload {
  error?: string;
  code?: string;
  schemaReloadSql?: string;
}

const statusLabel: Record<SupportCaseStatus, string> = {
  pending: "รอตอบรับ",
  active: "กำลังดูแล",
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

const getErrorMessage = (payload: SupportApiErrorPayload | null, fallback: string) =>
  payload?.error ?? fallback;

export const DoctorSupportDesk = ({ doctorId }: DoctorSupportDeskProps) => {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current == null) {
    supabaseRef.current = createSupabaseBrowserClient();
  }

  const [cases, setCases] = useState<SupportCaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportCaseMessage[]>([]);
  const [isLoadingCases, setLoadingCases] = useState(true);
  const [isLoadingMessages, setLoadingMessages] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isSendingMessage, setSendingMessage] = useState(false);
  const [isAcceptingCaseId, setAcceptingCaseId] = useState<string | null>(null);
  const [isClosingCaseId, setClosingCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [schemaReloadSql, setSchemaReloadSql] = useState<string | null>(null);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  const pendingCases = useMemo(() => cases.filter((item) => item.status === "pending"), [cases]);
  const activeCases = useMemo(() => cases.filter((item) => item.status === "active"), [cases]);
  const closedCases = useMemo(() => cases.filter((item) => item.status === "closed"), [cases]);

  const handleSchemaCacheError = useCallback((payload: SupportApiErrorPayload | null) => {
    if (payload?.code === "SUPPORT_SCHEMA_CACHE_NOT_READY") {
      setSchemaReloadSql(payload.schemaReloadSql ?? "NOTIFY pgrst, 'reload schema';");
    }
  }, []);

  const refreshCases = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoadingCases(true);
      }
      try {
        setSchemaReloadSql(null);
        const response = await fetch("/api/support/cases", {
          cache: "no-store",
        });
        const payload = (await response.json()) as SupportApiErrorPayload & {
          cases?: SupportCaseSummary[];
        };
        if (!response.ok) {
          handleSchemaCacheError(payload);
          throw new Error(getErrorMessage(payload, "โหลดเคสไม่สำเร็จ"));
        }

        const nextCases = payload.cases ?? [];
        setCases(nextCases);
        setSelectedCaseId((current) => chooseDefaultCaseId(nextCases, current));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "โหลดเคสไม่สำเร็จ");
      } finally {
        setLoadingCases(false);
      }
    },
    [handleSchemaCacheError],
  );

  const refreshMessages = useCallback(
    async (caseId: string) => {
      setLoadingMessages(true);
      try {
        setSchemaReloadSql(null);
        const response = await fetch(`/api/support/cases/${caseId}/messages`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as SupportApiErrorPayload & {
          messages?: SupportCaseMessage[];
        };
        if (!response.ok) {
          handleSchemaCacheError(payload);
          throw new Error(getErrorMessage(payload, "โหลดข้อความไม่สำเร็จ"));
        }
        setMessages(payload.messages ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "โหลดข้อความไม่สำเร็จ");
      } finally {
        setLoadingMessages(false);
      }
    },
    [handleSchemaCacheError],
  );

  const acceptCase = async (caseId: string) => {
    setAcceptingCaseId(caseId);
    setError(null);
    setSuccess(null);
    setSchemaReloadSql(null);
    try {
      const response = await fetch(`/api/support/cases/${caseId}/accept`, {
        method: "POST",
      });
      const payload = (await response.json()) as SupportApiErrorPayload;
      if (!response.ok) {
        handleSchemaCacheError(payload);
        throw new Error(getErrorMessage(payload, "รับเคสไม่สำเร็จ"));
      }
      setSuccess("รับเคสสำเร็จ สามารถเริ่มแชทกับผู้ป่วยได้ทันที");
      setSelectedCaseId(caseId);
      await refreshCases(true);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "รับเคสไม่สำเร็จ");
    } finally {
      setAcceptingCaseId(null);
    }
  };

  const closeCase = async (caseId: string) => {
    setClosingCaseId(caseId);
    setError(null);
    setSuccess(null);
    setSchemaReloadSql(null);
    try {
      const response = await fetch(`/api/support/cases/${caseId}/close`, {
        method: "POST",
      });
      const payload = (await response.json()) as SupportApiErrorPayload;
      if (!response.ok) {
        handleSchemaCacheError(payload);
        throw new Error(getErrorMessage(payload, "ปิดเคสไม่สำเร็จ"));
      }
      setSuccess("ปิดเคสเรียบร้อยแล้ว สามารถรับเคสถัดไปได้ทันที");
      await refreshCases(true);
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "ปิดเคสไม่สำเร็จ");
    } finally {
      setClosingCaseId(null);
    }
  };

  const sendMessage = async () => {
    if (!selectedCase || !chatInput.trim()) return;
    setSendingMessage(true);
    setError(null);
    setSuccess(null);
    setSchemaReloadSql(null);
    try {
      const response = await fetch(`/api/support/cases/${selectedCase.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput.trim() }),
      });
      const payload = (await response.json()) as SupportApiErrorPayload;
      if (!response.ok) {
        handleSchemaCacheError(payload);
        throw new Error(getErrorMessage(payload, "ส่งข้อความไม่สำเร็จ"));
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

    const byRequested = supabase
      .channel(`doctor-support-cases-requested-${doctorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_cases",
          filter: `requested_doctor_id=eq.${doctorId}`,
        },
        () => {
          void refreshCases(true);
        },
      )
      .subscribe();

    const byAssigned = supabase
      .channel(`doctor-support-cases-assigned-${doctorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "support_cases",
          filter: `assigned_doctor_id=eq.${doctorId}`,
        },
        () => {
          void refreshCases(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(byRequested);
      void supabase.removeChannel(byAssigned);
    };
  }, [doctorId, refreshCases]);

  useEffect(() => {
    const caseId = selectedCaseId;
    const supabase = supabaseRef.current;
    if (!caseId || !supabase) return;

    const messagesChannel = supabase
      .channel(`doctor-support-messages-${caseId}`)
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
          <MessageCircle className="h-5 w-5 text-cyan-700" />
          คิวเคสช่วยเหลือและแชทผู้ป่วยแบบเรียลไทม์
        </CardTitle>
        <CardDescription>
          คุณหมอสามารถดูข้อมูลผู้ป่วยก่อนรับเคส พูดคุยต่อเนื่อง และปิดเคสเมื่อเสร็จสิ้น
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              {schemaReloadSql ? (
                <p className="mt-2 text-xs">
                  SQL ที่ต้องรันใน Supabase SQL Editor: <code>{schemaReloadSql}</code>
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">รอรับเคส</p>
            <p className="text-2xl font-bold">{pendingCases.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">กำลังดูแล</p>
            <p className="text-2xl font-bold">{activeCases.length}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">ปิดเคสแล้ว</p>
            <p className="text-2xl font-bold">{closedCases.length}</p>
          </div>
        </section>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">รายการเคสล่าสุด</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshCases()} disabled={isLoadingCases}>
            {isLoadingCases ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            รีเฟรช
          </Button>
        </div>

        {isLoadingCases ? (
          <p className="text-sm text-muted-foreground">กำลังโหลดเคส...</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีเคสร้องขอจากผู้ป่วย</p>
        ) : (
          <div className="space-y-2">
            {cases.map((item) => {
              const isSelected = item.id === selectedCaseId;
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${isSelected ? "border-cyan-500 bg-cyan-50" : ""}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => setSelectedCaseId(item.id)} className="text-left">
                      <p className="font-semibold">{item.patient?.fullName ?? item.patientId}</p>
                      <p className="text-xs text-muted-foreground">ส่งคำร้อง {formatDateTime(item.requestedAt)}</p>
                    </button>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.status === "active" ? "default" : "secondary"}>{statusLabel[item.status]}</Badge>
                      {item.status === "pending" ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void acceptCase(item.id)}
                          disabled={isAcceptingCaseId === item.id}
                        >
                          {isAcceptingCaseId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          รับเคส
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.requestMessage}</p>
                </div>
              );
            })}
          </div>
        )}

        {selectedCase ? (
          <section className="grid gap-3 rounded-xl border p-3 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <UserRound className="mt-0.5 h-4 w-4 text-cyan-700" />
                <div>
                  <p className="text-sm font-semibold">ข้อมูลผู้ป่วยก่อนรับเคส</p>
                  <p className="text-xs text-muted-foreground">สถานะเคส: {statusLabel[selectedCase.status]}</p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <p>ชื่อ: <span className="font-medium">{selectedCase.patient?.fullName ?? "-"}</span></p>
                <p>โทรศัพท์: <span className="font-medium">{selectedCase.patient?.phone ?? "-"}</span></p>
                <p>ประเภทความพิการ: <span className="font-medium">{selectedCase.patient?.disabilityType ?? "-"}</span></p>
                <p>ระดับความรุนแรง: <span className="font-medium">{selectedCase.patient?.disabilitySeverity ?? "-"}</span></p>
                <p>โรคประจำตัว: <span className="font-medium">{selectedCase.patient?.chronicConditions ?? "-"}</span></p>
                <p>แพ้ยา: <span className="font-medium">{selectedCase.patient?.drugAllergies ?? "-"}</span></p>
                <p>BMI: <span className="font-medium">{selectedCase.patient?.bmi ?? "-"}</span></p>
              </div>
              <div className="rounded-lg bg-white p-3 text-sm">
                <p className="font-semibold">ข้อความร้องขอเริ่มต้น</p>
                <p className="mt-1 whitespace-pre-wrap">{selectedCase.requestMessage}</p>
                <p className="mt-1 text-xs text-muted-foreground">ส่งเมื่อ {formatDateTime(selectedCase.requestedAt)}</p>
              </div>
              {selectedCase.status === "active" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void closeCase(selectedCase.id)}
                  disabled={isClosingCaseId === selectedCase.id}
                  className="w-full"
                >
                  {isClosingCaseId === selectedCase.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  ปิดเคสนี้
                </Button>
              ) : null}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">แชทเคสนี้</h4>
              <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                {isLoadingMessages ? (
                  <p className="text-sm text-muted-foreground">กำลังโหลดข้อความ...</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ยังไม่มีข้อความในเคสนี้</p>
                ) : (
                  messages.map((message) => {
                    const isMine = message.senderId === doctorId;
                    return (
                      <div
                        key={message.id}
                        className={`max-w-[92%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                          isMine ? "ml-auto bg-cyan-600 text-white" : "mr-auto bg-white text-slate-900"
                        }`}
                      >
                        <p className={`text-xs ${isMine ? "text-cyan-100" : "text-muted-foreground"}`}>{message.senderName}</p>
                        <p className="mt-1 whitespace-pre-wrap">{message.message}</p>
                        <p className={`mt-1 text-[11px] ${isMine ? "text-cyan-100" : "text-muted-foreground"}`}>{formatDateTime(message.createdAt)}</p>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  disabled={selectedCase.status !== "active" || isSendingMessage}
                  placeholder={selectedCase.status === "active" ? "พิมพ์ข้อความตอบผู้ป่วย" : "ต้องรับเคสก่อน"}
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
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
};
