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
  if (status === "confirmed") return "เธขเธทเธเธขเธฑเธเนเธฅเนเธง";
  if (status === "completed") return "เน€เธชเธฃเนเธเธชเธดเนเธ";
  return "เธฃเธญเธ”เธณเน€เธเธดเธเธเธฒเธฃ";
};

const formatPatientResponse = (response: AppointmentView["patientResponse"]) => {
  if (response === "accepted") return "เธเธนเนเธเนเธงเธขเธขเธทเธเธขเธฑเธเนเธฅเนเธง";
  if (response === "declined") return "เธเธนเนเธเนเธงเธขเธเธเธดเน€เธชเธ";
  if (response === "reschedule_requested") return "เธเธนเนเธเนเธงเธขเธเธญเน€เธฅเธทเนเธญเธเธเธฑเธ”";
  return "เธฃเธญเธเธนเนเธเนเธงเธขเธ•เธญเธเธฃเธฑเธ";
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
    utterance.lang = "th-TH";
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
        throw new Error(payload.error ?? "เนเธซเธฅเธ”เธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
      }
      setAppointments(payload.appointments ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "เนเธซเธฅเธ”เธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
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
      setError("เธเธฃเธธเธ“เธฒเน€เธฅเธทเธญเธเธเธธเธ“เธซเธกเธญเธเนเธญเธเธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธข");
      return;
    }
    if (requestNote.trim().length < 3) {
      setError("เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเธญเธฒเธเธฒเธฃเธซเธฃเธทเธญเธชเธดเนเธเธ—เธตเนเธ•เนเธญเธเธเธฒเธฃเธเธฃเธถเธเธฉเธฒเธญเธขเนเธฒเธเธเนเธญเธข 3 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ");
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
        throw new Error(payload.error ?? "เธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
      }

      setRequestNote("");
      setPreferredAt("");
      setSuccess("เธชเนเธเธเธณเธเธญเธ–เธถเธเธเธธเธ“เธซเธกเธญเนเธฅเนเธง เธฃเธญเธเธธเธ“เธซเธกเธญเธชเนเธเธฅเธดเธเธเนเธขเธทเธเธขเธฑเธเธเธฑเธ”เธซเธกเธฒเธข");
      await refreshAppointments(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "เธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
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
      setError("เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเน€เธซเธ•เธธเธเธฅเธ—เธตเนเธขเธเน€เธฅเธดเธเธเธฑเธ”เธญเธขเนเธฒเธเธเนเธญเธข 3 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ");
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
        throw new Error(payload.error ?? "เธ•เธญเธเธเธฅเธฑเธเธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
      }

      if (action === "patient_accept") {
        setSuccess("เธขเธทเธเธขเธฑเธเธฃเธฑเธเธเธฑเธ”เธซเธกเธฒเธขเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง");
      } else if (action === "patient_decline") {
        const alarmMessage = "เธขเธเน€เธฅเธดเธเธเธฑเธ”เนเธฅเนเธง เนเธฅเธฐเธชเนเธเน€เธซเธ•เธธเธเธฅเนเธซเนเธเธธเธ“เธซเธกเธญเน€เธฃเธตเธขเธเธฃเนเธญเธข";
        setSuccess("เธขเธเน€เธฅเธดเธเธเธฑเธ”เธซเธกเธฒเธขเธชเธณเน€เธฃเนเธ เธฃเธฒเธขเธเธฒเธฃเธเธตเนเธ–เธนเธเธขเธเน€เธฅเธดเธเนเธฅเนเธง");
        setLastAlarmMessage(alarmMessage);
        announceAlarm(alarmMessage);
        setAppointments((current) => current.filter((item) => item.id !== appointment.id));
      } else {
        setSuccess("เธชเนเธเธเธณเธเธญเน€เธฅเธทเนเธญเธเธเธฑเธ”เนเธซเนเธเธธเธ“เธซเธกเธญเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง");
      }
      await refreshAppointments(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "เธ•เธญเธเธเธฅเธฑเธเธเธฑเธ”เธซเธกเธฒเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
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
          เธฃเธฐเธเธเธเธฑเธ”เธซเธกเธฒเธขเธ—เธตเนเธเธธเธ“เธซเธกเธญเธขเธทเธเธขเธฑเธเธเนเธญเธ
        </CardTitle>
        <CardDescription>
          เธเธนเนเธเนเธงเธขเธชเนเธเธเธณเธเธญเธเนเธญเธ เนเธฅเนเธงเธฃเธญเธเธธเธ“เธซเธกเธญเธชเนเธเธฅเธดเธเธเนเธเธฑเธ”เธซเธกเธฒเธขเธกเธฒเนเธซเน เธเธฒเธเธเธฑเนเธเธเธถเธเธเธ”เธขเธทเธเธขเธฑเธ / เธเธเธดเน€เธชเธ / เธเธญเน€เธฅเธทเนเธญเธเธเธฑเธ”เนเธ”เน
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>เธชเธณเน€เธฃเนเธ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}
        {lastAlarmMessage ? (
          <Alert>
            <AlertTitle>เนเธเนเธเน€เธ•เธทเธญเธเธเธฒเธฃเธขเธเน€เธฅเธดเธเธเธฑเธ”</AlertTitle>
            <AlertDescription>{lastAlarmMessage}</AlertDescription>
          </Alert>
        ) : null}

        {!hasLinkedDoctor ? (
          <Alert>
            <AlertTitle>เธขเธฑเธเนเธกเนเธกเธตเธซเธกเธญเธ—เธตเนเนเธญเธ”เธกเธดเธเธเธฑเธเธเธนเน</AlertTitle>
            <AlertDescription>
              เธเธธเธ“เธขเธฑเธเธชเธฒเธกเธฒเธฃเธ–เธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธขเธ•เธฃเธเธ–เธถเธเธซเธกเธญเนเธ”เน เนเธ”เธขเนเธกเนเธ•เนเธญเธเธฃเธญเนเธญเธ”เธกเธดเธเธเธฑเธเธเธนเน
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">เธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธขเนเธซเนเธเธธเธ“เธซเธกเธญ</h3>
          <div className="space-y-2">
            <Label htmlFor="appointment-doctor-id">เน€เธฅเธทเธญเธเธเธธเธ“เธซเธกเธญเธ—เธตเนเธ”เธนเนเธฅ</Label>
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
            <Label htmlFor="appointment-preferred-at">เน€เธงเธฅเธฒเธ—เธตเนเธชเธฐเธ”เธงเธ (optional)</Label>
            <Input
              id="appointment-preferred-at"
              type="datetime-local"
              value={preferredAt}
              onChange={(event) => setPreferredAt(event.target.value)}
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="appointment-note">เธญเธฒเธเธฒเธฃเธซเธฃเธทเธญเธชเธดเนเธเธ—เธตเนเธ•เนเธญเธเธเธฒเธฃเธเธฃเธถเธเธฉเธฒ</Label>
            <Textarea
              id="appointment-note"
              rows={3}
              value={requestNote}
              onChange={(event) => setRequestNote(event.target.value)}
              placeholder="เน€เธเนเธ เน€เธงเธตเธขเธเธซเธฑเธงเธซเธฅเธฑเธเธ—เธฒเธเธขเธฒ เธ•เนเธญเธเธเธฒเธฃเธเธฃเธถเธเธฉเธฒเนเธเธ—เธขเนเธ”เนเธงเธ"
              disabled={!canRequestAppointment || submitting}
            />
          </div>
          <Button
            type="button"
            onClick={() => void submitRequest()}
            disabled={!canRequestAppointment || submitting || requestNote.trim().length < 3}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? "เธเธณเธฅเธฑเธเธชเนเธเธเธณเธเธญ..." : "เธชเนเธเธเธณเธเธญเธเธฑเธ”เธซเธกเธฒเธข"}
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">เธเธฑเธ”เธซเธกเธฒเธขเธเธญเธเธเธฑเธ</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshAppointments()} disabled={loadingList}>
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              เธฃเธตเน€เธเธฃเธ
            </Button>
          </div>

          {loadingList ? (
            <p className="text-sm text-muted-foreground">เธเธณเธฅเธฑเธเนเธซเธฅเธ”เธเธฑเธ”เธซเธกเธฒเธข...</p>
          ) : visibleAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">เธขเธฑเธเนเธกเนเธกเธตเธเธฑเธ”เธซเธกเธฒเธขเนเธเธฃเธฐเธเธ</p>
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
                          เธเธธเธ“เธซเธกเธญ: {appointment.doctor?.fullName ?? appointment.doctorId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          เธชเธฃเนเธฒเธเธเธณเธเธญเน€เธกเธทเนเธญ {formatDateTime(appointment.createdAt)}
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
                        เธญเธฒเธเธฒเธฃเธ—เธตเนเนเธเนเธ: <span className="font-medium">{appointment.requestNote ?? "-"}</span>
                      </p>
                      <p>
                        เน€เธงเธฅเธฒเธ—เธตเนเธชเธฐเธ”เธงเธเน€เธ”เธดเธก: <span className="font-medium">{formatDateTime(appointment.patientPreferredAt)}</span>
                      </p>
                      <p>
                        เธซเธกเธญเธเธฑเธ”เธซเธกเธฒเธขเน€เธงเธฅเธฒ: <span className="font-medium">{formatDateTime(appointment.scheduledAt)}</span>
                      </p>
                      <p>
                        เธชเนเธเธฅเธดเธเธเนเน€เธกเธทเนเธญ: <span className="font-medium">{formatDateTime(appointment.doctorProposedAt)}</span>
                      </p>
                      {appointment.doctorProposedNote ? (
                        <p>
                          เธซเธกเธฒเธขเน€เธซเธ•เธธเธเธฒเธเธซเธกเธญ: <span className="font-medium">{appointment.doctorProposedNote}</span>
                        </p>
                      ) : null}
                      {appointment.patientResponseNote ? (
                        <p>
                          เธซเธกเธฒเธขเน€เธซเธ•เธธเธเธฒเธเธเธนเนเธเนเธงเธข: <span className="font-medium">{appointment.patientResponseNote}</span>
                        </p>
                      ) : null}
                    </div>

                    {appointment.doctorConfirmationLink ? (
                      <div className="rounded-lg border bg-cyan-50/60 p-3 text-sm">
                        <p className="font-medium">เธฅเธดเธเธเนเธขเธทเธเธขเธฑเธเธเธฑเธ”เธซเธกเธฒเธขเธเธฒเธเธเธธเธ“เธซเธกเธญ</p>
                        <a
                          href={appointment.doctorConfirmationLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-cyan-800 underline underline-offset-2"
                        >
                          เน€เธเธดเธ”เธฅเธดเธเธเนเธเธฑเธ”เธซเธกเธฒเธข
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    ) : (
                      <Alert>
                        <AlertTitle>เธฃเธญเธเธธเธ“เธซเธกเธญเธชเนเธเธฅเธดเธเธเน</AlertTitle>
                        <AlertDescription>
                          เธเธฑเธ”เธซเธกเธฒเธขเธเธตเนเธขเธฑเธเธขเธทเธเธขเธฑเธเนเธกเนเนเธ”เนเธเธเธเธงเนเธฒเธเธธเธ“เธซเธกเธญเธเธฐเธชเนเธเธฅเธดเธเธเนเธขเธทเธเธขเธฑเธเน€เธเนเธฒเธกเธฒ
                        </AlertDescription>
                      </Alert>
                    )}

                    {canRespond ? (
                      <div className="space-y-2 rounded-lg border p-3">
                        <p className="text-sm font-semibold">เธ•เธญเธเธฃเธฑเธเธเธฑเธ”เธซเธกเธฒเธขเธเธฒเธเธเธธเธ“เธซเธกเธญ</p>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-response-note-${appointment.id}`}>
                            เธเนเธญเธเธงเธฒเธกเธ–เธถเธเธเธธเธ“เธซเธกเธญ
                          </Label>
                          <Textarea
                            id={`appointment-response-note-${appointment.id}`}
                            rows={2}
                            value={draft.note}
                            onChange={(event) =>
                              updateDraft(appointment.id, { note: event.target.value })
                            }
                            placeholder="เน€เธเนเธ เธชเธฐเธ”เธงเธเธ•เธฒเธกเน€เธงเธฅเธฒเธเธตเน เธซเธฃเธทเธญเธเธญเน€เธฅเธทเนเธญเธเน€เธเธทเนเธญเธเธเธฒเธ..."
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`appointment-reschedule-at-${appointment.id}`}>
                            เน€เธงเธฅเธฒเธ—เธตเนเธชเธฐเธ”เธงเธเนเธซเธกเน (เธชเธณเธซเธฃเธฑเธเธเธญเน€เธฅเธทเนเธญเธเธเธฑเธ”)
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
                            เธขเธทเธเธขเธฑเธเธฃเธฑเธเธเธฑเธ”
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
                            เธเธเธดเน€เธชเธเธเธฑเธ”
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void respondToDoctor(appointment, "patient_reschedule")}
                            disabled={actionLoadingId === appointment.id}
                          >
                            เธเธญเน€เธฅเธทเนเธญเธเธเธฑเธ”
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          เธซเธฒเธเธเธ”เธเธเธดเน€เธชเธเธเธฑเธ” เธ•เนเธญเธเธฃเธฐเธเธธเน€เธซเธ•เธธเธเธฅเธญเธขเนเธฒเธเธเนเธญเธข 3 เธ•เธฑเธงเธญเธฑเธเธฉเธฃ เนเธฅเธฐเธฃเธฐเธเธเธเธฐเธขเธเน€เธฅเธดเธเธฃเธฒเธขเธเธฒเธฃเธเธตเนเธ—เธฑเธเธ—เธต
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
