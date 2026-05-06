import { addDays, format, startOfDay } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { normalizeScheduleInput, type NormalizedScheduleTime } from "@/lib/medications/schedule";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { hasTwilioConfig } from "@/lib/reminders/twilio-sms-provider";
import {
  parseMedicationDetailsFromText,
  validateParsedMedicationDetails,
} from "@/lib/scan/ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type MedicationType = "prescription" | "otc";
type ReminderMode = "until_exhausted" | "until_date";
type PostgrestLikeError = { message?: string; code?: string | null } | null | undefined;

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REMINDER_DAYS = 730;
const MAX_REMINDER_ROWS = 5000;
const MEDICATION_PLAN_NEW_COLUMNS = [
  "medication_type",
  "doctor_ordered_detected",
  "total_pills",
  "remaining_pills",
  "pills_per_dose",
  "reminder_mode",
  "reminder_until_date",
  "exhausted_at",
] as const;

const schema = z.object({
  patientId: z.uuid().optional(),
  medicineQuery: z.string().min(2),
  selectedSourceId: z.string().optional(),
  dosage: z.string().min(1),
  notes: z.string().optional(),
  ocrRawText: z.string().optional(),
  schedule: z.object({
    presets: z.array(z.enum(["morning", "noon", "evening"])).default([]),
    customTimes: z.array(z.string()).default([]),
  }),
  medicationType: z.enum(["prescription", "otc"]).nullable().optional(),
  doctorOrderedDetected: z.boolean().nullable().optional(),
  totalPills: z.number().int().positive().max(5000).nullable().optional(),
  pillsPerDose: z.number().positive().max(50).nullable().optional(),
  reminderMode: z.enum(["until_exhausted", "until_date"]).nullable().optional(),
  reminderUntilDate: z.string().regex(DATE_ONLY_REGEX).nullable().optional(),
});

const toDateIso = (date: Date) => format(date, "yyyy-MM-dd");

const isMedicationPlansSchemaCacheError = (error: PostgrestLikeError) => {
  if (!error?.message) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("medication_plans") &&
    (message.includes("schema cache") || message.includes("could not find the"))
  );
};

const hasMissingMedicationPlanColumn = (error: PostgrestLikeError) => {
  if (!isMedicationPlansSchemaCacheError(error) || !error?.message) return false;
  const message = error.message.toLowerCase();
  return MEDICATION_PLAN_NEW_COLUMNS.some((column) => message.includes(column));
};

const parseDoseFromDosageText = (dosage: string) => {
  const thaiMatch = dosage.match(/ครั้งละ\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (thaiMatch?.[1]) {
    const parsed = Number(thaiMatch[1].replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) return Number(parsed.toFixed(2));
  }

  const englishMatch = dosage.match(/(?:take|dose)\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (englishMatch?.[1]) {
    const parsed = Number(englishMatch[1].replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) return Number(parsed.toFixed(2));
  }

  return 1;
};

const createDueAtFromLocalDateAndTime = (date: Date, time24: string) => {
  const dateIso = toDateIso(date);
  return new Date(`${dateIso}T${time24}:00`);
};

const isValidFutureDateOnly = (value: string | null | undefined) => {
  if (!value || !DATE_ONLY_REGEX.test(value)) return false;
  const asDate = new Date(`${value}T23:59:59`);
  return Number.isFinite(asDate.getTime());
};

const buildDueSlotsUntilExhausted = ({
  now,
  scheduleTimes,
  totalPills,
  pillsPerDose,
}: {
  now: Date;
  scheduleTimes: NormalizedScheduleTime[];
  totalPills: number;
  pillsPerDose: number;
}) => {
  const requiredDoses = Math.max(1, Math.ceil(totalPills / pillsPerDose));
  const slots: Date[] = [];
  const cutoff = now.getTime() - 60_000;
  const todayStart = startOfDay(now);

  for (let dayOffset = 0; dayOffset < MAX_REMINDER_DAYS && slots.length < requiredDoses; dayOffset += 1) {
    const date = addDays(todayStart, dayOffset);

    for (const scheduleTime of scheduleTimes) {
      const dueAt = createDueAtFromLocalDateAndTime(date, scheduleTime.time24);
      if (dueAt.getTime() <= cutoff) {
        continue;
      }

      slots.push(dueAt);
      if (slots.length >= requiredDoses) {
        break;
      }
    }
  }

  return { slots, requiredDoses };
};

const buildDueSlotsUntilDate = ({
  now,
  scheduleTimes,
  reminderUntilDate,
}: {
  now: Date;
  scheduleTimes: NormalizedScheduleTime[];
  reminderUntilDate: string;
}) => {
  const untilBoundary = new Date(`${reminderUntilDate}T23:59:59`);
  const slots: Date[] = [];
  const cutoff = now.getTime() - 60_000;
  const todayStart = startOfDay(now);

  for (let dayOffset = 0; dayOffset < MAX_REMINDER_DAYS; dayOffset += 1) {
    const date = addDays(todayStart, dayOffset);
    if (date.getTime() > untilBoundary.getTime()) {
      break;
    }

    for (const scheduleTime of scheduleTimes) {
      const dueAt = createDueAtFromLocalDateAndTime(date, scheduleTime.time24);
      if (dueAt.getTime() <= cutoff || dueAt.getTime() > untilBoundary.getTime()) {
        continue;
      }
      slots.push(dueAt);
    }
  }

  return slots;
};

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const patientId = payload.patientId ?? auth.userId;
  const supabase = await createSupabaseServerClient();

  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot create medication plan for this patient");
  }

  if (payload.ocrRawText?.trim()) {
    const parsedOcr = parseMedicationDetailsFromText(payload.ocrRawText);
    const ocrValidation = validateParsedMedicationDetails(parsedOcr);
    const hasStrongManualInput =
      payload.medicineQuery.trim().length >= 4 && payload.dosage.trim().length >= 4;
    if (!ocrValidation.canConfirm && !hasStrongManualInput) {
      return badRequest(`OCR quality too low: ${ocrValidation.messageTh}`, {
        ocrValidation,
      });
    }
  }

  let medicine =
    (
      await supabase
        .from("medicines")
        .select("id, name")
        .or(
          payload.selectedSourceId
            ? `id.eq.${payload.selectedSourceId},external_id.eq.${payload.selectedSourceId}`
            : `name.ilike.%${payload.medicineQuery}%`,
        )
        .limit(1)
        .maybeSingle()
    ).data ?? null;

  if (!medicine) {
    const remote = await searchOpenFdaMedicines(payload.medicineQuery);
    const picked =
      remote.find((item) => item.sourceId === payload.selectedSourceId) ??
      remote.find((item) => item.name.toLowerCase() === payload.medicineQuery.toLowerCase()) ??
      remote[0] ??
      null;

    if (picked) {
      const inserted = await supabase
        .from("medicines")
        .insert({
          external_source: picked.source,
          external_id: picked.sourceId,
          name: picked.name,
          generic_name: picked.genericName,
          dosage_form: picked.dosageForm,
          strength: picked.strength,
          barcode: picked.barcode,
          created_by: auth.userId,
        })
        .select("id, name")
        .single();
      medicine = inserted.data ?? null;
    } else {
      const inserted = await supabase
        .from("medicines")
        .insert({
          name: payload.medicineQuery,
          created_by: auth.userId,
        })
        .select("id, name")
        .single();
      medicine = inserted.data ?? null;
    }
  }

  if (!medicine) {
    return NextResponse.json({ error: "Cannot create medicine record" }, { status: 400 });
  }

  const scheduleTimes = normalizeScheduleInput(payload.schedule);
  if (!scheduleTimes.length) {
    return badRequest("At least one schedule time is required");
  }

  const now = new Date();
  const pillsPerDose = payload.pillsPerDose ?? parseDoseFromDosageText(payload.dosage);
  if (!Number.isFinite(pillsPerDose) || pillsPerDose <= 0) {
    return badRequest("Invalid pillsPerDose value");
  }

  const medicationType: MedicationType = payload.medicationType ?? (payload.totalPills ? "prescription" : "otc");
  let reminderMode: ReminderMode =
    payload.reminderMode ?? (medicationType === "prescription" ? "until_exhausted" : "until_date");

  let reminderUntilDate: string | null = payload.reminderUntilDate ?? null;
  let totalPills = payload.totalPills ?? null;

  if (reminderMode === "until_exhausted" && (!totalPills || totalPills <= 0)) {
    if (payload.medicationType === "prescription" || payload.reminderMode === "until_exhausted") {
      return badRequest("Prescription medicines require totalPills for until-exhausted reminders");
    }

    // Backward compatibility for older clients that don't send policy fields.
    reminderMode = "until_date";
    reminderUntilDate = toDateIso(addDays(now, 2));
  }

  if (reminderMode === "until_date") {
    if (!reminderUntilDate) {
      reminderUntilDate = toDateIso(addDays(now, 7));
    }

    if (!isValidFutureDateOnly(reminderUntilDate)) {
      return badRequest("Invalid reminderUntilDate. Expected format YYYY-MM-DD");
    }
  }

  if (totalPills && totalPills <= 0) {
    totalPills = null;
  }

  let dueSlots: Date[] = [];
  let expectedDoses: number | null = null;

  if (reminderMode === "until_exhausted") {
    const generated = buildDueSlotsUntilExhausted({
      now,
      scheduleTimes,
      totalPills: totalPills as number,
      pillsPerDose,
    });
    dueSlots = generated.slots;
    expectedDoses = generated.requiredDoses;

    if (dueSlots.length < generated.requiredDoses) {
      return badRequest("Unable to generate enough reminder slots for until-exhausted mode");
    }
  } else {
    dueSlots = buildDueSlotsUntilDate({
      now,
      scheduleTimes,
      reminderUntilDate: reminderUntilDate as string,
    });
  }

  if (!dueSlots.length) {
    return badRequest("No reminder slots generated. Please adjust schedule or reminder end date");
  }

  const reminderRows = dueSlots
    .flatMap((dueAt) => [
      {
        patient_id: patientId,
        plan_id: "",
        channel: "sms" as const,
        due_at: dueAt.toISOString(),
        status: "pending",
        provider: hasTwilioConfig() ? "twilio" : "mock-sms",
      },
      {
        patient_id: patientId,
        plan_id: "",
        channel: "voice" as const,
        due_at: dueAt.toISOString(),
        status: "pending",
        provider: "web-tts",
      },
    ])
    .sort((a, b) => a.due_at.localeCompare(b.due_at));

  if (reminderRows.length > MAX_REMINDER_ROWS) {
    return badRequest(
      `Too many reminder events (${reminderRows.length}). Please shorten schedule duration or reduce pill count`,
    );
  }

  const advancedPlanInsert = {
    patient_id: patientId,
    medicine_id: medicine.id,
    prescribed_by: auth.userId,
    dosage: payload.dosage,
    notes: payload.notes ?? null,
    start_date: toDateIso(now),
    end_date: reminderMode === "until_date" ? reminderUntilDate : null,
    is_active: true,
    medication_type: medicationType,
    doctor_ordered_detected: payload.doctorOrderedDetected ?? null,
    total_pills: totalPills,
    remaining_pills: totalPills,
    pills_per_dose: pillsPerDose,
    reminder_mode: reminderMode,
    reminder_until_date: reminderMode === "until_date" ? reminderUntilDate : null,
    exhausted_at: null,
  };

  const fallbackEndDate =
    reminderMode === "until_date"
      ? reminderUntilDate
      : dueSlots.length
        ? toDateIso(dueSlots[dueSlots.length - 1] as Date)
        : null;

  const legacyPlanInsert = {
    patient_id: patientId,
    medicine_id: medicine.id,
    prescribed_by: auth.userId,
    dosage: payload.dosage,
    notes: payload.notes ?? null,
    start_date: toDateIso(now),
    end_date: fallbackEndDate,
    is_active: true,
  };

  let usedLegacySchemaFallback = false;
  let plan: { id: string } | null = null;
  let planError: { message?: string; code?: string | null } | null = null;

  {
    const firstAttempt = await supabase
      .from("medication_plans")
      .insert(advancedPlanInsert)
      .select("id")
      .single();
    plan = firstAttempt.data;
    planError = firstAttempt.error;
  }

  if ((planError || !plan) && hasMissingMedicationPlanColumn(planError)) {
    const secondAttempt = await supabase
      .from("medication_plans")
      .insert(legacyPlanInsert)
      .select("id")
      .single();
    plan = secondAttempt.data;
    planError = secondAttempt.error;
    usedLegacySchemaFallback = !secondAttempt.error;
  }

  if (planError || !plan) {
    return NextResponse.json({ error: planError?.message ?? "Cannot create medication plan" }, { status: 400 });
  }

  const { error: scheduleError } = await supabase.from("medication_schedule_times").insert(
    scheduleTimes.map((item) => ({
      plan_id: plan.id,
      label: item.label,
      time_of_day: `${item.time24}:00`,
      source: item.source,
    })),
  );

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 400 });
  }

  const reminderRowsWithPlan = reminderRows.map((row) => ({
    ...row,
    plan_id: plan.id,
  }));

  const { error: reminderInsertError } = await supabase.from("reminder_events").insert(reminderRowsWithPlan);
  if (reminderInsertError) {
    return NextResponse.json(
      {
        error: `Failed to create reminder events: ${reminderInsertError.message}`,
        details: {
          code: reminderInsertError.code ?? null,
          planId: plan.id,
          reminderRows: reminderRowsWithPlan.length,
        },
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    planId: plan.id,
    medicine,
    scheduleTimes,
    reminderEventsCreated: reminderRowsWithPlan.length,
    reminderMode,
    medicationType,
    totalDosesExpected: expectedDoses,
    totalPills,
    pillsPerDose,
    reminderUntilDate,
    schemaFallback: usedLegacySchemaFallback,
    warning: usedLegacySchemaFallback
      ? "Supabase schema cache is not updated yet for new medication columns. Plan was saved in compatibility mode."
      : null,
  });
}
