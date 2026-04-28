import { OnboardingForm } from "@/components/profile/onboarding-form";
import { requireSession } from "@/lib/auth/session";
import type { OnboardingProfile } from "@/lib/onboarding";
import {
  isSchemaCacheMissingError,
  ONBOARDING_PROFILE_SELECT_COLUMNS,
  readOnboardingProfileFromMetadata,
} from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
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
  const activeProfile = (
    data ??
    (error && isSchemaCacheMissingError(error) ? metadataProfile : null)
  ) as OnboardingProfile | null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <OnboardingForm initialProfile={activeProfile} mode="profile" />
    </div>
  );
}
