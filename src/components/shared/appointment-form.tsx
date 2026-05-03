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
  if (status === "confirmed") return "confirmed";
  if (status === "completed") return "completed";
  return "pending";
};

const formatPatientResponse = (response: AppointmentView["patientResponse"]) => {
  if (response === "accepted") return "patient accepted";
  if (response === "declined") return "patient declined";
  if (response === "reschedule_requested") return "reschedule requested";
  return "awaiting patient response";
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

const announceAlarm = (message: string) => {
  if (typeof window === "undefined") return;
  window.alert(message);
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "en-US";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
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
      const response = await fetch("/api/appointments", {
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load appointments");
      }
      setAppointments(payload.appointments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load appointments");
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
      setError("Please select a doctor before sending an appointment request.");
      return;
    }
    if (requestNote.trim().length < 3) {
      setError("Please enter at least 3 characters for symptom or reason.");
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
        throw new Error(payload.error ?? "Failed to send appointment request");
      }

      setRequestNote("");
      setPreferredAt("");
      setSuccess("Appointment request sent. Waiting for doctor confirmation link.");
      await refreshAppointments(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to send appointment request",
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
      setError("Please provide cancellation reason with at least 3 characters.");
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
        throw new Error(payload.error ?? "Failed to respond appointment");
      }

      if (action === "patient_accept") {
        setSuccess("Appointment accepted.");
      } else if (action === "patient_decline") {
        const alarmMessage = "Appointment canceled. Cancellation reason has been sent to doctor.";
        setSuccess("Appointment canceled successfully.");
        setLastAlarmMessage(alarmMessage);
        announceAlarm(alarmMessage);
        setAppointments((current) => current.filter((item) => item.id !== appointment.id));
      } else {
        setSuccess("Reschedule request sent to doctor.");
      }
      await refreshAppointments(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to respond appointment");
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
          Doctor-Confirmed Appointment Flow
        </CardTitle>
        <CardDescription>
          Patients request first, then doctor sends confirmation link. Patient can accept, decline,
          or request reschedule.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
        {lastAlarmMessage ? (
          <Alert>
            <AlertTitle>Cancellation Alarm</AlertTitle>
            <AlertDescription>{lastAlarmMessage}</AlertDescription>
          </Alert>
        ) : null}

        {!hasLinkedDoctor ? (
          <Alert>
            <AlertTitle>No admin-linked doctor yet</AlertTitle>
            <AlertDescription>
              You can still send requests directly to doctor. Admin pairing remains as backup.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">Send Appointment Request</h3>
          <div className="space-y-2">
            <Label htmlFor="appointment-doctor-id">Doctor</Label>
            <select
              id="appointment-doctor-id"
              value={selectedDoctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              disabled={!canRequestAppointment || submitting}
              className="flex h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!sortedDoctorOptions.length ? <option value="">No doctors available</option> : null}
              {sortedDoctorOptions.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.fullName}
                  {doctor.phone ? ` (${doctor.phone})` : ""}
                  {doctor.isLinked ? " (Admin linked)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-preferred-at">Preferred time (optional)</Label>
            <Input
              id="appointment-preferred-at"
              type="datetime-local"
              value={preferredAt}
              onChange={(event) => setPreferredAt(event.target.value)}
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-note">Symptom / consultation reason</Label>
            <Textarea
              id="appointment-note"
              rows={3}
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="Example: dizziness after medication"
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <Button
            type="button"
            onClick={() => void submitRequest()}
            disabled={!canRequestAppointment || submitting || requestNote.trim().length < 3}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "Sending..." : "Send request"}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">My Appointments</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshAppointments()} disabled={loadingList}>
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>

          {loadingList ? (
            <p className="text-sm text-muted-foreground">Loading appointments...</p>
          ) : visibleAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments found.</p>
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
                          Doctor: {appointment.doctor?.fullName ?? appointment.doctorId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created: {formatDateTime(appointment.createdAt)}
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
                        Reason: <span className="font-medium">{appointment.requestNote ?? "-"}</span>
                      </p>
                      <p>
                        Preferred time: <span className="font-medium">{formatDateTime(appointment.patientPreferredAt)}</span>
                      </p>
                      <p>
                        Scheduled time: <span className="font-medium">{formatDateTime(appointment.scheduledAt)}</span>
                      </p>
                      <p>
                        Link sent at: <span className="font-medium">{formatDateTime(appointment.doctorProposedAt)}</span>
                      </p>
                      {appointment.doctorProposedNote ? (
                        <p>
                          Doctor note: <span className="font-medium">{appointment.doctorProposedNote}</span>
                        </p>
                      ) : null}
                      {appointment.patientResponseNote ? (
                        <p>
                          Patient note: <span className="font-medium">{appointment.patientResponseNote}</span>
                        </p>
                      ) : null}
                    </div>

                    {appointment.doctorConfirmationLink ? (
                      <div className="rounded-lg border bg-cyan-50/60 p-3 text-sm">
                        <p className="font-medium">Doctor confirmation link</p>
                        <a
                          href={appointment.doctorConfirmationLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-cyan-800 underline underline-offset-2"
                        >
                          Open meeting link
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ) : (
                      <Alert>
                        <AlertTitle>Waiting for doctor link</AlertTitle>
                        <AlertDescription>
                          You cannot confirm this appointment until doctor sends confirmation link.
                        </AlertDescription>
                      </Alert>
                    )}

                    {canRespond ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-semibold">Respond to doctor appointment</p>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-response-note-${appointment.id}`}>
                            Message to doctor
                          </Label>
                          <Textarea
                            id={`appointment-response-note-${appointment.id}`}
                            rows={2}
                            value={draft.note}
                            onChange={(event) =>
                              updateDraft(appointment.id, { note: event.target.value })
                            }
                            placeholder="Example: Available at this time / Need to reschedule"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-reschedule-at-${appointment.id}`}>
                            New preferred time (for reschedule)
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
                            Accept
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void respondToDoctor(appointment, "patient_decline")}
                            disabled={
                              actionLoadingId === appointment.id ||
                              draft.note.trim().length < 3
                            }
                          >
                            <XCircle className="h-4 w-4" />
                            Decline
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void respondToDoctor(appointment, "patient_reschedule")}
                            disabled={actionLoadingId === appointment.id}
                          >
                            Request reschedule
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Decline requires a reason (minimum 3 characters), and the appointment is canceled immediately.
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
