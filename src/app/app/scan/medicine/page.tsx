import { MedicationScanner } from "@/components/patient/medication-scanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPatientScanContext } from "@/lib/patient/scan-context";

export default async function MedicationScanPage() {
  const { session } = await getPatientScanContext();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>สแกนยา</CardTitle>
          <CardDescription>
            สแกนฉลากยาแบบใช้งานจริง พร้อมเสียงแนะนำทิศทางและวิเคราะห์ OCR อัตโนมัติ
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MedicationScanner patientId={session.userId} />
        </CardContent>
      </Card>
    </div>
  );
}
