import { requireRole } from "@/lib/auth/session";
import { readOnboardingProfileFromMetadata } from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getPatientScanContext = async () => {
  const session = await requireRole(["patient", "admin"]);
  const supabase = await createSupabaseServerClient();

  const [{ data: onboardingProfile }, userResult] = await Promise.all([
    supabase
      .from("user_onboarding_profiles")
      .select("biological_sex, bmi")
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  const metadataFallback = userResult.data.user
    ? readOnboardingProfileFromMetadata(userResult.data.user)
    : null;

  const biologicalSex =
    (onboardingProfile?.biological_sex as "female" | "male" | null) ??
    metadataFallback?.biological_sex ??
    null;
  const bmiFromTable = Number(onboardingProfile?.bmi ?? 0);
  const bmiFromMetadata = Number(metadataFallback?.bmi ?? 0);
  const bmi =
    Number.isFinite(bmiFromTable) && bmiFromTable > 0
      ? bmiFromTable
      : Number.isFinite(bmiFromMetadata) && bmiFromMetadata > 0
        ? bmiFromMetadata
        : null;

  return {
    session,
    biologicalSex,
    bmi,
  };
};
