import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  planId: z.uuid(),
  scheduledFor: z.string(),
  status: z.enum(["taken", "missed"]),
  notes: z.string().max(500).optional(),
});

const isMedicationPlansSchemaCacheError = (message: string | undefined) => {
  const lowered = (message ?? "").toLowerCase();
  return (
    lowered.includes("medication_plans") &&
    lowered.includes("schema cache") &&
    lowered.includes("could not find the")
  );
};

const isStatusConstraintError = (message: string | undefined, code: string | null | undefined) =>
  code === "23514" || (message ?? "").toLowerCase().includes("reminder_events_status_check");

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
  const scheduledForIso = new Date(payload.scheduledFor).toISOString();
  if (Number.isNaN(new Date(scheduledForIso).getTime())) {
    return badRequest("Invalid scheduledFor datetime");
  }

  const supabase = await createSupabaseServerClient();

  let plan: {
    id: string;
    patient_id: string;
    is_active: boolean;
    remaining_pills: number | null;
    pills_per_dose: number | null;
    reminder_mode: string | null;
  } | null = null;

  let legacyPlanSchemaMode = false;

  const fullPlanResponse = await supabase
    .from("medication_plans")
    .select("id, patient_id, remaining_pills, pills_per_dose, reminder_mode, is_active")
    .eq("id", payload.planId)
    .maybeSingle();

  if (fullPlanResponse.error && isMedicationPlansSchemaCacheError(fullPlanResponse.error.message)) {
    const fallbackPlanResponse = await supabase
      .from("medication_plans")
      .select("id, patient_id, is_active")
      .eq("id", payload.planId)
      .maybeSingle();

    if (fallbackPlanResponse.error) {
      return NextResponse.json({ error: fallbackPlanResponse.error.message }, { status: 400 });
    }

    if (fallbackPlanResponse.data) {
      plan = {
        id: fallbackPlanResponse.data.id,
        patient_id: fallbackPlanResponse.data.patient_id,
        is_active: Boolean(fallbackPlanResponse.data.is_active),
        remaining_pills: null,
        pills_per_dose: null,
        reminder_mode: null,
      };
      legacyPlanSchemaMode = true;
    }
  } else {
    if (fullPlanResponse.error) {
      return NextResponse.json({ error: fullPlanResponse.error.message }, { status: 400 });
    }

    if (fullPlanResponse.data) {
      plan = {
        id: fullPlanResponse.data.id,
        patient_id: fullPlanResponse.data.patient_id,
        is_active: Boolean(fullPlanResponse.data.is_active),
        remaining_pills:
          fullPlanResponse.data.remaining_pills === null
            ? null
            : Number(fullPlanResponse.data.remaining_pills),
        pills_per_dose:
          fullPlanResponse.data.pills_per_dose === null
            ? null
            : Number(fullPlanResponse.data.pills_per_dose),
        reminder_mode: fullPlanResponse.data.reminder_mode,
      };
    }
  }

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (auth.role === "patient" && plan.patient_id !== auth.userId) {
    return forbidden("Cannot update adherence for other patient");
  }

  const { data: existingLog } = await supabase
    .from("adherence_logs")
    .select("status")
    .eq("plan_id", payload.planId)
    .eq("scheduled_for", scheduledForIso)
    .maybeSingle();

  const values = {
    plan_id: payload.planId,
    patient_id: plan.patient_id,
    scheduled_for: scheduledForIso,
    taken_at: payload.status === "taken" ? new Date().toISOString() : null,
    status: payload.status,
    notes: payload.notes ?? null,
  };

  const { error } = await supabase
    .from("adherence_logs")
    .upsert(values, { onConflict: "plan_id,scheduled_for" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const shouldDecrementInventory = payload.status === "taken" && existingLog?.status !== "taken";

  if (!legacyPlanSchemaMode && shouldDecrementInventory && plan.remaining_pills !== null) {
    const pillsPerDoseRaw = Number(plan.pills_per_dose ?? 1);
    const pillsPerDose = Number.isFinite(pillsPerDoseRaw) && pillsPerDoseRaw > 0 ? pillsPerDoseRaw : 1;
    const currentRemaining = Number(plan.remaining_pills ?? 0);
    const nextRemaining = Math.max(0, Number((currentRemaining - pillsPerDose).toFixed(2)));

    const planUpdatePayload: {
      remaining_pills: number;
      is_active?: boolean;
      exhausted_at?: string;
    } = {
      remaining_pills: nextRemaining,
    };

    if (plan.reminder_mode === "until_exhausted" && nextRemaining <= 0) {
      planUpdatePayload.is_active = false;
      planUpdatePayload.exhausted_at = new Date().toISOString();
    }

    await supabase.from("medication_plans").update(planUpdatePayload).eq("id", payload.planId);

    if (plan.reminder_mode === "until_exhausted" && nextRemaining <= 0) {
      const nowIso = new Date().toISOString();
      const cancelPayload = {
        status: "cancelled",
        sent_at: nowIso,
        provider: "auto-exhausted",
        provider_response: {
          source: "adherence-log",
          exhaustedAt: nowIso,
        },
      };

      let { error: cancelError } = await supabase
        .from("reminder_events")
        .update(cancelPayload)
        .eq("plan_id", payload.planId)
        .eq("status", "pending");

      if (isStatusConstraintError(cancelError?.message, cancelError?.code)) {
        const legacyPayload = {
          status: "failed",
          sent_at: nowIso,
          provider: "auto-exhausted",
          provider_response: {
            source: "adherence-log",
            exhaustedAt: nowIso,
            legacyCancelled: true,
          },
        };

        const legacyFallback = await supabase
          .from("reminder_events")
          .update(legacyPayload)
          .eq("plan_id", payload.planId)
          .eq("status", "pending");

        cancelError = legacyFallback.error;
      }

      if (cancelError) {
        return NextResponse.json({ error: cancelError.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ success: true });
}
