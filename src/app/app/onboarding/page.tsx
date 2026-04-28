import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/profile/onboarding-form";
import { requireSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/constants";
import type { OnboardingProfile } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("user_onboarding_profiles")
    .select(
      "user_id, disability_type, disability_other, disability_severity, chronic_conditions, regular_medications, drug_allergies, baseline_blood_pressure, baseline_blood_sugar, weight_kg, height_cm, bmi, need_tts, need_large_text, need_large_buttons, need_navigation_guidance, completed_at, created_at, updated_at",
    )
    .eq("user_id", session.userId)
    .maybeSingle();

  if (data) {
    redirect(ROLE_HOME[session.profile.role]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <OnboardingForm initialProfile={data as OnboardingProfile | null} mode="onboarding" />
    </div>
  );
}
