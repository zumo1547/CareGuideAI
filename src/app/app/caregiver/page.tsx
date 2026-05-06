import { format } from "date-fns";
import { Activity, BellRing, CalendarClock, HeartPulse, Pill, ShieldAlert } from "lucide-react";

import { CaregiverLinkManager } from "@/components/caregiver/caregiver-link-manager";
import { CaregiverRoutineBoard } from "@/components/caregiver/caregiver-routine-board";
import { BloodPressureScanner } from "@/components/patient/blood-pressure-scanner";
import { MedicationPlanForm } from "@/components/patient/medication-plan-form";
import { MedicationScanner } from "@/components/patient/medication-scanner";
import { PatientSupportDesk } from "@/components/patient/patient-support-desk";
import { ReminderEventsTable } from "@/components/patient/reminder-events-table";
import { AppointmentForm } from "@/components/shared/appointment-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { withCaregiverSchemaRecovery } from "@/lib/caregiver-schema-retry";
import { env } from "@/lib/env";
import type { BiologicalSex } from "@/lib/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface CaregiverPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface CaregiverLinkRow {
  id: string;
  caregiver_id: string;
  patient_id: string;
  notes: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

interface OnboardingRow {
  user_id: string;
  disability_type: string | null;
  disability_severity: string | null;
  biological_sex: BiologicalSex | null;
  bmi: number | null;
}

interface PlanRow {
  id: string;
  medicine_id: string;
  dosage: string;
  is_active: boolean;
}

interface MedicineRow {
  id: string;
  name: string;
  strength: string | null;
}

interface ScheduleRow {
  plan_id: string;
  label: string;
  time_of_day: string;
}

interface ReminderRow {
  id: string;
  due_at: string;
  channel: string;
  status: string;
  provider: string | null;
}

interface BloodPressureRow {
  measured_at: string;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  category_label_th: string | null;
}

interface AppointmentRow {
  status: string;
  patient_response: string | null;
  scheduled_at: string | null;
}

interface RoutineRow {
  id: string;
  routine_date: string;
  time_slot: "morning" | "noon" | "evening" | "night" | "custom";
  time_text: string | null;
  task_text: string;
  is_done: boolean;
  done_at: string | null;
}

interface DoctorRow {
  id: string;
  full_name: string | null;
  phone: string | null;
}

const toSingle = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const severityLabelMap: Record<string, string> = {
  none: "ปกติ",
  mild: "เล็กน้อย",
  moderate: "ปานกลาง",
  severe: "รุนแรง",
};

const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "-";

export default async function CaregiverDashboardPage({ searchParams }: CaregiverPageProps) {
  const session = await requireRole(["caregiver"]);
  const supabase = await createSupabaseServerClient();
  const caregiverLinkReader = env.SUPABASE_SERVICE_ROLE_KEY
    ? createSupabaseAdminClient()
    : supabase;
  const resolvedSearchParams = await searchParams;
  const requestedPatientId = toSingle(resolvedSearchParams.patientId);
  const todayDate = format(new Date(), "yyyy-MM-dd");

  const { data: rawLinks, error: caregiverLinksError } = await withCaregiverSchemaRecovery(() =>
    caregiverLinkReader
      .from("caregiver_patient_links")
      .select("id, caregiver_id, patient_id, notes, created_at")
      .eq("caregiver_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(300),
  );

  const linkRows = (caregiverLinksError ? [] : (rawLinks ?? [])) as CaregiverLinkRow[];
  const linkedPatientIds = [
    ...new Set(
      linkRows
        .map((row) => row.patient_id)
        .filter((id) => typeof id === "string" && id.length > 0),
    ),
  ];

  const safeSelectedPatientId =
    requestedPatientId && linkedPatientIds.includes(requestedPatientId)
      ? requestedPatientId
      : linkedPatientIds[0] ?? null;

  const [{ data: patientProfiles }, { data: onboardingRows }] = await Promise.all([
    linkedPatientIds.length
      ? supabase.from("profiles").select("id, full_name, phone").in("id", linkedPatientIds)
      : Promise.resolve({ data: [] as ProfileRow[] }),
    linkedPatientIds.length
      ? supabase
          .from("user_onboarding_profiles")
          .select("user_id, disability_type, disability_severity, biological_sex, bmi")
          .in("user_id", linkedPatientIds)
      : Promise.resolve({ data: [] as OnboardingRow[] }),
  ]);

  const profileMap = new Map((patientProfiles ?? []).map((row) => [row.id, row]));
  const onboardingMap = new Map((onboardingRows ?? []).map((row) => [row.user_id, row]));

  const linksForManager = linkRows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    notes: row.notes,
    createdAt: row.created_at,
    patient: profileMap.has(row.patient_id)
      ? {
          fullName: profileMap.get(row.patient_id)?.full_name ?? null,
          phone: profileMap.get(row.patient_id)?.phone ?? null,
        }
      : null,
    onboarding: onboardingMap.has(row.patient_id)
      ? {
          disabilityType: onboardingMap.get(row.patient_id)?.disability_type ?? null,
          disabilitySeverity: onboardingMap.get(row.patient_id)?.disability_severity ?? null,
        }
      : null,
  }));

  const selectedPatientProfile = safeSelectedPatientId
    ? profileMap.get(safeSelectedPatientId) ?? null
    : null;
  const selectedOnboarding = safeSelectedPatientId
    ? onboardingMap.get(safeSelectedPatientId) ?? null
    : null;

  let plans: PlanRow[] = [];
  let medicines: MedicineRow[] = [];
  let schedules: ScheduleRow[] = [];
  let reminders: ReminderRow[] = [];
  let latestBp: BloodPressureRow | null = null;
  let latestAppointment: AppointmentRow | null = null;
  let routines: RoutineRow[] = [];
  let doctorOptions: Array<{
    id: string;
    fullName: string;
    phone: string | null;
    isLinked: boolean;
  }> = [];

  if (safeSelectedPatientId) {
    const [{ data: rawPlans }, { data: rawReminders }, { data: rawAppointments }, { data: rawRoutines }] =
      await Promise.all([
        supabase
          .from("medication_plans")
          .select("id, medicine_id, dosage, is_active")
          .eq("patient_id", safeSelectedPatientId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("reminder_events")
          .select("id, due_at, channel, status, provider")
          .eq("patient_id", safeSelectedPatientId)
          .order("due_at", { ascending: false })
          .limit(20),
        supabase
          .from("appointments")
          .select("status, patient_response, scheduled_at, updated_at")
          .eq("patient_id", safeSelectedPatientId)
          .order("updated_at", { ascending: false })
          .limit(1),
        supabase
          .from("caregiver_daily_routines")
          .select("id, routine_date, time_slot, time_text, task_text, is_done, done_at")
          .eq("caregiver_id", session.userId)
          .eq("patient_id", safeSelectedPatientId)
          .eq("routine_date", todayDate)
          .order("created_at", { ascending: true }),
      ]);

    plans = (rawPlans ?? []) as PlanRow[];
    reminders = (rawReminders ?? []) as ReminderRow[];
    latestAppointment = ((rawAppointments ?? [])[0] ?? null) as AppointmentRow | null;
    routines = (rawRoutines ?? []) as RoutineRow[];

    const medicineIds = [
      ...new Set(
        plans
          .map((plan) => plan.medicine_id)
          .filter((id) => typeof id === "string" && id.length > 0),
      ),
    ];
    const planIds = plans.map((plan) => plan.id);

    const [{ data: rawMedicines }, { data: rawSchedules }] = await Promise.all([
      medicineIds.length
        ? supabase.from("medicines").select("id, name, strength").in("id", medicineIds)
        : Promise.resolve({ data: [] as MedicineRow[] }),
      planIds.length
        ? supabase
            .from("medication_schedule_times")
            .select("plan_id, label, time_of_day")
            .in("plan_id", planIds)
        : Promise.resolve({ data: [] as ScheduleRow[] }),
    ]);

    medicines = (rawMedicines ?? []) as MedicineRow[];
    schedules = (rawSchedules ?? []) as ScheduleRow[];

    const { data: bpRows } = await supabase
      .from("blood_pressure_readings")
      .select("measured_at, systolic, diastolic, pulse, category_label_th")
      .eq("patient_id", safeSelectedPatientId)
      .order("measured_at", { ascending: false })
      .limit(1);
    latestBp = ((bpRows ?? [])[0] ?? null) as BloodPressureRow | null;

    try {
      const adminSupabase = createSupabaseAdminClient();
      const [{ data: doctors }, { data: links }] = await Promise.all([
        adminSupabase
          .from("profiles")
          .select("id, full_name, phone")
          .eq("role", "doctor")
          .order("full_name", { ascending: true }),
        adminSupabase
          .from("patient_doctor_links")
          .select("doctor_id")
          .eq("patient_id", safeSelectedPatientId)
          .limit(200),
      ]);

      const linkedDoctorIds = new Set((links ?? []).map((row) => row.doctor_id));
      doctorOptions = ((doctors ?? []) as DoctorRow[]).map((doctor) => ({
        id: doctor.id,
        fullName: doctor.full_name ?? doctor.id,
        phone: doctor.phone,
        isLinked: linkedDoctorIds.has(doctor.id),
      }));
    } catch {
      doctorOptions = [];
    }
  }

  const medicineMap = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const pendingReminderCount = reminders.filter((item) => item.status === "pending").length;
  const reminderSyncKey = reminders
    .map((item) => `${item.id}:${item.status}:${item.due_at}`)
    .join("|");
  const completedRoutinesCount = routines.filter((item) => item.is_done).length;
  const remainingRoutinesCount = Math.max(0, routines.length - completedRoutinesCount);
  const severeCaseCount = linksForManager.filter(
    (link) => link.onboarding?.disabilitySeverity === "severe",
  ).length;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ผู้ป่วยที่กำลังดูแล</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShieldAlert className="h-5 w-5 text-cyan-700" />
              {linksForManager.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>แผนยาที่ใช้งานอยู่วันนี้</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Pill className="h-5 w-5 text-cyan-700" />
              {plans.filter((plan) => plan.is_active).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>แจ้งเตือนที่ยังไม่ทำ</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <BellRing className="h-5 w-5 text-amber-600" />
              {pendingReminderCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>กิจวัตรที่ยังเหลือวันนี้</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Activity className="h-5 w-5 text-indigo-600" />
              {remainingRoutinesCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>เคสที่ควรระวัง (รุนแรง)</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <HeartPulse className="h-5 w-5 text-rose-600" />
              {severeCaseCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <CaregiverLinkManager links={linksForManager} selectedPatientId={safeSelectedPatientId} />

      {!safeSelectedPatientId ? (
        <Card>
          <CardHeader>
            <CardTitle>ยังไม่ได้เลือกผู้ป่วย</CardTitle>
            <CardDescription>
              กรุณาเพิ่มหรือเลือกผู้ป่วยจากกล่องด้านบนก่อน ระบบจะแสดงเครื่องมือดูแลทั้งหมดเมื่อเลือกผู้ป่วยแล้ว
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card className="border-cyan-200/80 bg-gradient-to-br from-cyan-50 to-sky-50">
            <CardHeader>
              <CardTitle>ภาพรวมผู้ป่วยที่กำลังดูแล</CardTitle>
              <CardDescription>
                ผู้ป่วย: {selectedPatientProfile?.full_name ?? safeSelectedPatientId} | โทร:{" "}
                {selectedPatientProfile?.phone ?? "-"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
              <p>
                ระดับความรุนแรง:{" "}
                <span className="font-semibold">
                  {severityLabelMap[selectedOnboarding?.disability_severity ?? ""] ?? "ไม่ระบุ"}
                </span>
              </p>
              <p>
                ประเภทความพิการ:{" "}
                <span className="font-semibold">
                  {selectedOnboarding?.disability_type ?? "ไม่ระบุ"}
                </span>
              </p>
              <p>
                ความดันล่าสุด:{" "}
                <span className="font-semibold">
                  {latestBp ? `${latestBp.systolic}/${latestBp.diastolic}` : "ยังไม่มีข้อมูล"}
                </span>
              </p>
              <p>
                สถานะนัดล่าสุด:{" "}
                <span className="font-semibold">
                  {latestAppointment?.status ?? "ยังไม่มีนัดหมาย"}
                </span>
              </p>
              <p className="md:col-span-2 xl:col-span-4">
                รายละเอียดความดันล่าสุด:{" "}
                <span className="font-semibold">
                  {latestBp
                    ? `${latestBp.category_label_th ?? "-"} (วัดเมื่อ ${formatDateTime(latestBp.measured_at)})`
                    : "-"}
                </span>
              </p>
            </CardContent>
          </Card>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <MedicationScanner key={`med-scan-${safeSelectedPatientId}`} patientId={safeSelectedPatientId} />
            <MedicationPlanForm key={`med-plan-${safeSelectedPatientId}`} patientId={safeSelectedPatientId} />
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <BloodPressureScanner
              key={`bp-scan-${safeSelectedPatientId}`}
              patientId={safeSelectedPatientId}
              biologicalSex={selectedOnboarding?.biological_sex ?? null}
              bmi={selectedOnboarding?.bmi ?? null}
            />
            <CaregiverRoutineBoard
              key={`routine-${safeSelectedPatientId}`}
              patientId={safeSelectedPatientId}
              initialRoutines={routines.map((item) => ({
                id: item.id,
                routineDate: item.routine_date,
                timeSlot: item.time_slot,
                timeText: item.time_text,
                taskText: item.task_text,
                isDone: item.is_done,
                doneAt: item.done_at,
              }))}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <PatientSupportDesk
              key={`support-${safeSelectedPatientId}`}
              patientId={safeSelectedPatientId}
              actorUserId={session.userId}
              actorRole="caregiver"
              doctorOptions={doctorOptions}
              hasLinkedDoctor={doctorOptions.some((doctor) => doctor.isLinked)}
            />
            <AppointmentForm
              key={`appointment-${safeSelectedPatientId}`}
              patientId={safeSelectedPatientId}
              actorRole="caregiver"
              doctorOptions={doctorOptions}
              hasLinkedDoctor={doctorOptions.some((doctor) => doctor.isLinked)}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>ตารางยาและเวลาแจ้งเตือนของผู้ป่วย</CardTitle>
                <CardDescription>
                  ผู้ดูแลสามารถตรวจสอบแผนยา และจัดการการแจ้งเตือนแทนผู้ป่วยได้
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
                    {plans.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ยังไม่มีแผนยา
                        </TableCell>
                      </TableRow>
                    ) : (
                      plans.map((plan) => {
                        const medicine = medicineMap.get(plan.medicine_id);
                        const planTimes = schedules
                          .filter((item) => item.plan_id === plan.id)
                          .map((item) => `${item.label} ${item.time_of_day.slice(0, 5)}`)
                          .join(", ");
                        return (
                          <TableRow key={plan.id}>
                            <TableCell className="font-medium">
                              {medicine?.name ?? "ไม่พบชื่อยา"}
                              {medicine?.strength ? ` ${medicine.strength}` : ""}
                            </TableCell>
                            <TableCell>{plan.dosage}</TableCell>
                            <TableCell>{planTimes || "-"}</TableCell>
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

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-cyan-700" />
                  รายการแจ้งเตือนของผู้ป่วย
                </CardTitle>
                <CardDescription>
                  หากผู้ป่วยยังไม่สะดวก ผู้ดูแลสามารถยกเลิกการแจ้งเตือนแทนได้ทันที
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ReminderEventsTable
                  key={`reminder-${safeSelectedPatientId}-${reminderSyncKey}`}
                  patientId={safeSelectedPatientId}
                  initialEvents={reminders.map((event) => ({
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
        </>
      )}
    </div>
  );
}
