import { format } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { getCaregiverSchemaDiagnostics } from "@/lib/caregiver-schema-bootstrap";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import {
  CAREGIVER_SCHEMA_CACHE_MESSAGE,
  getSupabaseProjectRefFromEnv,
  isCaregiverSchemaCacheError,
} from "@/lib/caregiver-schema-errors";
import { withCaregiverSchemaRecovery } from "@/lib/caregiver-schema-retry";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createRoutineSchema = z.object({
  patientId: z.uuid(),
  routineDate: z.string().regex(DATE_ONLY_REGEX).optional(),
  timeSlot: z.enum(["morning", "noon", "evening", "night", "custom"]),
  timeText: z.string().trim().max(30).optional(),
  taskText: z.string().trim().min(2).max(500),
});

const updateRoutineSchema = z.object({
  routineId: z.uuid(),
  isDone: z.boolean().optional(),
  timeSlot: z.enum(["morning", "noon", "evening", "night", "custom"]).optional(),
  timeText: z.string().trim().max(30).optional(),
  taskText: z.string().trim().min(2).max(500).optional(),
});

const deleteRoutineSchema = z.object({
  routineId: z.uuid(),
});

type CaregiverRoutineRow = {
  id: string;
  caregiver_id: string;
  patient_id: string;
  routine_date: string;
  time_slot: "morning" | "noon" | "evening" | "night" | "custom";
  time_text: string | null;
  task_text: string;
  is_done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

type CaregiverRoutineCheckRow = {
  id: string;
  caregiver_id: string;
  patient_id: string;
  is_done: boolean;
};

type CaregiverRoutineDeleteRow = {
  id: string;
  caregiver_id: string;
  patient_id: string;
};

const toDateValue = (input: string | null | undefined) => {
  if (!input || !DATE_ONLY_REGEX.test(input)) return format(new Date(), "yyyy-MM-dd");
  return input;
};

const timeSlotOrder: Record<string, number> = {
  morning: 1,
  noon: 2,
  evening: 3,
  night: 4,
  custom: 5,
};

const caregiverSchemaNotReadyResponse = (rawErrorMessage?: string) => {
  const diagnostics = getCaregiverSchemaDiagnostics();
  return NextResponse.json(
    {
      error: CAREGIVER_SCHEMA_CACHE_MESSAGE,
      code: "CAREGIVER_SCHEMA_CACHE_NOT_READY",
      schemaReloadSql: "NOTIFY pgrst, 'reload schema';",
      projectRefHint: getSupabaseProjectRefFromEnv(),
      envHint:
        diagnostics.hasRefMismatch && diagnostics.supabaseRef
          ? `Supabase ref=${diagnostics.supabaseRef}, Postgres ref=${diagnostics.postgresRefs.join(",") || "-"}`
          : null,
      rawErrorMessage: rawErrorMessage ?? null,
    },
    { status: 503 },
  );
};

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { searchParams } = new URL(request.url);
  const patientId = searchParams.get("patientId") ?? auth.userId;
  const routineDate = toDateValue(searchParams.get("date"));
  const caregiverId = searchParams.get("caregiverId");

  const supabase = await createSupabaseServerClient();
  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot read routine for this patient");
  }

  let query = supabase
    .from("caregiver_daily_routines")
    .select("id, caregiver_id, patient_id, routine_date, time_slot, time_text, task_text, is_done, done_at, created_at, updated_at")
    .eq("patient_id", patientId)
    .eq("routine_date", routineDate)
    .order("created_at", { ascending: true });

  if (auth.role === "caregiver") {
    query = query.eq("caregiver_id", auth.userId);
  } else if (caregiverId && auth.role === "admin") {
    query = query.eq("caregiver_id", caregiverId);
  }

  const { data, error } = await withCaregiverSchemaRecovery<CaregiverRoutineRow[]>(() => query);
  if (error) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error.message);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data ?? []).sort((a, b) => {
    const slotDiff = (timeSlotOrder[a.time_slot] ?? 99) - (timeSlotOrder[b.time_slot] ?? 99);
    if (slotDiff !== 0) return slotDiff;
    return (a.time_text ?? "").localeCompare(b.time_text ?? "", "th");
  });

  return NextResponse.json({
    routines: rows.map((row) => ({
      id: row.id,
      caregiverId: row.caregiver_id,
      patientId: row.patient_id,
      routineDate: row.routine_date,
      timeSlot: row.time_slot,
      timeText: row.time_text,
      taskText: row.task_text,
      isDone: row.is_done,
      doneAt: row.done_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = createRoutineSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const supabase = await createSupabaseServerClient();
  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId: payload.patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot create routine for this patient");
  }

  const caregiverId = auth.userId;
  const routineDate = toDateValue(payload.routineDate);

  const { data, error } = await withCaregiverSchemaRecovery<CaregiverRoutineRow>(() =>
    supabase
      .from("caregiver_daily_routines")
      .insert({
        caregiver_id: caregiverId,
        patient_id: payload.patientId,
        routine_date: routineDate,
        time_slot: payload.timeSlot,
        time_text: payload.timeText || null,
        task_text: payload.taskText,
        created_by: auth.userId,
        is_done: false,
        done_at: null,
      })
      .select("id, caregiver_id, patient_id, routine_date, time_slot, time_text, task_text, is_done, done_at, created_at, updated_at")
      .single(),
  );

  if (error || !data) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error?.message);
    }
    return NextResponse.json({ error: error?.message ?? "Cannot create routine" }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    routine: {
      id: data.id,
      caregiverId: data.caregiver_id,
      patientId: data.patient_id,
      routineDate: data.routine_date,
      timeSlot: data.time_slot,
      timeText: data.time_text,
      taskText: data.task_text,
      isDone: data.is_done,
      doneAt: data.done_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

export async function PATCH(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = updateRoutineSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: routine, error: routineError } = await withCaregiverSchemaRecovery<CaregiverRoutineCheckRow | null>(() =>
    supabase
      .from("caregiver_daily_routines")
      .select("id, caregiver_id, patient_id, is_done")
      .eq("id", payload.routineId)
      .maybeSingle(),
  );

  if (routineError) {
    if (isCaregiverSchemaCacheError(routineError)) {
      return caregiverSchemaNotReadyResponse(routineError.message);
    }
    return NextResponse.json({ error: routineError.message }, { status: 400 });
  }
  if (!routine) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 });
  }

  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId: routine.patient_id,
  });
  if (!canAccess) {
    return forbidden("Cannot update routine for this patient");
  }

  if (auth.role === "caregiver" && routine.caregiver_id !== auth.userId) {
    return forbidden("Cannot update routines created by other caregivers");
  }

  const nextIsDone = payload.isDone ?? routine.is_done;
  const { error } = await withCaregiverSchemaRecovery(() =>
    supabase
      .from("caregiver_daily_routines")
      .update({
        is_done: nextIsDone,
        done_at: nextIsDone ? new Date().toISOString() : null,
        time_slot: payload.timeSlot,
        time_text: payload.timeText || null,
        task_text: payload.taskText,
      })
      .eq("id", payload.routineId),
  );

  if (error) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error.message);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const auth = await getApiAuthContext(["caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = deleteRoutineSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const supabase = await createSupabaseServerClient();
  const { data: routine, error: routineError } = await withCaregiverSchemaRecovery<CaregiverRoutineDeleteRow | null>(() =>
    supabase
      .from("caregiver_daily_routines")
      .select("id, caregiver_id, patient_id")
      .eq("id", parsed.data.routineId)
      .maybeSingle(),
  );

  if (routineError) {
    if (isCaregiverSchemaCacheError(routineError)) {
      return caregiverSchemaNotReadyResponse(routineError.message);
    }
    return NextResponse.json({ error: routineError.message }, { status: 400 });
  }
  if (!routine) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 });
  }

  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId: routine.patient_id,
  });
  if (!canAccess) {
    return forbidden("Cannot delete routine for this patient");
  }

  if (auth.role === "caregiver" && routine.caregiver_id !== auth.userId) {
    return forbidden("Cannot delete routines created by other caregivers");
  }

  const { error } = await withCaregiverSchemaRecovery(() =>
    supabase
      .from("caregiver_daily_routines")
      .delete()
      .eq("id", parsed.data.routineId),
  );

  if (error) {
    if (isCaregiverSchemaCacheError(error)) {
      return caregiverSchemaNotReadyResponse(error.message);
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
