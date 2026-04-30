import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/session";

export default async function ScanHubPage() {
  await requireRole(["patient", "admin"]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>ศูนย์สแกน</CardTitle>
          <CardDescription>
            เลือกโหมดการสแกนที่ต้องการใช้งาน
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link
            href="/app/scan/medicine"
            className="rounded-full border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            ไปหน้าสแกนยา
          </Link>
          <Link
            href="/app/scan/blood-pressure"
            className="rounded-full border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            ไปหน้าสแกนความดัน
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
