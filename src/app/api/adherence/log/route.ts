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
  const supabase = await createSupabaseServerClient();

  const { data: plan } = await supabase
    .from("medication_plans")
    .select("patient_id")
    .eq("id", payload.planId)
    .single();

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (auth.role === "patient" && plan.patient_id !== auth.userId) {
    return forbidden("Cannot update adherence for other patient");
  }

  const values = {
    plan_id: payload.planId,
    patient_id: plan.patient_id,
    scheduled_for: new Date(payload.scheduledFor).toISOString(),
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

  return NextResponse.json({ success: true });
}
