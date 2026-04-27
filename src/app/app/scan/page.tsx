import { MedicationScanner } from "@/components/patient/medication-scanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";

export default async function ScanPage() {
  const session = await requireRole(["patient", "admin"]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ศูนย์สแกนยา</CardTitle>
          <CardDescription>
            โหมดสแกนเฉพาะทาง พร้อมเสียงแนะนำทิศทางเพื่อช่วยให้สแกนสำเร็จง่ายขึ้น
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MedicationScanner patientId={session.userId} />
        </CardContent>
      </Card>
    </div>
  );
}
