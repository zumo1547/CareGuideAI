import { NextResponse } from "next/server";

import { calculateBmi, onboardingSchema } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SELECT_COLUMNS = `
  user_id,
  disability_type,
  disability_other,
  disability_severity,
  chronic_conditions,
  regular_medications,
  drug_allergies,
  baseline_blood_pressure,
  baseline_blood_sugar,
  weight_kg,
  height_cm,
  bmi,
  need_tts,
  need_large_text,
  need_large_buttons,
  need_navigation_guidance,
  completed_at,
  created_at,
  updated_at
`;

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .select(SELECT_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    completed: Boolean(data),
    profile: data ?? null,
  });
}

export async function POST(request: Request) {
  const parsed = onboardingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid onboarding payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  const payload = parsed.data;
  const bmi = calculateBmi(payload.weightKg, payload.heightCm);

  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .upsert(
      {
        user_id: user.id,
        disability_type: payload.disabilityType,
        disability_other: payload.disabilityType === "other" ? payload.disabilityOther.trim() : null,
        disability_severity: payload.disabilitySeverity,
        chronic_conditions: payload.chronicConditions,
        regular_medications: payload.regularMedications,
        drug_allergies: payload.drugAllergies,
        baseline_blood_pressure: payload.baselineBloodPressure,
        baseline_blood_sugar: payload.baselineBloodSugar,
        weight_kg: payload.weightKg,
        height_cm: payload.heightCm,
        bmi,
        need_tts: payload.needTts,
        need_large_text: payload.needLargeText,
        need_large_buttons: payload.needLargeButtons,
        need_navigation_guidance: payload.needNavigationGuidance,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    profile: data,
  });
}
