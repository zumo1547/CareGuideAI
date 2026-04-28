import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/profile/onboarding-form";
import { requireSession } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/constants";
import type { OnboardingProfile } from "@/lib/onboarding";
import {
  isSchemaCacheMissingError,
  ONBOARDING_PROFILE_SELECT_COLUMNS,
  readOnboardingProfileFromMetadata,
} from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .select(ONBOARDING_PROFILE_SELECT_COLUMNS)
    .eq("user_id", session.userId)
    .maybeSingle();

  const metadataProfile = user ? readOnboardingProfileFromMetadata(user) : null;
  const fallbackProfile =
    error && isSchemaCacheMissingError(error) ? metadataProfile : null;
  const activeProfile = (data ?? fallbackProfile) as OnboardingProfile | null;

  if (activeProfile) {
    redirect(ROLE_HOME[session.profile.role]);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <OnboardingForm initialProfile={activeProfile} mode="onboarding" />
    </div>
  );
}
