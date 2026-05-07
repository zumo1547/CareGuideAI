import { Activity, BellRing, Pill, UserRoundCheck } from "lucide-react";

import { VoiceModeStartButton } from "@/components/accessibility/voice-mode-start-button";
import { MedicationPlanForm } from "@/components/patient/medication-plan-form";
import { MedicationScanner } from "@/components/patient/medication-scanner";
import { PatientSupportDesk } from "@/components/patient/patient-support-desk";
import { ReminderEventsTable } from "@/components/patient/reminder-events-table";
import { VoiceReminderListener } from "@/components/patient/voice-reminder-listener";
import { AppointmentForm } from "@/components/shared/appointment-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { getBmiTrend } from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PatientDashboardPage() {
  const session = await requireRole(["patient", "admin"]);
  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();

  const { data: plans } = await supabase
    .from("medication_plans")
    .select("id, medicine_id, dosage, notes, is_active, start_date, end_date")
    .eq("patient_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(10);

  const medicineIds = (plans ?? []).map((plan) => plan.medicine_id).filter(Boolean);

  const [
    { data: medicines },
    { data: schedules },
    { data: reminderEvents },
    { data: links },
    { data: doctorProfiles },
    { data: onboardingProfile },
  ] = await Promise.all([
    medicineIds.length
      ? supabase.from("medicines").select("id, name, strength").in("id", medicineIds)
      : Promise.resolve({ data: [] as { id: string; name: string; strength: string | null }[] }),
    plans?.length
      ? supabase
          .from("medication_schedule_times")
          .select("plan_id, label, time_of_day")
          .in("plan_id", plans.map((plan) => plan.id))
      : Promise.resolve({ data: [] as { plan_id: string; label: string; time_of_day: string }[] }),
    supabase
      .from("reminder_events")
      .select("id, due_at, channel, status, provider")
      .eq("patient_id", session.userId)
      .order("due_at", { ascending: false })
      .limit(20),
    supabase
      .from("patient_doctor_links")
      .select("doctor_id")
      .eq("patient_id", session.userId)
      .limit(200),
    adminSupabase
      .from("profiles")
      .select("id, full_name, phone")
      .eq("role", "doctor")
      .order("full_name", { ascending: true }),
    supabase
      .from("user_onboarding_profiles")
      .select("biological_sex, bmi")
      .eq("user_id", session.userId)
      .maybeSingle(),
  ]);

  const medicineMap = new Map((medicines ?? []).map((item) => [item.id, item]));
  const linkedDoctorIds = new Set((links ?? []).map((link) => link.doctor_id).filter(Boolean));
  const doctorOptions = (doctorProfiles ?? []).map((doctor) => ({
    id: doctor.id,
    fullName: doctor.full_name,
    phone: doctor.phone,
    isLinked: linkedDoctorIds.has(doctor.id),
  }));
  const bmiValue = Number(onboardingProfile?.bmi ?? 0);
  const bmiTrend =
    onboardingProfile?.biological_sex && Number.isFinite(bmiValue) && bmiValue > 0
      ? getBmiTrend(bmiValue, onboardingProfile.biological_sex)
      : null;
  const reminderSyncKey = (reminderEvents ?? [])
    .map((event) => `${event.id}:${event.status}:${event.due_at}`)
    .join("|");

  return (
    <div className="space-y-6">
      <VoiceReminderListener patientId={session.userId} />

      <section
        className="rounded-2xl border-2 border-cyan-300/80 bg-gradient-to-br from-cyan-100/90 to-sky-100/90 p-4 shadow-sm"
        aria-label="เริ่มใช้งานด้วยเสียงด่วน"
      >
        <p className="text-base font-bold text-cyan-950">เริ่มใช้งานด้วยเสียงทันที</p>
        <p className="mt-1 text-sm leading-relaxed text-cyan-900">
          หากมองไม่เห็นเมนู ให้กดปุ่มด้านล่างนี้ก่อน แล้วพูดสั่งงานได้เลย เช่น “สแกนยา”, “นัดหมอ”, “แชทหมอ”
        </p>
        <VoiceModeStartButton
          label="กดที่นี่เพื่อเริ่มโหมดใช้งานด้วยเสียง"
          className="mt-3 h-12 w-full rounded-2xl text-base font-semibold"
        />
        <div className="mt-3 space-y-1 text-xs leading-6 text-cyan-900/90 md:text-sm">
          <p>1. กดปุ่ม “กดที่นี่เพื่อเริ่มโหมดใช้งานด้วยเสียง”</p>
          <p>2. หากระบบถามสิทธิ์ไมโครโฟน ให้กด “อนุญาต”</p>
          <p>3. เริ่มพูดคำสั่งได้ทันที เช่น “สแกนยา” หรือ “ส่งข้อความหาหมอ”</p>
        </div>
      </section>

      <section className="rounded-2xl border bg-cyan-50/40 p-4" aria-label="คำสั่งเสียงที่รองรับ">
        <p className="text-sm font-semibold">โหมดใช้งานด้วยเสียง</p>
        <p className="mt-1 text-sm text-muted-foreground">
          พูดสั่งได้ เช่น “สแกนยา”, “นัดหมอ”, “แชทหมอ”, “ส่งข้อความหาหมอ”
          และระบบจะทวนยืนยันก่อนทำรายการสำคัญทุกครั้ง
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>แผนยาที่ใช้งานอยู่</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Pill className="h-5 w-5 text-cyan-700" />
              {plans?.filter((plan) => plan.is_active).length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>รายการแจ้งเตือนที่รอส่ง</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <BellRing className="h-5 w-5 text-amber-600" />
              {reminderEvents?.filter((item) => item.status === "pending").length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>คุณหมอที่ดูแล</CardDescription>
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

      {bmiTrend ? (
        <section>
          <Card className="border-cyan-200/80 bg-gradient-to-br from-cyan-50 to-sky-50">
            <CardHeader>
              <CardTitle>แนวโน้ม BMI และผลต่อความดันในอนาคต</CardTitle>
              <CardDescription>
                วิเคราะห์จากค่า BMI ล่าสุดและเพศ ({bmiTrend.sexLabel}) เพื่อใช้เป็นฐานข้อมูลสำหรับฟีเจอร์ดูแลความดัน
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <p>
                BMI ล่าสุด: <span className="font-semibold">{bmiTrend.bmi.toFixed(2)}</span>
              </p>
              <p>
                ช่วงค่า: <span className="font-semibold">{bmiTrend.rangeLabel}</span>
              </p>
              <p>
                ภาวะ: <span className="font-semibold">{bmiTrend.statusLabel}</span>
              </p>
              <p>
                ความเสี่ยงโรค: <span className="font-semibold">{bmiTrend.diseaseRiskLabel}</span>
              </p>
              <p className="md:col-span-2">
                แนวโน้มความดัน: <span className="font-semibold">{bmiTrend.bloodPressureTrendLabel}</span>
              </p>
              <p className="md:col-span-2">
                คำแนะนำ: <span className="font-semibold">{bmiTrend.recommendationLabel}</span>
              </p>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section id="voice-section-medicine" className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <MedicationScanner patientId={session.userId} />
        <MedicationPlanForm patientId={session.userId} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div id="voice-section-chat">
          <PatientSupportDesk
            patientId={session.userId}
            doctorOptions={doctorOptions}
            hasLinkedDoctor={linkedDoctorIds.size > 0}
          />
        </div>
        <div id="voice-section-appointment">
          <AppointmentForm
            patientId={session.userId}
            doctorOptions={doctorOptions}
            hasLinkedDoctor={linkedDoctorIds.size > 0}
          />
        </div>
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
            <CardDescription>ข้อมูลการแจ้งเตือนยา (SMS/Voice)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 rounded-xl border border-cyan-200/70 bg-gradient-to-br from-cyan-50 to-sky-50 p-4">
              <p className="text-sm font-semibold text-cyan-950">การจัดการรายการแจ้งเตือนอัตโนมัติ</p>
              <div className="mt-2 space-y-2 text-sm leading-6 text-cyan-900/90">
                <p className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
                  <span>รายการที่ยกเลิก (cancelled) จะถูกลบอัตโนมัติภายใน 30 นาที</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
                  <span>รายการแจ้งเตือนที่ส่งแล้วจะถูกลบอัตโนมัติทุกสัปดาห์</span>
                </p>
              </div>
            </div>
            <ReminderEventsTable
              key={`patient-reminder-${session.userId}-${reminderSyncKey}`}
              patientId={session.userId}
              initialEvents={(reminderEvents ?? []).map((event) => ({
                id: event.id,
                dueAt: event.due_at,
                channel: event.channel,
                status: event.status,
                provider: event.provider,
                cancelledAt: null,
              }))}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
