"use client";

import {
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Send,
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

interface DoctorAppointmentDeskProps {
  doctorId: string;
  patientOptions: {
    id: string;
    fullName: string;
    phone: string | null;
  }[];
}

interface ApiPayload {
  error?: string;
  appointments?: AppointmentView[];
  token?: string;
}

interface ProposalDraft {
  scheduledAt: string;
  confirmationLink: string;
  note: string;
}

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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

const getPatientResponseLabel = (response: AppointmentView["patientResponse"]) => {
  if (response === "accepted") return "ผู้ป่วยยืนยันแล้ว";
  if (response === "declined") return "ผู้ป่วยปฏิเสธ";
  if (response === "reschedule_requested") return "ผู้ป่วยขอเลื่อนนัด";
  return "รอผู้ป่วยตอบรับ";
};

export const DoctorAppointmentDesk = ({ doctorId, patientOptions }: DoctorAppointmentDeskProps) => {
  const supabaseRef = useRef<ReturnType<typeof createSupabaseBrowserClient> | null>(null);
  if (supabaseRef.current == null) {
    supabaseRef.current = createSupabaseBrowserClient();
  }

  const [appointments, setAppointments] = useState<AppointmentView[]>([]);
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, ProposalDraft>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [creatingAppointment, setCreatingAppointment] = useState(false);
  const [newPatientId, setNewPatientId] = useState(patientOptions[0]?.id ?? "");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newConfirmationLink, setNewConfirmationLink] = useState("");
  const [newRequestNote, setNewRequestNote] = useState("");
  const [newDoctorNote, setNewDoctorNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshAppointments = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await fetch("/api/appointments", {
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
      setLoading(false);
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
      .channel(`doctor-appointments-${doctorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `doctor_id=eq.${doctorId}`,
        },
        () => {
          void refreshAppointments(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [doctorId, refreshAppointments]);

  const counts = useMemo(() => {
    const pending = appointments.filter((item) => item.status === "pending").length;
    const confirmed = appointments.filter((item) => item.status === "confirmed").length;
    const completed = appointments.filter((item) => item.status === "completed").length;
    return { pending, confirmed, completed };
  }, [appointments]);

  const selectedNewPatientId = useMemo(() => {
    if (newPatientId && patientOptions.some((item) => item.id === newPatientId)) {
      return newPatientId;
    }
    return patientOptions[0]?.id ?? "";
  }, [newPatientId, patientOptions]);

  const getDraft = (appointment: AppointmentView): ProposalDraft =>
    proposalDrafts[appointment.id] ?? {
      scheduledAt: toInputDateTimeValue(appointment.scheduledAt ?? appointment.patientPreferredAt),
      confirmationLink: appointment.doctorConfirmationLink ?? "",
      note: appointment.doctorProposedNote ?? "",
    };

  const updateDraft = (appointment: AppointmentView, patch: Partial<ProposalDraft>) => {
    setProposalDrafts((current) => ({
      ...current,
      [appointment.id]: {
        ...getDraft(appointment),
        ...patch,
      },
    }));
  };

  const createDoctorInitiatedAppointment = async () => {
    if (!selectedNewPatientId) {
      setError("Please select a patient before sending an appointment.");
      return;
    }
    if (!newScheduledAt) {
      setError("Please select appointment date and time.");
      return;
    }
    if (!newConfirmationLink.trim()) {
      setError("Please enter a confirmation link.");
      return;
    }
    if (newRequestNote.trim().length < 3) {
      setError("Please enter at least 3 characters in the note.");
      return;
    }

    setCreatingAppointment(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedNewPatientId,
          doctorId,
          requestNote: newRequestNote.trim(),
          scheduledAt: newScheduledAt,
          confirmationLink: newConfirmationLink.trim(),
          doctorProposedNote: newDoctorNote.trim() || null,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to send appointment");
      }

      setNewScheduledAt("");
      setNewConfirmationLink("");
      setNewRequestNote("");
      setNewDoctorNote("");
      setSuccess("Appointment link sent to patient successfully.");
      await refreshAppointments(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to send appointment");
    } finally {
      setCreatingAppointment(false);
    }
  };

  const proposeAppointment = async (appointment: AppointmentView) => {
    const draft = getDraft(appointment);
    if (!draft.scheduledAt) {
      setError("กรุณาระบุวันเวลานัดหมายก่อนส่งลิงก์");
      return;
    }
    if (!draft.confirmationLink.trim()) {
      setError("กรุณาระบุลิงก์นัดหมาย (เช่น Google Meet/LINE Call)");
      return;
    }

    setActionLoadingId(appointment.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "doctor_propose",
          appointmentId: appointment.id,
          scheduledAt: draft.scheduledAt,
          confirmationLink: draft.confirmationLink.trim(),
          note: draft.note || null,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ส่งลิงก์ยืนยันนัดไม่สำเร็จ");
      }
      setSuccess("ส่งลิงก์ยืนยันนัดให้ผู้ป่วยเรียบร้อยแล้ว");
      await refreshAppointments(true);
    } catch (proposeError) {
      setError(proposeError instanceof Error ? proposeError.message : "ส่งลิงก์ยืนยันนัดไม่สำเร็จ");
    } finally {
      setActionLoadingId(null);
    }
  };

  const completeAppointment = async (appointment: AppointmentView) => {
    setActionLoadingId(appointment.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "doctor_complete",
          appointmentId: appointment.id,
        }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "ปิดนัดหมายไม่สำเร็จ");
      }
      setSuccess("ปิดเคสนัดหมายเรียบร้อยแล้ว");
      await refreshAppointments(true);
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "ปิดนัดหมายไม่สำเร็จ");
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-cyan-700" />
          คิวนัดหมายที่หมอเป็นผู้ส่งลิงก์ยืนยัน
        </CardTitle>
        <CardDescription>
          ผู้ป่วยส่งคำขอก่อน จากนั้นคุณหมอส่งลิงก์นัดหมายเอง ผู้ป่วยจึงจะกดยืนยัน/ปฏิเสธ/ขอเลื่อนนัดได้
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

        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Send Appointment To Patient</h3>
          <p className="text-xs text-muted-foreground">
            Doctors can send appointment date/time and meeting link directly to patients without
            waiting for admin pairing.
          </p>
          <div className="space-y-2">
            <Label htmlFor="doctor-appointment-patient-id">Patient</Label>
            <select
              id="doctor-appointment-patient-id"
              value={selectedNewPatientId}
              onChange={(event) => setNewPatientId(event.target.value)}
              disabled={!patientOptions.length || creatingAppointment}
              className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!patientOptions.length ? <option value="">No patients available</option> : null}
              {patientOptions.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.fullName}
                  {patient.phone ? ` (${patient.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doctor-appointment-scheduled-at">Scheduled at</Label>
            <Input
              id="doctor-appointment-scheduled-at"
              type="datetime-local"
              value={newScheduledAt}
              onChange={(event) => setNewScheduledAt(event.target.value)}
              disabled={creatingAppointment}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doctor-appointment-link">Meeting link (Google Meet / LINE / Zoom)</Label>
            <Input
              id="doctor-appointment-link"
              value={newConfirmationLink}
              onChange={(event) => setNewConfirmationLink(event.target.value)}
              placeholder="https://..."
              disabled={creatingAppointment}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doctor-appointment-request-note">Reason / symptom summary</Label>
            <Textarea
              id="doctor-appointment-request-note"
              rows={2}
              value={newRequestNote}
              onChange={(event) => setNewRequestNote(event.target.value)}
              placeholder="Follow-up reason for this appointment"
              disabled={creatingAppointment}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doctor-appointment-note">Doctor note to patient (optional)</Label>
            <Textarea
              id="doctor-appointment-note"
              rows={2}
              value={newDoctorNote}
              onChange={(event) => setNewDoctorNote(event.target.value)}
              placeholder="Optional instructions before the call"
              disabled={creatingAppointment}
            />
          </div>
          <Button
            type="button"
            onClick={() => void createDoctorInitiatedAppointment()}
            disabled={
              creatingAppointment ||
              !patientOptions.length ||
              !selectedNewPatientId ||
              !newScheduledAt ||
              !newConfirmationLink.trim() ||
              newRequestNote.trim().length < 3
            }
          >
            {creatingAppointment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {creatingAppointment ? "Sending..." : "Send appointment"}
          </Button>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">รอดำเนินการ</p>
            <p className="text-2xl font-bold">{counts.pending}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">ยืนยันแล้ว</p>
            <p className="text-2xl font-bold">{counts.confirmed}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">เสร็จสิ้น</p>
            <p className="text-2xl font-bold">{counts.completed}</p>
          </div>
        </section>

        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">รายการนัดหมายล่าสุด</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshAppointments()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            รีเฟรช
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลดนัดหมาย...</p>
        ) : appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีคำขอนัดหมายจากผู้ป่วย</p>
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => {
              const draft = getDraft(appointment);
              const needsDoctorProposal =
                appointment.status !== "completed" &&
                (appointment.patientResponse === "declined" ||
                  appointment.patientResponse === "reschedule_requested" ||
                  !appointment.doctorConfirmationLink);

              return (
                <div key={appointment.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        ผู้ป่วย: {appointment.patient?.fullName ?? appointment.patientId}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        สร้างคำขอเมื่อ {formatDateTime(appointment.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={appointment.status === "pending" ? "secondary" : "default"}>
                        {appointment.status === "confirmed"
                          ? "confirmed"
                          : appointment.status === "completed"
                            ? "completed"
                            : "pending"}
                      </Badge>
                      <Badge variant="outline">{getPatientResponseLabel(appointment.patientResponse)}</Badge>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p>
                      อาการ/เหตุผลนัด: <span className="font-medium">{appointment.requestNote ?? "-"}</span>
                    </p>
                    <p>
                      เวลาที่ผู้ป่วยสะดวก:{" "}
                      <span className="font-medium">{formatDateTime(appointment.patientPreferredAt)}</span>
                    </p>
                    <p>
                      หมายเหตุจากผู้ป่วยล่าสุด:{" "}
                      <span className="font-medium">{appointment.patientResponseNote ?? "-"}</span>
                    </p>
                  </div>

                  {appointment.doctorConfirmationLink ? (
                    <div className="rounded-lg border bg-cyan-50/60 p-3 text-sm">
                      <p className="font-medium">ลิงก์นัดหมายล่าสุดที่ส่งไปแล้ว</p>
                      <a
                        href={appointment.doctorConfirmationLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-cyan-800 underline underline-offset-2"
                      >
                        เปิดลิงก์นัดหมาย
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <p className="mt-1 text-xs text-muted-foreground">
                        เวลานัดหมาย: {formatDateTime(appointment.scheduledAt)} | ส่งเมื่อ{" "}
                        {formatDateTime(appointment.doctorProposedAt)}
                      </p>
                    </div>
                  ) : null}

                  {needsDoctorProposal ? (
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-sm font-semibold">
                        {appointment.doctorConfirmationLink
                          ? "ส่งลิงก์นัดใหม่ให้ผู้ป่วย"
                          : "ส่งลิงก์ยืนยันนัดให้ผู้ป่วย"}
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor={`scheduled-at-${appointment.id}`}>วันเวลานัดหมาย</Label>
                        <Input
                          id={`scheduled-at-${appointment.id}`}
                          type="datetime-local"
                          value={draft.scheduledAt}
                          onChange={(event) =>
                            updateDraft(appointment, { scheduledAt: event.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`confirmation-link-${appointment.id}`}>
                          ลิงก์นัดหมาย (Google Meet/LINE/Zoom)
                        </Label>
                        <Input
                          id={`confirmation-link-${appointment.id}`}
                          value={draft.confirmationLink}
                          onChange={(event) =>
                            updateDraft(appointment, { confirmationLink: event.target.value })
                          }
                          placeholder="https://..."
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`doctor-note-${appointment.id}`}>หมายเหตุถึงผู้ป่วย (optional)</Label>
                        <Textarea
                          id={`doctor-note-${appointment.id}`}
                          rows={2}
                          value={draft.note}
                          onChange={(event) => updateDraft(appointment, { note: event.target.value })}
                          placeholder="เช่น กรุณาเข้าห้องก่อนเวลา 5 นาที"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => void proposeAppointment(appointment)}
                        disabled={actionLoadingId === appointment.id}
                      >
                        {actionLoadingId === appointment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        ส่งลิงก์ยืนยันนัด
                      </Button>
                    </div>
                  ) : null}

                  {appointment.status === "pending" &&
                  appointment.doctorConfirmationLink &&
                  appointment.patientResponse === "pending" ? (
                    <Alert>
                      <AlertTitle>รอผู้ป่วยตอบรับ</AlertTitle>
                      <AlertDescription>
                        คุณหมอส่งลิงก์แล้ว ตอนนี้รอผู้ป่วยยืนยัน / ปฏิเสธ / ขอเลื่อนนัด
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {appointment.status === "confirmed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void completeAppointment(appointment)}
                      disabled={actionLoadingId === appointment.id}
                    >
                      {actionLoadingId === appointment.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      ปิดเคสนัดหมาย
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
