import { BloodPressureScanner } from "@/components/patient/blood-pressure-scanner";
import { MedicationScanner } from "@/components/patient/medication-scanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";
import { readOnboardingProfileFromMetadata } from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ScanPage() {
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ศูนย์สแกนยา</CardTitle>
          <CardDescription>
            สแกนฉลากยาแบบใช้งานจริง พร้อมเสียงแนะนำทิศทางและวิเคราะห์ OCR อัตโนมัติ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MedicationScanner patientId={session.userId} />
        </CardContent>
      </Card>

      <BloodPressureScanner patientId={session.userId} biologicalSex={biologicalSex} bmi={bmi} />
    </div>
  );
}
