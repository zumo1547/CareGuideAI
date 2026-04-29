import { addDays, format } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { normalizeScheduleInput } from "@/lib/medications/schedule";
import { searchOpenFdaMedicines } from "@/lib/openfda";
import { hasTwilioConfig } from "@/lib/reminders/twilio-sms-provider";
import {
  parseMedicationDetailsFromText,
  validateParsedMedicationDetails,
} from "@/lib/scan/ocr";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
});

const toDateIso = (date: Date) => format(date, "yyyy-MM-dd");

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const payload = parsed.data;
  const patientId = payload.patientId ?? auth.userId;
  if (auth.role === "patient" && patientId !== auth.userId) {
    return forbidden("Patient can only create own medication plan");
  }

  const supabase = await createSupabaseServerClient();

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

  if (auth.role === "doctor" && patientId !== auth.userId) {
    const { data: link } = await supabase
      .from("patient_doctor_links")
      .select("id")
      .eq("doctor_id", auth.userId)
      .eq("patient_id", patientId)
      .maybeSingle();

    if (!link) {
      return forbidden("Doctor can only create plans for assigned patients");
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
    return NextResponse.json({ error: "ไม่สามารถสร้างข้อมูลยาได้" }, { status: 400 });
  }

  const scheduleTimes = normalizeScheduleInput(payload.schedule);
  if (!scheduleTimes.length) {
    return badRequest("At least one schedule time is required");
  }

  const { data: plan, error: planError } = await supabase
    .from("medication_plans")
    .insert({
      patient_id: patientId,
      medicine_id: medicine.id,
      prescribed_by: auth.userId,
      dosage: payload.dosage,
      notes: payload.notes ?? null,
      start_date: toDateIso(new Date()),
      is_active: true,
    })
    .select("id")
    .single();

  if (planError || !plan) {
    return NextResponse.json({ error: planError?.message ?? "สร้าง plan ไม่สำเร็จ" }, { status: 400 });
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

  const reminderRows = [0, 1]
    .flatMap((offset) => {
      const date = addDays(new Date(), offset);
      const dateIso = toDateIso(date);
      return scheduleTimes.flatMap((item) => {
        const dueAt = new Date(`${dateIso}T${item.time24}:00`);
        return [
          {
            patient_id: patientId,
            plan_id: plan.id,
            channel: "sms" as const,
            due_at: dueAt.toISOString(),
            status: "pending",
            provider: hasTwilioConfig() ? "twilio" : "mock-sms",
          },
          {
            patient_id: patientId,
            plan_id: plan.id,
            channel: "voice" as const,
            due_at: dueAt.toISOString(),
            status: "pending",
            provider: "web-tts",
          },
        ];
      });
    })
    .sort((a, b) => a.due_at.localeCompare(b.due_at));

  const { error: reminderInsertError } = await supabase.from("reminder_events").insert(reminderRows);
  if (reminderInsertError) {
    return NextResponse.json(
      {
        error: `Failed to create reminder events: ${reminderInsertError.message}`,
        details: {
          code: reminderInsertError.code ?? null,
          planId: plan.id,
          reminderRows: reminderRows.length,
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
    reminderEventsCreated: reminderRows.length,
  });
}
