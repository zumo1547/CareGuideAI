"use client";

import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AppointmentView } from "@/types/appointment";

interface DoctorOption {
  id: string;
  fullName: string;
  phone: string | null;
  isLinked: boolean;
}

interface AppointmentFormProps {
  patientId: string;
  doctorOptions: DoctorOption[];
  hasLinkedDoctor: boolean;
}

interface ApiPayload {
  error?: string;
  appointments?: AppointmentView[];
}

interface AppointmentDraft {
  note: string;
  preferredAt: string;
}

const DEFAULT_DRAFT: AppointmentDraft = {
  note: "",
  preferredAt: "",
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

const formatStatus = (status: AppointmentView["status"]) => {
  if (status === "confirmed") return "ยืนยันแล้ว";
  if (status === "completed") return "เสร็จสิ้น";
  return "รอดำเนินการ";
};

const formatPatientResponse = (response: AppointmentView["patientResponse"]) => {
  if (response === "accepted") return "ผู้ป่วยยืนยันรับนัดแล้ว";
  if (response === "declined") return "ผู้ป่วยปฏิเสธนัด";
  if (response === "reschedule_requested") return "ผู้ป่วยขอเลื่อนนัด";
  return "รอผู้ป่วยตอบรับ";
};

const toInputDateTimeValue = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

export const AppointmentForm = ({
  patientId,
  doctorOptions,
  hasLinkedDoctor,
}: AppointmentFormProps) => {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current == null) {
    supabaseRef.current = createSupabaseBrowserClient();
  }

  const linkedDoctors = useMemo(
    () => doctorOptions.filter((doctor) => doctor.isLinked),
    [doctorOptions],
  );
  const canRequestAppointment = linkedDoctors.length > 0;

  const [doctorId, setDoctorId] = useState(linkedDoctors[0]?.id ?? "");
  const [preferredAt, setPreferredAt] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [draftByAppointmentId, setDraftByAppointmentId] = useState<Record<string, AppointmentDraft>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedDoctorId = useMemo(() => {
    if (doctorId && linkedDoctors.some((doctor) => doctor.id === doctorId)) {
      return doctorId;
    }
    return linkedDoctors[0]?.id ?? "";
  }, [doctorId, linkedDoctors]);

  const refreshAppointments = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingList(true);
    }
    try {
      const response = await fetch("/api/appointments", {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "โหลดนัดหมายไม่สำเร็จ");
      }
      setAppointments(payload.appointments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดนัดหมายไม่สำเร็จ");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshAppointments();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshAppointments]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const channel = supabase
      .channel(`patient-appointments-${patientId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `patient_id=eq.${patientId}`,
        },
        () => {
          void refreshAppointments(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [patientId, refreshAppointments]);

  const submitRequest = async () => {
    if (!canRequestAppointment || !selectedDoctorId) {
      setError("ยังไม่ถูกจับคู่กับคุณหมอโดยแอดมิน จึงยังส่งคำขอนัดหมายไม่ได้");
      return;
    }
    if (requestNote.trim().length < 3) {
      setError("กรุณาระบุอาการหรือเรื่องที่ต้องการปรึกษาอย่างน้อย 3 ตัวอักษร");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId: selectedDoctorId,
          requestNote: requestNote.trim(),
          preferredAt: preferredAt || null,
        }),
      });

      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ส่งคำขอนัดหมายไม่สำเร็จ");
      }

      setRequestNote("");
      setPreferredAt("");
      setSuccess("ส่งคำขอถึงคุณหมอแล้ว รอคุณหมอส่งลิงก์ยืนยันนัดหมาย");
      await refreshAppointments(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "ส่งคำขอนัดหมายไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const updateDraft = (appointmentId: string, patch: Partial<AppointmentDraft>) => {
    setDraftByAppointmentId((current) => ({
      ...current,
      [appointmentId]: {
        ...(current[appointmentId] ?? DEFAULT_DRAFT),
        ...patch,
      },
    }));
  };

  const getDraft = (appointment: AppointmentView): AppointmentDraft =>
    draftByAppointmentId[appointment.id] ?? {
      note: "",
      preferredAt: toInputDateTimeValue(appointment.patientPreferredAt),
    };

  const respondToDoctor = async (
    appointment: AppointmentView,
    action: "patient_accept" | "patient_decline" | "patient_reschedule",
  ) => {
    const token = appointment.doctorConfirmationToken;
    if (!token) {
      setError("ยังไม่มีลิงก์ยืนยันจากคุณหมอ");
      return;
    }
    const draft = getDraft(appointment);

    setActionLoadingId(appointment.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId: appointment.id,
          token,
          note: draft.note || null,
          preferredAt: action === "patient_reschedule" ? draft.preferredAt || null : undefined,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ตอบกลับนัดหมายไม่สำเร็จ");
      }

      if (action === "patient_accept") {
        setSuccess("ยืนยันรับนัดหมายเรียบร้อยแล้ว");
      } else if (action === "patient_decline") {
        setSuccess("ปฏิเสธนัดหมายเรียบร้อยแล้ว");
      } else {
        setSuccess("ส่งคำขอเลื่อนนัดให้คุณหมอเรียบร้อยแล้ว");
      }
      await refreshAppointments(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "ตอบกลับนัดหมายไม่สำเร็จ");
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          ระบบนัดหมายที่คุณหมอยืนยันก่อน
        </CardTitle>
        <CardDescription>
          ผู้ป่วยส่งคำขอก่อน แล้วรอคุณหมอส่งลิงก์นัดหมายมาให้ จากนั้นจึงกดยืนยัน / ปฏิเสธ / ขอเลื่อนนัดได้
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

        {!hasLinkedDoctor ? (
          <Alert>
            <AlertTitle>ยังไม่มีหมอดูแลที่จับคู่โดยแอดมิน</AlertTitle>
            <AlertDescription>
              เพื่อความปลอดภัย คนไข้จะส่งคำขอนัดหมายได้เฉพาะหมอที่แอดมินจับคู่ไว้เท่านั้น
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">ส่งคำขอนัดหมายให้คุณหมอ</h3>
          <div className="space-y-2">
            <Label htmlFor="appointment-doctor-id">เลือกคุณหมอที่ดูแล</Label>
            <select
              id="appointment-doctor-id"
              value={selectedDoctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              disabled={!canRequestAppointment || submitting}
              className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!linkedDoctors.length ? <option value="">ยังไม่มีหมอที่จับคู่</option> : null}
              {linkedDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.fullName}
                  {doctor.phone ? ` (${doctor.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-preferred-at">เวลาที่สะดวก (optional)</Label>
            <Input
              id="appointment-preferred-at"
              type="datetime-local"
              value={preferredAt}
              onChange={(event) => setPreferredAt(event.target.value)}
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-note">อาการหรือสิ่งที่ต้องการปรึกษา</Label>
            <Textarea
              id="appointment-note"
              rows={3}
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="เช่น เวียนหัวหลังทานยา ต้องการปรึกษาแพทย์ด่วน"
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <Button
            type="button"
            onClick={() => void submitRequest()}
            disabled={!canRequestAppointment || submitting || requestNote.trim().length < 3}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "กำลังส่งคำขอ..." : "ส่งคำขอนัดหมาย"}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">นัดหมายของฉัน</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshAppointments()} disabled={loadingList}>
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              รีเฟรช
            </Button>
          </div>

          {loadingList ? (
            <p className="text-sm text-muted-foreground">กำลังโหลดนัดหมาย...</p>
          ) : appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีนัดหมายในระบบ</p>
          ) : (
            <div className="space-y-3">
              {appointments.map((appointment) => {
                const draft = getDraft(appointment);
                const canRespond =
                  appointment.status === "pending" &&
                  Boolean(appointment.doctorConfirmationLink) &&
                  appointment.patientResponse === "pending";

                return (
                  <div key={appointment.id} className="space-y-3 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          คุณหมอ: {appointment.doctor?.fullName ?? appointment.doctorId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          สร้างคำขอเมื่อ {formatDateTime(appointment.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={appointment.status === "pending" ? "secondary" : "default"}>
                          {formatStatus(appointment.status)}
                        </Badge>
                        <Badge variant="outline">{formatPatientResponse(appointment.patientResponse)}</Badge>
                      </div>
                    </div>

                    <div className="space-y-1 text-sm">
                      <p>
                        อาการที่แจ้ง: <span className="font-medium">{appointment.requestNote ?? "-"}</span>
                      </p>
                      <p>
                        เวลาที่สะดวกเดิม: <span className="font-medium">{formatDateTime(appointment.patientPreferredAt)}</span>
                      </p>
                      <p>
                        หมอนัดหมายเวลา: <span className="font-medium">{formatDateTime(appointment.scheduledAt)}</span>
                      </p>
                      <p>
                        ส่งลิงก์เมื่อ: <span className="font-medium">{formatDateTime(appointment.doctorProposedAt)}</span>
                      </p>
                      {appointment.doctorProposedNote ? (
                        <p>
                          หมายเหตุจากหมอ: <span className="font-medium">{appointment.doctorProposedNote}</span>
                        </p>
                      ) : null}
                      {appointment.patientResponseNote ? (
                        <p>
                          หมายเหตุฝั่งผู้ป่วย: <span className="font-medium">{appointment.patientResponseNote}</span>
                        </p>
                      ) : null}
                    </div>

                    {appointment.doctorConfirmationLink ? (
                      <div className="rounded-lg border bg-cyan-50/60 p-3 text-sm">
                        <p className="font-medium">ลิงก์ยืนยันนัดหมายจากคุณหมอ</p>
                        <a
                          href={appointment.doctorConfirmationLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-cyan-800 underline underline-offset-2"
                        >
                          เปิดลิงก์นัดหมาย
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ) : (
                      <Alert>
                        <AlertTitle>รอคุณหมอส่งลิงก์</AlertTitle>
                        <AlertDescription>
                          นัดหมายนี้ยังยืนยันไม่ได้จนกว่าคุณหมอจะส่งลิงก์ยืนยันเข้ามา
                        </AlertDescription>
                      </Alert>
                    )}

                    {canRespond ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-semibold">ตอบรับนัดหมายจากคุณหมอ</p>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-response-note-${appointment.id}`}>
                            ข้อความถึงคุณหมอ (optional)
                          </Label>
                          <Textarea
                            id={`appointment-response-note-${appointment.id}`}
                            rows={2}
                            value={draft.note}
                            onChange={(event) =>
                              updateDraft(appointment.id, { note: event.target.value })
                            }
                            placeholder="เช่น สะดวกตามเวลานี้ หรือขอเลื่อนเนื่องจาก..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-reschedule-at-${appointment.id}`}>
                            เวลาที่สะดวกใหม่ (สำหรับขอเลื่อนนัด)
                          </Label>
                          <Input
                            id={`appointment-reschedule-at-${appointment.id}`}
                            type="datetime-local"
                            value={draft.preferredAt}
                            onChange={(event) =>
                              updateDraft(appointment.id, { preferredAt: event.target.value })
                            }
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => void respondToDoctor(appointment, "patient_accept")}
                            disabled={actionLoadingId === appointment.id}
                          >
                            {actionLoadingId === appointment.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            ยืนยันรับนัด
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void respondToDoctor(appointment, "patient_decline")}
                            disabled={actionLoadingId === appointment.id}
                          >
                            <XCircle className="h-4 w-4" />
                            ปฏิเสธนัด
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void respondToDoctor(appointment, "patient_reschedule")}
                            disabled={actionLoadingId === appointment.id}
                          >
                            ขอเลื่อนนัด
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
};
