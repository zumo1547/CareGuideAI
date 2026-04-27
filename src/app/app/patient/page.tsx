import { format } from "date-fns";
import { Activity, BellRing, Pill, UserRoundCheck } from "lucide-react";

import { MedicationPlanForm } from "@/components/patient/medication-plan-form";
import { MedicationScanner } from "@/components/patient/medication-scanner";
import { VoiceReminderListener } from "@/components/patient/voice-reminder-listener";
import { AppointmentForm } from "@/components/shared/appointment-form";
import { DoctorMessageForm } from "@/components/shared/doctor-message-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const formatDateTime = (dateValue: string | null) =>
  dateValue ? format(new Date(dateValue), "dd/MM/yyyy HH:mm") : "-";

export default async function PatientDashboardPage() {
  const session = await requireRole(["patient", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: plans } = await supabase
    .from("medication_plans")
    .select("id, medicine_id, dosage, notes, is_active, start_date, end_date")
    .eq("patient_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(10);

  const medicineIds = (plans ?? []).map((plan) => plan.medicine_id).filter(Boolean);

  const [{ data: medicines }, { data: schedules }, { data: reminderEvents }, { data: links }] =
    await Promise.all([
      medicineIds.length
        ? supabase
            .from("medicines")
            .select("id, name, strength")
            .in("id", medicineIds)
        : Promise.resolve({ data: [] as { id: string; name: string; strength: string | null }[] }),
      plans?.length
        ? supabase
            .from("medication_schedule_times")
            .select("plan_id, label, time_of_day")
            .in("plan_id", plans.map((plan) => plan.id))
        : Promise.resolve({ data: [] as { plan_id: string; label: string; time_of_day: string }[] }),
      supabase
        .from("reminder_events")
        .select("id, due_at, channel, status")
        .eq("patient_id", session.userId)
        .order("due_at", { ascending: true })
        .limit(15),
      supabase
        .from("patient_doctor_links")
        .select("doctor_id")
        .eq("patient_id", session.userId)
        .limit(1),
    ]);

  const medicineMap = new Map((medicines ?? []).map((item) => [item.id, item]));
  const firstDoctorId = links?.[0]?.doctor_id ?? "";

  return (
    <div className="space-y-6">
      <VoiceReminderListener />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>แผนยา Active</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Pill className="h-5 w-5 text-cyan-700" />
              {plans?.filter((plan) => plan.is_active).length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>แจ้งเตือนที่กำลังรอ</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <BellRing className="h-5 w-5 text-amber-600" />
              {reminderEvents?.filter((item) => item.status === "pending").length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>หมอดูแล</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <UserRoundCheck className="h-5 w-5 text-emerald-700" />
              {links?.length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>สถานะระบบ</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-violet-700" />
              พร้อมใช้งาน
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <MedicationScanner patientId={session.userId} />
        <MedicationPlanForm patientId={session.userId} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <DoctorMessageForm defaultDoctorId={firstDoctorId} />
        <AppointmentForm defaultDoctorId={firstDoctorId} />
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>ตารางยาและการแจ้งเตือนล่าสุด</CardTitle>
            <CardDescription>
              ตารางด้านล่างแสดงยาแต่ละรายการพร้อมช่วงเวลาแจ้งเตือน
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อยา</TableHead>
                  <TableHead>ขนาดยา</TableHead>
                  <TableHead>เวลา</TableHead>
                  <TableHead>สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(plans ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      ยังไม่มีแผนยา
                    </TableCell>
                  </TableRow>
                ) : (
                  plans?.map((plan) => {
                    const medicine = medicineMap.get(plan.medicine_id);
                    const times = (schedules ?? [])
                      .filter((item) => item.plan_id === plan.id)
                      .map((item) => `${item.label} ${item.time_of_day.slice(0, 5)}`)
                      .join(", ");

                    return (
                      <TableRow key={plan.id}>
                        <TableCell className="font-medium">{medicine?.name ?? "ไม่พบชื่อยา"}</TableCell>
                        <TableCell>{plan.dosage}</TableCell>
                        <TableCell>{times || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={plan.is_active ? "default" : "secondary"}>
                            {plan.is_active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Reminder Events</CardTitle>
            <CardDescription>ข้อมูลจากระบบแจ้งเตือน (SMS/Voice)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Due Time</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(reminderEvents ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      ยังไม่มี reminder event
                    </TableCell>
                  </TableRow>
                ) : (
                  reminderEvents?.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{formatDateTime(event.due_at)}</TableCell>
                      <TableCell>{event.channel}</TableCell>
                      <TableCell>{event.status}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
