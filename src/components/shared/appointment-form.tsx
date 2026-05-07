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

import { SpeechToTextButton } from "@/components/accessibility/speech-to-text-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  DEFAULT_APP_TIMEZONE,
  formatDateTimeInTimeZone,
  toDateTimeLocalInputValue,
} from "@/lib/time";
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
  actorRole?: "patient" | "caregiver";
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
  return formatDateTimeInTimeZone(value, DEFAULT_APP_TIMEZONE, "dd/MM/yy HH:mm");
};

const formatStatus = (status: AppointmentView["status"]) => {
  if (status === "confirmed") return "ยืนยันแล้ว";
  if (status === "completed") return "เสร็จสิ้น";
  return "รอดำเนินการ";
};

const formatPatientResponse = (response: AppointmentView["patientResponse"]) => {
  if (response === "accepted") return "ผู้ป่วยยืนยันแล้ว";
  if (response === "declined") return "ผู้ป่วยปฏิเสธนัด";
  if (response === "reschedule_requested") return "ผู้ป่วยขอเลื่อนนัด";
  return "รอผู้ป่วยตอบรับ";
};

const toInputDateTimeValue = (iso: string | null) => {
  return toDateTimeLocalInputValue(iso, DEFAULT_APP_TIMEZONE);
};

const announceAlarm = (message: string) => {
  if (typeof window === "undefined") return;
  window.alert(message);
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "th-TH";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
};

export const AppointmentForm = ({
  patientId,
  doctorOptions,
  hasLinkedDoctor,
  actorRole = "patient",
}: AppointmentFormProps) => {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current == null) {
    supabaseRef.current = createSupabaseBrowserClient();
  }

  const sortedDoctorOptions = useMemo(
    () =>
      [...doctorOptions].sort(
        (a, b) =>
          Number(b.isLinked) - Number(a.isLinked) || a.fullName.localeCompare(b.fullName, "th"),
      ),
    [doctorOptions],
  );
  const canRequestAppointment = sortedDoctorOptions.length > 0;

  const [doctorId, setDoctorId] = useState(sortedDoctorOptions[0]?.id ?? "");
  const [preferredAt, setPreferredAt] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [draftByAppointmentId, setDraftByAppointmentId] = useState<Record<string, AppointmentDraft>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastAlarmMessage, setLastAlarmMessage] = useState<string | null>(null);

  const appendAppointmentRequestNote = useCallback((text: string) => {
    setRequestNote((previous) => `${previous} ${text}`.trim());
  }, []);

  const appendAppointmentReplyNote = useCallback((appointmentId: string, text: string) => {
    setDraftByAppointmentId((current) => {
      const currentDraft = current[appointmentId] ?? DEFAULT_DRAFT;
      return {
        ...current,
        [appointmentId]: {
          ...currentDraft,
          note: `${currentDraft.note} ${text}`.trim(),
        },
      };
    });
  }, []);

  const selectedDoctorId = useMemo(() => {
    if (doctorId && sortedDoctorOptions.some((doctor) => doctor.id === doctorId)) {
      return doctorId;
    }
    return sortedDoctorOptions[0]?.id ?? "";
  }, [doctorId, sortedDoctorOptions]);

  const refreshAppointments = useCallback(async (silent = false) => {
    if (!silent) {
      setLoadingList(true);
    }
    try {
      const endpoint =
        actorRole === "caregiver"
          ? `/api/appointments?patientId=${encodeURIComponent(patientId)}`
          : "/api/appointments";
      const response = await fetch(endpoint, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "โหลดรายการนัดหมายไม่สำเร็จ");
      }
      setAppointments(payload.appointments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดรายการนัดหมายไม่สำเร็จ");
    } finally {
      setLoadingList(false);
    }
  }, [actorRole, patientId]);

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
      setError("กรุณาเลือกคุณหมอก่อนส่งคำขอนัดหมาย");
      return;
    }
    if (requestNote.trim().length < 3) {
      setError("กรุณากรอกอาการหรือเหตุผลอย่างน้อย 3 ตัวอักษร");
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
          patientId: actorRole === "caregiver" ? patientId : undefined,
        }),
      });

      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ส่งคำขอนัดหมายไม่สำเร็จ");
      }

      setRequestNote("");
      setPreferredAt("");
      setSuccess("ส่งคำขอนัดหมายแล้ว กรุณารอคุณหมอส่งลิงก์ยืนยันนัด");
      await refreshAppointments(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "ส่งคำขอนัดหมายไม่สำเร็จ",
      );
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
    const draft = getDraft(appointment);

    if (action === "patient_decline" && draft.note.trim().length < 3) {
      setError("กรุณาระบุเหตุผลการปฏิเสธอย่างน้อย 3 ตัวอักษร");
      return;
    }

    setActionLoadingId(appointment.id);
    setError(null);
    setSuccess(null);
    setLastAlarmMessage(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appointmentId: appointment.id,
          token: token ?? null,
          note: draft.note || null,
          preferredAt: action === "patient_reschedule" ? draft.preferredAt || null : undefined,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ตอบกลับนัดหมายไม่สำเร็จ");
      }

      if (action === "patient_accept") {
        setSuccess("ยืนยันนัดหมายเรียบร้อย");
      } else if (action === "patient_decline") {
        const alarmMessage = "ยกเลิกนัดสำเร็จ และส่งเหตุผลให้คุณหมอแล้ว";
        setSuccess("ยกเลิกนัดหมายเรียบร้อย");
        setLastAlarmMessage(alarmMessage);
        announceAlarm(alarmMessage);
        setAppointments((current) => current.filter((item) => item.id !== appointment.id));
      } else {
        setSuccess("ส่งคำขอเลื่อนนัดให้คุณหมอแล้ว");
      }
      await refreshAppointments(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "ตอบกลับนัดหมายไม่สำเร็จ");
    } finally {
      setActionLoadingId(null);
    }
  };

  const visibleAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          !(appointment.status === "completed" && appointment.patientResponse === "declined"),
      ),
    [appointments],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          ระบบนัดหมายที่คุณหมอยืนยันก่อน
        </CardTitle>
        <CardDescription>
          ผู้ป่วยส่งคำขอก่อน แล้วรอคุณหมอส่งลิงก์นัดหมายมาให้ จากนั้นจึงกดยืนยัน
          ปฏิเสธ หรือขอเลื่อนนัดได้
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
        {lastAlarmMessage ? (
          <Alert>
            <AlertTitle>แจ้งเตือนการยกเลิกนัด</AlertTitle>
            <AlertDescription>{lastAlarmMessage}</AlertDescription>
          </Alert>
        ) : null}

        {!hasLinkedDoctor ? (
          <Alert>
            <AlertTitle>ยังไม่มีคุณหมอที่แอดมินจับคู่</AlertTitle>
            <AlertDescription>
              คุณยังส่งคำขอนัดตรงถึงคุณหมอได้ โดยไม่ต้องรอแอดมินจับคู่
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">ส่งคำขอนัดหมาย</h3>
          <div className="space-y-2">
            <Label htmlFor="appointment-doctor-id">คุณหมอที่ต้องการนัด</Label>
            <select
              id="appointment-doctor-id"
              value={selectedDoctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              disabled={!canRequestAppointment || submitting}
              className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!sortedDoctorOptions.length ? <option value="">ยังไม่มีคุณหมอในระบบ</option> : null}
              {sortedDoctorOptions.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.fullName}
                  {doctor.phone ? ` (${doctor.phone})` : ""}
                  {doctor.isLinked ? " (แอดมินจับคู่แล้ว)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-preferred-at">เวลาที่สะดวก (ไม่บังคับ)</Label>
            <Input
              id="appointment-preferred-at"
              type="datetime-local"
              value={preferredAt}
              onChange={(event) => setPreferredAt(event.target.value)}
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-note">อาการหรือเหตุผลที่ต้องการปรึกษา</Label>
            <div className="flex flex-wrap items-center gap-2">
              <SpeechToTextButton
                onTranscript={appendAppointmentRequestNote}
                label="พูดข้อความนัดหมาย"
                ariaLabel="กดเพื่อพูดข้อความคำขอนัดหมายถึงคุณหมอ"
                disabled={!canRequestAppointment || submitting}
              />
            </div>
            <Textarea
              id="appointment-note"
              rows={3}
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="เช่น เวียนหัวหลังทานยา ต้องการปรึกษาแพทย์ด่วน"
              disabled={!canRequestAppointment || submitting}
              aria-label="ข้อความคำขอนัดหมายถึงคุณหมอ"
              data-voice-field="appointment-request-note"
            />
          </div>
          <Button
            type="button"
            onClick={() => void submitRequest()}
            disabled={!canRequestAppointment || submitting || requestNote.trim().length < 3}
            aria-label="ส่งคำขอนัดหมายถึงคุณหมอ"
            data-voice-action="send-appointment-request"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "กำลังส่ง..." : "ส่งคำขอนัดหมาย"}
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
            <p className="text-sm text-muted-foreground">กำลังโหลดรายการนัดหมาย...</p>
          ) : visibleAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีนัดหมายในระบบ</p>
          ) : (
            <div className="space-y-3">
              {visibleAppointments.map((appointment) => {
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
                          สร้างเมื่อ: {formatDateTime(appointment.createdAt)}
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
                        หมอนัดเวลา: <span className="font-medium">{formatDateTime(appointment.scheduledAt)}</span>
                      </p>
                      <p>
                        ส่งลิงก์เมื่อ: <span className="font-medium">{formatDateTime(appointment.doctorProposedAt)}</span>
                      </p>
                      {appointment.doctorProposedNote ? (
                        <p>
                          หมายเหตุจากคุณหมอ: <span className="font-medium">{appointment.doctorProposedNote}</span>
                        </p>
                      ) : null}
                      {appointment.patientResponseNote ? (
                        <p>
                          หมายเหตุจากผู้ป่วย: <span className="font-medium">{appointment.patientResponseNote}</span>
                        </p>
                      ) : null}
                    </div>

                    {appointment.doctorConfirmationLink ? (
                      <div className="rounded-lg border bg-cyan-50/60 p-3 text-sm">
                        <p className="font-medium">ลิงก์ยืนยันนัดจากคุณหมอ</p>
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
                          นัดนี้ยังยืนยันไม่ได้จนกว่าคุณหมอจะส่งลิงก์ยืนยันนัดมาให้
                        </AlertDescription>
                      </Alert>
                    )}

                    {canRespond ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-semibold">ตอบรับนัดหมายจากคุณหมอ</p>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-response-note-${appointment.id}`}>
                            ข้อความถึงคุณหมอ
                          </Label>
                          <div className="flex flex-wrap items-center gap-2">
                            <SpeechToTextButton
                              onTranscript={(text) => appendAppointmentReplyNote(appointment.id, text)}
                              label="พูดข้อความถึงหมอ"
                              ariaLabel="กดเพื่อพูดข้อความตอบกลับถึงคุณหมอ"
                              disabled={actionLoadingId === appointment.id}
                            />
                          </div>
                          <Textarea
                            id={`appointment-response-note-${appointment.id}`}
                            aria-label="ข้อความตอบกลับถึงคุณหมอ"
                            data-voice-field="appointment-response-note"
                            rows={2}
                            value={draft.note}
                            onChange={(event) =>
                              updateDraft(appointment.id, { note: event.target.value })
                            }
                            placeholder="เช่น สะดวกเวลานี้ หรือขอเลื่อนเนื่องจาก..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-reschedule-at-${appointment.id}`}>
                            เวลาที่สะดวกใหม่ (ใช้เมื่อขอเลื่อนนัด)
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
                            data-voice-action="appointment-accept"
                            aria-label="ยืนยันรับนัดหมาย"
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
                            data-voice-action="appointment-decline"
                            aria-label="ปฏิเสธนัดหมาย"
                            disabled={
                              actionLoadingId === appointment.id ||
                              draft.note.trim().length < 3
                            }
                          >
                            <XCircle className="h-4 w-4" />
                            ปฏิเสธนัด
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void respondToDoctor(appointment, "patient_reschedule")}
                            data-voice-action="appointment-reschedule"
                            aria-label="ขอเลื่อนนัดหมาย"
                            disabled={actionLoadingId === appointment.id}
                          >
                            ขอเลื่อนนัด
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          หากปฏิเสธนัด ต้องใส่เหตุผลอย่างน้อย 3 ตัวอักษร และระบบจะยกเลิกนัดทันที
                        </p>
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
