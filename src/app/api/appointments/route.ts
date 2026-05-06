import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { ensureAppointmentSchema } from "@/lib/appointment-schema-bootstrap";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { env } from "@/lib/env";
import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppointmentView } from "@/types/appointment";
import type { AppointmentStatus } from "@/types/domain";

type AppointmentPatientResponse = AppointmentView["patientResponse"];

type PostgrestLikeError = {
  message?: string;
  code?: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: PostgrestLikeError | null;
};

type AppointmentRow = {
  id: string;
  patient_id: string;
  doctor_id: string;
  requested_by: string;
  request_note: string | null;
  patient_preferred_at: string | null;
  scheduled_at: string | null;
  status: string;
  doctor_confirmation_link: string | null;
  doctor_confirmation_token: string | null;
  doctor_proposed_note: string | null;
  doctor_proposed_at: string | null;
  patient_response: string | null;
  patient_response_note: string | null;
  patient_responded_at: string | null;
  created_at: string;
  updated_at: string;
};

type AppointmentLegacyRow = {
  id: string;
  patient_id: string;
  doctor_id: string;
  requested_by: string;
  request_note: string | null;
  scheduled_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type AppointmentActionRow = {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: string;
  patient_response: string | null;
  doctor_confirmation_link: string | null;
  doctor_confirmation_token: string | null;
  patient_preferred_at: string | null;
};

type AppointmentActionLegacyRow = {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: string;
  request_note: string | null;
  scheduled_at: string | null;
};

const APPOINTMENT_SELECT_COLUMNS = `
  id,
  patient_id,
  doctor_id,
  requested_by,
  request_note,
  patient_preferred_at,
  scheduled_at,
  status,
  doctor_confirmation_link,
  doctor_confirmation_token,
  doctor_proposed_note,
  doctor_proposed_at,
  patient_response,
  patient_response_note,
  patient_responded_at,
  created_at,
  updated_at
`;

const LEGACY_APPOINTMENT_SELECT_COLUMNS = `
  id,
  patient_id,
  doctor_id,
  requested_by,
  request_note,
  scheduled_at,
  status,
  created_at,
  updated_at
`;

const APPOINTMENT_SCHEMA_REQUIRED_FIELDS = [
  "patient_preferred_at",
  "doctor_confirmation_link",
  "doctor_confirmation_token",
  "doctor_proposed_note",
  "doctor_proposed_at",
  "patient_response",
  "patient_response_note",
  "patient_responded_at",
] as const;

const APPOINTMENT_SCHEMA_SQL = [
  "-- Run migration file: supabase/migrations/0010_appointment_doctor_confirmation_flow.sql",
  "NOTIFY pgrst, 'reload schema';",
].join("\n");

const APPOINTMENT_SCHEMA_NOT_READY_MESSAGE =
  "Appointment flow schema is not ready. Run migration 0010_appointment_doctor_confirmation_flow.sql, then run NOTIFY pgrst, 'reload schema'; and retry.";
const APPOINTMENT_RLS_NOT_READY_MESSAGE =
  "Appointment permissions are outdated. Run migration 0011_appointments_rls_patient_update_fix.sql, then run NOTIFY pgrst, 'reload schema'; and retry.";

const confirmationLinkSchema = z.string().trim().min(2).max(2000);

const createRequestSchema = z.object({
  doctorId: z.uuid(),
  requestNote: z.string().trim().min(3).max(2000),
  preferredAt: z.string().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  confirmationLink: confirmationLinkSchema.optional().nullable(),
  doctorProposedNote: z.string().max(2000).optional().nullable(),
  patientId: z.uuid().optional(),
});

const patchActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("doctor_propose"),
    appointmentId: z.uuid(),
    scheduledAt: z.string().min(1),
    confirmationLink: confirmationLinkSchema,
    note: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("patient_accept"),
    appointmentId: z.uuid(),
    token: z.string().min(8).optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("patient_decline"),
    appointmentId: z.uuid(),
    token: z.string().min(8).optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("patient_reschedule"),
    appointmentId: z.uuid(),
    token: z.string().min(8).optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
    preferredAt: z.string().optional().nullable(),
  }),
  z.object({
    action: z.literal("doctor_complete"),
    appointmentId: z.uuid(),
  }),
]);

const normalizeText = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const parseDateInput = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const normalizeStatus = (value: string | null | undefined): AppointmentStatus => {
  if (value === "confirmed" || value === "completed") {
    return value;
  }
  return "pending";
};

const normalizePatientResponse = (
  value: string | null | undefined,
): AppointmentPatientResponse => {
  if (
    value === "accepted" ||
    value === "declined" ||
    value === "reschedule_requested"
  ) {
    return value;
  }
  return "pending";
};

const getRequiredCancellationReason = (
  note: string | null | undefined,
  minimumLength = 3,
) => {
  const normalized = normalizeText(note);
  if (!normalized || normalized.length < minimumLength) {
    return null;
  }
  return normalized;
};

const hasLegacyDoctorLink = (requestNote: string | null | undefined) =>
  (requestNote ?? "").includes("[Doctor link]");

const readLastTaggedValue = (
  source: string | null | undefined,
  tag: "Doctor link" | "Doctor note" | "Patient note",
) => {
  if (!source) return null;
  const matches = Array.from(
    source.matchAll(new RegExp(`\\[${tag}\\]\\s*([^\\n\\r\\[]+)`, "gi")),
  );
  if (!matches.length) return null;
  return normalizeText(matches[matches.length - 1]?.[1]);
};

const sanitizeLegacyRequestNote = (value: string | null | undefined) => {
  if (!value) return null;
  const cleaned = value
    .replace(/\[Doctor link\][^\n\r]*/gi, "")
    .replace(/\[Doctor note\][^\n\r]*/gi, "")
    .replace(/\[Patient accepted\]/gi, "")
    .replace(/\[Patient declined\]/gi, "")
    .replace(/\[Patient requested reschedule\]/gi, "")
    .replace(/\[Patient note\][^\n\r]*/gi, "")
    .replace(/\n{3,}/g, "\n\n");
  return normalizeText(cleaned);
};

const appendLegacyNote = (
  current: string | null | undefined,
  lines: Array<string | null | undefined>,
) => {
  const sanitized = lines
    .map((line) => normalizeText(line))
    .filter((line): line is string => Boolean(line));
  if (!sanitized.length) {
    return normalizeText(current);
  }
  const merged = [normalizeText(current), ...sanitized]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  return normalizeText(merged);
};

const getSupabaseProjectRefFromEnv = () => {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const [ref] = host.split(".");
    return ref || null;
  } catch {
    return null;
  }
};

const isAppointmentSchemaMismatchError = (
  error: PostgrestLikeError | null | undefined,
) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const hasAppointmentFieldInMessage = APPOINTMENT_SCHEMA_REQUIRED_FIELDS.some(
    (field) =>
      message.includes(field) ||
      message.includes(`appointments.${field}`) ||
      message.includes(`'${field}'`),
  );
  const isSchemaCacheError = isSchemaCacheMissingError({
    message: error.message ?? "",
    code: error.code ?? null,
  });
  const isUndefinedColumnError =
    error.code === "42703" ||
    message.includes("column") && message.includes("does not exist");
  return (
    hasAppointmentFieldInMessage && (isSchemaCacheError || isUndefinedColumnError)
  );
};

const appointmentSchemaNotReadyResponse = (error: PostgrestLikeError | null | undefined) =>
  NextResponse.json(
    {
      error: APPOINTMENT_SCHEMA_NOT_READY_MESSAGE,
      code: "APPOINTMENT_SCHEMA_NOT_READY",
      schemaReloadSql: APPOINTMENT_SCHEMA_SQL,
      projectRefHint: getSupabaseProjectRefFromEnv(),
      rawErrorMessage: error?.message ?? null,
    },
    { status: 503 },
  );

const isAppointmentRlsPolicyError = (
  error: PostgrestLikeError | null | undefined,
) => {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    (error.code === "42501" || message.includes("row-level security policy")) &&
    message.includes("appointments")
  );
};

const appointmentRlsNotReadyResponse = (error: PostgrestLikeError | null | undefined) =>
  NextResponse.json(
    {
      error: APPOINTMENT_RLS_NOT_READY_MESSAGE,
      code: "APPOINTMENT_RLS_NOT_READY",
      migrationSql:
        "Run supabase/migrations/0011_appointments_rls_patient_update_fix.sql",
      schemaReloadSql: "NOTIFY pgrst, 'reload schema';",
      projectRefHint: getSupabaseProjectRefFromEnv(),
      rawErrorMessage: error?.message ?? null,
    },
    { status: 503 },
  );

const tryEnsureAppointmentSchema = async () => {
  try {
    await ensureAppointmentSchema();
  } catch {
    // Ignore bootstrap failure here and let the original error flow through.
  }
};

const withAppointmentSchemaRecovery = async <T>(
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> => {
  const first = await operation();
  if (!first.error || !isAppointmentSchemaMismatchError(first.error)) {
    return first;
  }

  await tryEnsureAppointmentSchema();
  return operation();
};

const withAppointmentWriteRecovery = async <T>(
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> => {
  const first = await withAppointmentSchemaRecovery(operation);
  if (!first.error || !isAppointmentRlsPolicyError(first.error)) {
    return first;
  }

  await tryEnsureAppointmentSchema();
  return operation();
};

const selectAppointmentForAction = async (
  appointmentId: string,
) => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await withAppointmentSchemaRecovery<AppointmentActionRow | null>(() =>
    supabase
      .from("appointments")
      .select(
        "id, patient_id, doctor_id, status, patient_response, doctor_confirmation_link, doctor_confirmation_token, patient_preferred_at",
      )
      .eq("id", appointmentId)
      .maybeSingle(),
  );

  if (error && isAppointmentSchemaMismatchError(error)) {
    const legacy = await supabase
      .from("appointments")
      .select("id, patient_id, doctor_id, status, request_note, scheduled_at")
      .eq("id", appointmentId)
      .maybeSingle();
    return {
      data: legacy.data as AppointmentActionLegacyRow | null,
      error: legacy.error as PostgrestLikeError | null,
      supabase,
      legacyMode: true as const,
    };
  }

  return {
    data: data as AppointmentActionRow | null,
    error,
    supabase,
    legacyMode: false as const,
  };
};

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  await tryEnsureAppointmentSchema();

  const supabase = await createSupabaseServerClient();
  const { searchParams } = new URL(request.url);
  const requestedPatientId = searchParams.get("patientId");

  if (auth.role === "caregiver" && requestedPatientId) {
    const canAccess = await canAccessPatientScope({
      supabase,
      role: auth.role,
      actorId: auth.userId,
      patientId: requestedPatientId,
    });
    if (!canAccess) {
      return forbidden("Caregiver cannot access this patient appointments");
    }
  }

  let query = supabase
    .from("appointments")
    .select(APPOINTMENT_SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(120);

  if (auth.role === "patient") {
    query = query.eq("patient_id", auth.userId);
  } else if (auth.role === "caregiver") {
    if (requestedPatientId) {
      query = query.eq("patient_id", requestedPatientId);
    }
  } else if (auth.role === "doctor") {
    query = query.eq("doctor_id", auth.userId);
    if (requestedPatientId) {
      query = query.eq("patient_id", requestedPatientId);
    }
  } else if (auth.role === "admin" && requestedPatientId) {
    query = query.eq("patient_id", requestedPatientId);
  }

  const { data: rows, error } = await withAppointmentSchemaRecovery<AppointmentRow[]>(() => query);

  let normalizedRows: Array<AppointmentRow | AppointmentLegacyRow> = rows ?? [];
  if (error) {
    if (isAppointmentSchemaMismatchError(error)) {
      const legacyQuery = supabase
        .from("appointments")
        .select(LEGACY_APPOINTMENT_SELECT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(120);

      const legacyScopedQuery =
        auth.role === "patient"
          ? legacyQuery.eq("patient_id", auth.userId)
          : auth.role === "doctor"
            ? requestedPatientId
              ? legacyQuery.eq("doctor_id", auth.userId).eq("patient_id", requestedPatientId)
              : legacyQuery.eq("doctor_id", auth.userId)
            : auth.role === "caregiver"
              ? requestedPatientId
                ? legacyQuery.eq("patient_id", requestedPatientId)
                : legacyQuery
              : auth.role === "admin" && requestedPatientId
                ? legacyQuery.eq("patient_id", requestedPatientId)
                : legacyQuery;

      const { data: legacyRows, error: legacyError } = await legacyScopedQuery;
      if (legacyError) {
        return appointmentSchemaNotReadyResponse(error);
      }
      normalizedRows = (legacyRows ?? []) as AppointmentLegacyRow[];
    } else {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  const profileIds = [
    ...new Set(
      normalizedRows
        .flatMap((row) => [row.patient_id, row.doctor_id])
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  let profileMap = new Map<string, { id: string; full_name: string | null; phone: string | null }>();
  if (profileIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", profileIds);
    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 400 });
    }
    profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  const appointments: AppointmentView[] = normalizedRows.map((row) => {
    const isLegacy = !("patient_preferred_at" in row);
    const status = normalizeStatus(row.status);
    const legacyDoctorLink = isLegacy ? readLastTaggedValue(row.request_note, "Doctor link") : null;
    const legacyDoctorNote = isLegacy ? readLastTaggedValue(row.request_note, "Doctor note") : null;
    const legacyPatientNote = isLegacy ? readLastTaggedValue(row.request_note, "Patient note") : null;
    const patientResponse = isLegacy
      ? status === "confirmed" || status === "completed"
        ? "accepted"
        : "pending"
      : normalizePatientResponse(row.patient_response);

    return {
      id: row.id,
      patientId: row.patient_id,
      doctorId: row.doctor_id,
      requestedBy: row.requested_by,
      requestNote: isLegacy ? sanitizeLegacyRequestNote(row.request_note) : row.request_note,
      patientPreferredAt: isLegacy ? row.scheduled_at : row.patient_preferred_at,
      scheduledAt: row.scheduled_at,
      status,
      doctorConfirmationLink: isLegacy ? legacyDoctorLink : row.doctor_confirmation_link,
      doctorConfirmationToken: isLegacy ? null : row.doctor_confirmation_token,
      doctorProposedNote: isLegacy ? legacyDoctorNote : row.doctor_proposed_note,
      doctorProposedAt: isLegacy
        ? legacyDoctorLink
          ? row.updated_at
          : null
        : row.doctor_proposed_at,
      patientResponse,
      patientResponseNote: isLegacy ? legacyPatientNote : row.patient_response_note,
      patientRespondedAt: isLegacy ? null : row.patient_responded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      patient: profileMap.has(row.patient_id)
        ? {
            id: row.patient_id,
            fullName: profileMap.get(row.patient_id)?.full_name ?? null,
            phone: profileMap.get(row.patient_id)?.phone ?? null,
          }
        : null,
      doctor: profileMap.has(row.doctor_id)
        ? {
            id: row.doctor_id,
            fullName: profileMap.get(row.doctor_id)?.full_name ?? null,
            phone: profileMap.get(row.doctor_id)?.phone ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ appointments });
}

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = createRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const patientId = auth.role === "patient" ? auth.userId : payload.patientId;
  if (!patientId) {
    return badRequest("patientId is required");
  }
  if (auth.role === "caregiver") {
    const verificationSupabase = await createSupabaseServerClient();
    const canAccess = await canAccessPatientScope({
      supabase: verificationSupabase,
      role: auth.role,
      actorId: auth.userId,
      patientId,
    });
    if (!canAccess) {
      return forbidden("Caregiver cannot create appointment for this patient");
    }
  }
  const normalizedConfirmationLink = normalizeText(payload.confirmationLink);

  const preferredAt = parseDateInput(payload.preferredAt);
  if (payload.preferredAt && !preferredAt) {
    return badRequest("preferredAt is invalid");
  }
  const scheduledAt = parseDateInput(payload.scheduledAt);
  if (payload.scheduledAt && !scheduledAt) {
    return badRequest("scheduledAt is invalid");
  }

  if (auth.role === "doctor" && payload.doctorId !== auth.userId) {
    return forbidden("Doctor can create only own appointments");
  }

  if (auth.role === "doctor") {
    if (!scheduledAt) {
      return badRequest("scheduledAt is required for doctor created appointment");
    }
    if (!normalizedConfirmationLink) {
      return badRequest("confirmationLink is required for doctor created appointment");
    }
  }

  await tryEnsureAppointmentSchema();

  const writeSupabase = env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();
  const now = new Date().toISOString();
  const isDoctorCreated = auth.role === "doctor";

  const { data, error } = await withAppointmentWriteRecovery<{ id: string }>(() =>
    writeSupabase
      .from("appointments")
      .insert({
        patient_id: patientId,
        doctor_id: payload.doctorId,
        requested_by: auth.userId,
        request_note: normalizeText(payload.requestNote),
        patient_preferred_at: preferredAt ?? (isDoctorCreated ? scheduledAt : null),
        scheduled_at: isDoctorCreated ? scheduledAt : null,
        status: "pending",
        patient_response: "pending",
        doctor_confirmation_link: isDoctorCreated ? normalizedConfirmationLink : null,
        doctor_confirmation_token: isDoctorCreated ? randomUUID().replace(/-/g, "") : null,
        doctor_proposed_note: isDoctorCreated
          ? normalizeText(payload.doctorProposedNote)
          : null,
        doctor_proposed_at: isDoctorCreated ? now : null,
        patient_response_note: null,
        patient_responded_at: null,
      })
      .select("id")
      .single(),
  );

  if (error || !data) {
    if (isAppointmentSchemaMismatchError(error)) {
      const legacyInsert = await writeSupabase
        .from("appointments")
        .insert({
          patient_id: patientId,
          doctor_id: payload.doctorId,
          requested_by: auth.userId,
          request_note: isDoctorCreated
            ? appendLegacyNote(normalizeText(payload.requestNote), [
                normalizedConfirmationLink
                  ? `[Doctor link] ${normalizedConfirmationLink}`
                  : null,
                payload.doctorProposedNote
                  ? `[Doctor note] ${payload.doctorProposedNote}`
                  : null,
              ])
            : normalizeText(payload.requestNote),
          scheduled_at: isDoctorCreated ? scheduledAt : preferredAt,
          status: "pending",
        })
        .select("id")
        .single();

      if (!legacyInsert.error && legacyInsert.data) {
        return NextResponse.json({
          success: true,
          appointmentId: legacyInsert.data.id,
        });
      }
      return appointmentSchemaNotReadyResponse(error);
    }
    if (isAppointmentRlsPolicyError(error)) {
      return appointmentRlsNotReadyResponse(error);
    }
    return NextResponse.json({ error: error?.message ?? "ไม่สามารถสร้างคำขอนัดหมายได้" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    appointmentId: data.id,
  });
}

export async function PATCH(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = patchActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  await tryEnsureAppointmentSchema();

  const payload = parsed.data;
  const { data: appointment, error: appointmentError, legacyMode } =
    await selectAppointmentForAction(payload.appointmentId);

  if (appointmentError) {
    if (isAppointmentSchemaMismatchError(appointmentError)) {
      return appointmentSchemaNotReadyResponse(appointmentError);
    }
    return NextResponse.json({ error: appointmentError.message }, { status: 400 });
  }

  if (!appointment) {
    return NextResponse.json({ error: "ไม่พบนัดหมาย" }, { status: 404 });
  }

  if (auth.role === "patient" && appointment.patient_id !== auth.userId) {
    return forbidden("Patient cannot access this appointment");
  }
  if (auth.role === "caregiver") {
    const verificationSupabase = await createSupabaseServerClient();
    const canAccess = await canAccessPatientScope({
      supabase: verificationSupabase,
      role: auth.role,
      actorId: auth.userId,
      patientId: appointment.patient_id,
    });
    if (!canAccess) {
      return forbidden("Caregiver cannot access this appointment");
    }
  }
  if (auth.role === "doctor" && appointment.doctor_id !== auth.userId) {
    return forbidden("Doctor cannot access this appointment");
  }

  const now = new Date().toISOString();
  const writeSupabase = env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  if (legacyMode) {
    const legacyAppointment = appointment as AppointmentActionLegacyRow;

    if (payload.action === "doctor_propose") {
      if (auth.role === "patient" || auth.role === "caregiver") {
        return forbidden("Only doctor/admin can send confirmation link");
      }
      if (legacyAppointment.status === "completed") {
        return badRequest("Appointment already completed");
      }

      const scheduledAt = parseDateInput(payload.scheduledAt);
      if (!scheduledAt) {
        return badRequest("scheduledAt is invalid");
      }
      const normalizedConfirmationLink = normalizeText(payload.confirmationLink);
      if (!normalizedConfirmationLink) {
        return badRequest("confirmationLink is required");
      }

      const legacyNote = appendLegacyNote(legacyAppointment.request_note, [
        `[Doctor link] ${normalizedConfirmationLink}`,
        payload.note ? `[Doctor note] ${payload.note}` : null,
      ]);

      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          scheduled_at: scheduledAt,
          status: "pending",
          request_note: legacyNote,
          updated_at: now,
        })
        .eq("id", legacyAppointment.id);

      if (auth.role === "doctor") {
        updateQuery = updateQuery.eq("doctor_id", auth.userId);
      }

      const { error: updateError } = await updateQuery;

      if (updateError) {
        if (isAppointmentRlsPolicyError(updateError)) {
          return appointmentRlsNotReadyResponse(updateError);
        }
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        status: "pending",
      });
    }

    if (payload.action === "doctor_complete") {
      if (auth.role === "patient" || auth.role === "caregiver") {
        return forbidden("Only doctor/admin can close appointment");
      }

      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "completed",
          updated_at: now,
        })
        .eq("id", legacyAppointment.id);

      if (auth.role === "doctor") {
        updateQuery = updateQuery.eq("doctor_id", auth.userId);
      }

      const { error: updateError } = await updateQuery;

      if (updateError) {
        if (isAppointmentRlsPolicyError(updateError)) {
          return appointmentRlsNotReadyResponse(updateError);
        }
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, status: "completed" });
    }

    if (auth.role === "doctor") {
      return forbidden("Doctor cannot respond to patient confirmation link");
    }

    if (!hasLegacyDoctorLink(legacyAppointment.request_note)) {
      return badRequest("Doctor has not sent a confirmation link yet");
    }

    if (payload.action === "patient_accept") {
      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "confirmed",
          request_note: appendLegacyNote(legacyAppointment.request_note, [
            "[Patient accepted]",
            payload.note ? `[Patient note] ${payload.note}` : null,
          ]),
          updated_at: now,
        })
        .eq("id", legacyAppointment.id);

      if (auth.role === "patient") {
        updateQuery = updateQuery.eq("patient_id", auth.userId);
      }
      if (auth.role === "caregiver") {
        updateQuery = updateQuery.eq("patient_id", legacyAppointment.patient_id);
      }

      const { error: updateError } = await updateQuery;

      if (updateError) {
        if (isAppointmentRlsPolicyError(updateError)) {
          return appointmentRlsNotReadyResponse(updateError);
        }
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, status: "confirmed" });
    }

    if (payload.action === "patient_decline") {
      const cancellationReason = getRequiredCancellationReason(payload.note);
      if (!cancellationReason) {
        return badRequest("Please provide a cancellation reason (at least 3 characters)");
      }

      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "completed",
          request_note: appendLegacyNote(legacyAppointment.request_note, [
            "[Patient declined]",
            `[Patient note] ${cancellationReason}`,
          ]),
          updated_at: now,
        })
        .eq("id", legacyAppointment.id);

      if (auth.role === "patient") {
        updateQuery = updateQuery.eq("patient_id", auth.userId);
      }
      if (auth.role === "caregiver") {
        updateQuery = updateQuery.eq("patient_id", legacyAppointment.patient_id);
      }

      const { error: updateError } = await updateQuery;

      if (updateError) {
        if (isAppointmentRlsPolicyError(updateError)) {
          return appointmentRlsNotReadyResponse(updateError);
        }
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, status: "completed" });
    }

    const preferredAt = parseDateInput(payload.preferredAt);
    if (payload.preferredAt && !preferredAt) {
      return badRequest("preferredAt is invalid");
    }

    let updateQuery = writeSupabase
      .from("appointments")
      .update({
        status: "pending",
        scheduled_at: preferredAt ?? legacyAppointment.scheduled_at,
        request_note: appendLegacyNote(legacyAppointment.request_note, [
          "[Patient requested reschedule]",
          payload.note ? `[Patient note] ${payload.note}` : null,
        ]),
        updated_at: now,
      })
      .eq("id", legacyAppointment.id);

    if (auth.role === "patient") {
      updateQuery = updateQuery.eq("patient_id", auth.userId);
    }
    if (auth.role === "caregiver") {
      updateQuery = updateQuery.eq("patient_id", legacyAppointment.patient_id);
    }

    const { error: updateError } = await updateQuery;

    if (updateError) {
      if (isAppointmentRlsPolicyError(updateError)) {
        return appointmentRlsNotReadyResponse(updateError);
      }
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: "pending" });
  }

  const richAppointment = appointment as AppointmentActionRow;

  if (payload.action === "doctor_propose") {
    if (auth.role === "patient" || auth.role === "caregiver") {
      return forbidden("Only doctor/admin can send confirmation link");
    }
    if (richAppointment.status === "completed") {
      return badRequest("Appointment already completed");
    }

    const scheduledAt = parseDateInput(payload.scheduledAt);
    if (!scheduledAt) {
      return badRequest("scheduledAt is invalid");
    }
    const normalizedConfirmationLink = normalizeText(payload.confirmationLink);
    if (!normalizedConfirmationLink) {
      return badRequest("confirmationLink is required");
    }

    const updates = {
      scheduled_at: scheduledAt,
      doctor_confirmation_link: normalizedConfirmationLink,
      doctor_confirmation_token: randomUUID().replace(/-/g, ""),
      doctor_proposed_note: normalizeText(payload.note),
      doctor_proposed_at: now,
      patient_response: "pending",
      patient_response_note: null,
      patient_responded_at: null,
      status: "pending",
      updated_at: now,
    };

    let updateQuery = writeSupabase
      .from("appointments")
      .update(updates)
      .eq("id", richAppointment.id);

    if (auth.role === "doctor") {
      updateQuery = updateQuery.eq("doctor_id", auth.userId);
    }

    const { data, error } = await withAppointmentWriteRecovery<{
      doctor_confirmation_token: string;
    }>(() =>
      updateQuery.select("doctor_confirmation_token").single(),
    );

    if (error) {
      if (isAppointmentSchemaMismatchError(error)) {
        return appointmentSchemaNotReadyResponse(error);
      }
      if (isAppointmentRlsPolicyError(error)) {
        return appointmentRlsNotReadyResponse(error);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data?.doctor_confirmation_token) {
      return NextResponse.json({ error: "ไม่สามารถสร้างโทเคนยืนยันนัดหมายได้" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      status: "pending",
      token: data.doctor_confirmation_token,
    });
  }

  if (payload.action === "doctor_complete") {
    if (auth.role === "patient" || auth.role === "caregiver") {
      return forbidden("Only doctor/admin can close appointment");
    }

    if (richAppointment.status === "completed") {
      return NextResponse.json({ success: true, status: "completed" });
    }

    if (richAppointment.status !== "confirmed") {
      return badRequest("Appointment must be confirmed before completing");
    }

    const { error } = await withAppointmentWriteRecovery(() => {
      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "completed",
          updated_at: now,
        })
        .eq("id", richAppointment.id);

      if (auth.role === "doctor") {
        updateQuery = updateQuery.eq("doctor_id", auth.userId);
      }

      return updateQuery;
    });

    if (error) {
      if (isAppointmentSchemaMismatchError(error)) {
        return appointmentSchemaNotReadyResponse(error);
      }
      if (isAppointmentRlsPolicyError(error)) {
        return appointmentRlsNotReadyResponse(error);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: "completed" });
  }

  if (auth.role === "doctor") {
    return forbidden("Doctor cannot respond to patient confirmation link");
  }

  if (!richAppointment.doctor_confirmation_link || !richAppointment.doctor_confirmation_token) {
    return badRequest("Doctor has not sent a confirmation link yet");
  }

  if (!payload.token) {
    return badRequest("Confirmation link token is required");
  }

  if (payload.token !== richAppointment.doctor_confirmation_token) {
    return forbidden("Confirmation link token is invalid");
  }

  if (payload.action === "patient_accept") {
    const { error } = await withAppointmentWriteRecovery(() => {
      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "confirmed",
          patient_response: "accepted",
          patient_response_note: normalizeText(payload.note),
          patient_responded_at: now,
          updated_at: now,
        })
        .eq("id", richAppointment.id);

      if (auth.role === "patient") {
        updateQuery = updateQuery.eq("patient_id", auth.userId);
      }
      if (auth.role === "caregiver") {
        updateQuery = updateQuery.eq("patient_id", richAppointment.patient_id);
      }

      return updateQuery;
    });

    if (error) {
      if (isAppointmentSchemaMismatchError(error)) {
        return appointmentSchemaNotReadyResponse(error);
      }
      if (isAppointmentRlsPolicyError(error)) {
        return appointmentRlsNotReadyResponse(error);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: "confirmed" });
  }

  if (payload.action === "patient_decline") {
    const cancellationReason = getRequiredCancellationReason(payload.note);
    if (!cancellationReason) {
      return badRequest("Please provide a cancellation reason (at least 3 characters)");
    }

    const { error } = await withAppointmentWriteRecovery(() => {
      let updateQuery = writeSupabase
        .from("appointments")
        .update({
          status: "completed",
          patient_response: "declined",
          patient_response_note: cancellationReason,
          patient_responded_at: now,
          updated_at: now,
        })
        .eq("id", richAppointment.id);

      if (auth.role === "patient") {
        updateQuery = updateQuery.eq("patient_id", auth.userId);
      }
      if (auth.role === "caregiver") {
        updateQuery = updateQuery.eq("patient_id", richAppointment.patient_id);
      }

      return updateQuery;
    });

    if (error) {
      if (isAppointmentSchemaMismatchError(error)) {
        return appointmentSchemaNotReadyResponse(error);
      }
      if (isAppointmentRlsPolicyError(error)) {
        return appointmentRlsNotReadyResponse(error);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: "completed" });
  }

  const preferredAt = parseDateInput(payload.preferredAt);
  if (payload.preferredAt && !preferredAt) {
    return badRequest("preferredAt is invalid");
  }

  const { error } = await withAppointmentWriteRecovery(() => {
    let updateQuery = writeSupabase
      .from("appointments")
      .update({
        status: "pending",
        patient_response: "reschedule_requested",
        patient_response_note: normalizeText(payload.note),
        patient_preferred_at: preferredAt ?? richAppointment.patient_preferred_at,
        patient_responded_at: now,
        updated_at: now,
      })
      .eq("id", richAppointment.id);

    if (auth.role === "patient") {
      updateQuery = updateQuery.eq("patient_id", auth.userId);
    }
    if (auth.role === "caregiver") {
      updateQuery = updateQuery.eq("patient_id", richAppointment.patient_id);
    }

    return updateQuery;
  });

  if (error) {
    if (isAppointmentSchemaMismatchError(error)) {
      return appointmentSchemaNotReadyResponse(error);
    }
    if (isAppointmentRlsPolicyError(error)) {
      return appointmentRlsNotReadyResponse(error);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, status: "pending" });
}
