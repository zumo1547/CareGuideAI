import { BloodPressureScanner } from "@/components/patient/blood-pressure-scanner";
import { getPatientScanContext } from "@/lib/patient/scan-context";

export default async function BloodPressureScanPage() {
  const { session, biologicalSex, bmi } = await getPatientScanContext();

  return (
    <div className="space-y-6" id="voice-section-blood-pressure">
      <BloodPressureScanner
        patientId={session.userId}
        biologicalSex={biologicalSex}
        bmi={bmi}
      />
    </div>
  );
}
