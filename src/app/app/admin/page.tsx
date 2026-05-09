import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  ClipboardList,
  Shield,
  Stethoscope,
  UserCog,
  Users,
} from "lucide-react";

import { AssignPatientForm } from "@/components/admin/assign-patient-form";
import { AssignRoleForm } from "@/components/admin/assign-role-form";
import { DeleteUserButton } from "@/components/admin/delete-user-button";
import { InviteDoctorForm } from "@/components/admin/invite-doctor-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeInTimeZone } from "@/lib/time";
import type { Role } from "@/types/domain";

const fmt = (value: string | null) => formatDateTimeInTimeZone(value, env.APP_TIMEZONE);
const num = (value: number | null) => value ?? 0;

const roleBadgeVariant = (role: Role) => {
  if (role === "admin") return "destructive";
  if (role === "doctor") return "default";
  return "secondary";
};

const inviteBadgeVariant = (status: string) => {
  if (status === "accepted") return "default";
  if (status === "revoked") return "destructive";
  return "secondary";
};

export default async function AdminDashboardPage() {
  const session = await requireRole(["admin"]);
  const supabase = await createSupabaseServerClient();

  const [
    totalUsersResult,
    patientCountResult,
    doctorCountResult,
    adminCountResult,
    pendingInviteCountResult,
    activePlanCountResult,
    pendingReminderCountResult,
    failedReminderCountResult,
    pendingAppointmentCountResult,
    missedDoseCountResult,
    onboardingCountResult,
    usersResult,
    patientsResult,
    doctorsResult,
    invitesResult,
    linksResult,
    logsResult,
    failedRemindersResult,
    pendingAppointmentsResult,
    missedLogsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "doctor"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    supabase
      .from("doctor_invites")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("medication_plans")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("reminder_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("reminder_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("adherence_logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "missed"),
    supabase.from("user_onboarding_profiles").select("user_id", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .eq("role", "patient")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("profiles")
      .select("id, full_name, phone, created_at")
      .eq("role", "doctor")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("doctor_invites")
      .select("id, email, token, status, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("patient_doctor_links")
      .select("id, patient_id, doctor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(240),
    supabase
      .from("admin_audit_logs")
      .select("id, action, target_type, target_id, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("reminder_events")
      .select("id, patient_id, due_at, provider, status, created_at")
      .eq("status", "failed")
      .order("due_at", { ascending: false })
      .limit(20),
    supabase
      .from("appointments")
      .select("id, patient_id, doctor_id, request_note, scheduled_at, created_at, status")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("adherence_logs")
      .select("id, patient_id, scheduled_for, status")
      .eq("status", "missed")
      .order("scheduled_for", { ascending: false })
      .limit(20),
  ]);

  const users = usersResult.data ?? [];
  const patients = patientsResult.data ?? [];
  const doctors = doctorsResult.data ?? [];
  const invites = invitesResult.data ?? [];
  const links = linksResult.data ?? [];
  const logs = logsResult.data ?? [];
  const failedReminders = failedRemindersResult.data ?? [];
  const pendingAppointments = pendingAppointmentsResult.data ?? [];
  const missedLogs = missedLogsResult.data ?? [];

  const userNameMap = new Map(users.map((user) => [user.id, user.full_name]));
  patients.forEach((patient) => userNameMap.set(patient.id, patient.full_name));
  doctors.forEach((doctor) => userNameMap.set(doctor.id, doctor.full_name));

  const patientLinkCount = new Map<string, number>();
  const doctorLinkCount = new Map<string, number>();
  links.forEach((link) => {
    patientLinkCount.set(link.patient_id, (patientLinkCount.get(link.patient_id) ?? 0) + 1);
    doctorLinkCount.set(link.doctor_id, (doctorLinkCount.get(link.doctor_id) ?? 0) + 1);
  });

  const unassignedPatients = patients
    .filter((patient) => !patientLinkCount.has(patient.id))
    .slice(0, 15);
  const doctorsWithoutPatients = doctors
    .filter((doctor) => !doctorLinkCount.has(doctor.id))
    .slice(0, 15);
  const expiringInvites = invites.filter((invite) => invite.status === "pending").slice(0, 10);

  const warnings: string[] = [];
  if (onboardingCountResult.error) {
    if (isSchemaCacheMissingError(onboardingCountResult.error)) {
      warnings.push("เธ•เธฒเธฃเธฒเธ onboarding เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเนเธ API schema cache เธเธ“เธฐเธเธตเนเธฃเธฐเธเธ fallback เธขเธฑเธเนเธเนเธเธฒเธเนเธ”เน เนเธ•เนเธเธงเธฃเน€เธเนเธ migration เนเธ Supabase");
    } else {
      warnings.push(`เธ”เธถเธเธเนเธญเธกเธนเธฅ onboarding เนเธกเนเธชเธณเน€เธฃเนเธ: ${onboardingCountResult.error.message}`);
    }
  }

  const onboardingCount = onboardingCountResult.error ? null : num(onboardingCountResult.count);
  const totalUsers = num(totalUsersResult.count);
  const patientCount = num(patientCountResult.count);
  const doctorCount = num(doctorCountResult.count);
  const adminCount = num(adminCountResult.count);

  const userOptions = users.map((user) => ({
    id: user.id,
    fullName: user.full_name,
    role: user.role as Role,
  }));
  const patientOptions = patients.map((patient) => ({
    id: patient.id,
    fullName: patient.full_name,
  }));
  const doctorOptions = doctors.map((doctor) => ({
    id: doctor.id,
    fullName: doctor.full_name,
  }));
  const existingLinks = links.map((link) => ({
    id: link.id,
    patientId: link.patient_id,
    patientName: userNameMap.get(link.patient_id) ?? link.patient_id,
    doctorId: link.doctor_id,
    doctorName: userNameMap.get(link.doctor_id) ?? link.doctor_id,
    createdAt: link.created_at,
  }));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-2xl font-semibold">เธจเธนเธเธขเนเธ”เธนเนเธฅเธฃเธฐเธเธเนเธญเธ”เธกเธดเธ</h2>
        <p className="text-muted-foreground">
          เธซเธเนเธฒเธเธตเนเธชเธฃเธธเธเธ เธฒเธเธฃเธงเธกเธเธนเนเนเธเน เธฃเธฐเธเธเธขเธฒ เธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธ เนเธฅเธฐเธฃเธฒเธขเธเธฒเธฃเธ—เธตเนเธ•เนเธญเธเธเธฑเธ”เธเธฒเธฃ เน€เธเธทเนเธญเนเธซเนเธ”เธนเนเธฅเน€เธงเนเธเนเธ”เนเน€เธฃเนเธงเนเธฅเธฐเธ—เธฑเนเธงเธ–เธถเธ
        </p>
      </section>

      {warnings.length ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>เธกเธตเธเธฒเธเธญเธขเนเธฒเธเธ•เนเธญเธเธ•เธฃเธงเธเธชเธญเธ</AlertTitle>
          <AlertDescription>
            {warnings.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>เธเธนเนเนเธเนเธ—เธฑเนเธเธซเธกเธ”</CardDescription>
            <CardTitle className="text-3xl">{totalUsers}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            patient {patientCount} | doctor {doctorCount} | admin {adminCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Onboarding เน€เธชเธฃเนเธเนเธฅเนเธง</CardDescription>
            <CardTitle className="text-3xl">{onboardingCount ?? "-"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {onboardingCount === null
              ? "เธฃเธญ schema cache เธเธฃเนเธญเธก"
              : `${Math.round((onboardingCount / Math.max(totalUsers, 1)) * 100)}% เธเธญเธเธเธนเนเนเธเนเธ—เธฑเนเธเธซเธกเธ”`}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>เนเธเธเธขเธฒเธ—เธตเน active</CardDescription>
            <CardTitle className="text-3xl">{num(activePlanCountResult.count)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            เธขเธฒเธ—เธตเนเธเธณเธฅเธฑเธเธ•เธดเธ”เธ•เธฒเธกเนเธเธฃเธฐเธเธ
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>เธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเธฃเธญเธชเนเธ</CardDescription>
            <CardTitle className="text-3xl">{num(pendingReminderCountResult.count)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            failed {num(failedReminderCountResult.count)} เธฃเธฒเธขเธเธฒเธฃ
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>เธเธฑเธ”เธซเธกเธฒเธขเธฃเธญเธขเธทเธเธขเธฑเธ</CardDescription>
            <CardTitle className="text-3xl">{num(pendingAppointmentCountResult.count)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            invite pending {num(pendingInviteCountResult.count)} | missed dose เธ—เธฑเนเธเธซเธกเธ” {num(missedDoseCountResult.count)}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <InviteDoctorForm />
        <AssignRoleForm users={userOptions} />
        <AssignPatientForm
          patients={patientOptions}
          doctors={doctorOptions}
          existingLinks={existingLinks}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-700" />
              เธเธนเนเนเธเนเธฅเนเธฒเธชเธธเธ”เนเธฅเธฐเธชเธดเธ—เธเธดเน
            </CardTitle>
            <CardDescription>เธ•เธฃเธงเธเธเธ—เธเธฒเธ—เธเธนเนเนเธเน เธเธฃเนเธญเธกเน€เธงเธฅเธฒเน€เธเนเธฒเธฃเธฐเธเธ</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เธเธทเนเธญ</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>เธชเธฃเนเธฒเธเน€เธกเธทเนเธญ</TableHead>
                  <TableHead className="text-right">จัดการ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      เธขเธฑเธเนเธกเนเธกเธตเธเนเธญเธกเธนเธฅเธเธนเนเนเธเน
                    </TableCell>
                  </TableRow>
                ) : (
                  users.slice(0, 18).map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="max-w-[260px] truncate font-medium">{user.full_name}</TableCell>
                      <TableCell>
                        <Badge variant={roleBadgeVariant(user.role as Role)} className="capitalize">
                          {user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmt(user.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <DeleteUserButton
                          userId={user.id}
                          fullName={user.full_name}
                          role={user.role}
                          isCurrentAdmin={user.id === session.userId}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-cyan-700" />
              เธชเธ–เธฒเธเธฐเธเธฒเธฃเธเธฑเธเธเธนเนเธเธนเนเธเนเธงเธข-เธซเธกเธญ
            </CardTitle>
            <CardDescription>เธเนเธงเธขเธ•เธดเธ”เธ•เธฒเธกเธเธงเธฒเธกเธเธฃเธญเธเธเธฅเธธเธกเธเธฒเธฃเธ”เธนเนเธฅเธเธนเนเธเนเธงเธข</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">เธเธนเนเธ—เธตเนเธเธฑเธเนเธฅเนเธง</p>
                <p className="text-2xl font-semibold">{links.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">เธเธนเนเธเนเธงเธขเธขเธฑเธเนเธกเนเธเธฑเธเธเธนเน</p>
                <p className="text-2xl font-semibold">{unassignedPatients.length}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">เธซเธกเธญเธขเธฑเธเนเธกเนเธกเธตเธเธนเนเธเนเธงเธข</p>
                <p className="text-2xl font-semibold">{doctorsWithoutPatients.length}</p>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เธเธนเนเธเนเธงเธขเธขเธฑเธเนเธกเนเธเธฑเธเธเธนเน</TableHead>
                  <TableHead>เนเธ—เธฃเธจเธฑเธเธ—เน</TableHead>
                  <TableHead>เธชเธฃเนเธฒเธเน€เธกเธทเนเธญ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedPatients.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      เธเธนเนเธเนเธงเธขเธ–เธนเธเธเธฑเธเธเธนเนเธเธฃเธเนเธฅเนเธง
                    </TableCell>
                  </TableRow>
                ) : (
                  unassignedPatients.map((patient) => (
                    <TableRow key={patient.id}>
                      <TableCell className="max-w-[220px] truncate">{patient.full_name}</TableCell>
                      <TableCell>{patient.phone ?? "-"}</TableCell>
                      <TableCell>{fmt(patient.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-cyan-700" />
              เนเธเนเธเน€เธ•เธทเธญเธเธ—เธตเนเธ•เนเธญเธเน€เธเนเธฒเธฃเธฐเธงเธฑเธ
            </CardTitle>
            <CardDescription>เธ•เธฃเธงเธ failed reminder เนเธฅเธฐ missed dose เธฅเนเธฒเธชเธธเธ”</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Failed Reminder เธฅเนเธฒเธชเธธเธ”</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เธเธนเนเนเธเน</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Provider</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failedReminders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        เนเธกเนเธกเธต failed reminder
                      </TableCell>
                    </TableRow>
                  ) : (
                    failedReminders.slice(0, 10).map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{userNameMap.get(event.patient_id) ?? event.patient_id}</TableCell>
                        <TableCell>{fmt(event.due_at)}</TableCell>
                        <TableCell>{event.provider}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Missed Dose เธฅเนเธฒเธชเธธเธ”</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เธเธนเนเนเธเน</TableHead>
                    <TableHead>เน€เธงเธฅเธฒ</TableHead>
                    <TableHead>เธชเธ–เธฒเธเธฐ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missedLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        เนเธกเนเธกเธต missed dose เธฅเนเธฒเธชเธธเธ”
                      </TableCell>
                    </TableRow>
                  ) : (
                    missedLogs.slice(0, 10).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{userNameMap.get(log.patient_id) ?? log.patient_id}</TableCell>
                        <TableCell>{fmt(log.scheduled_for)}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{log.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-cyan-700" />
              เธเธฑเธ”เธซเธกเธฒเธขเนเธฅเธฐเธเธณเน€เธเธดเธเธซเธกเธญ
            </CardTitle>
            <CardDescription>เธ•เธดเธ”เธ•เธฒเธกเธเธญเธเธงเธ”เธ”เนเธฒเธเธเธฒเธฃเธเธฃเธฐเธชเธฒเธเธเธฒเธ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Pending Appointments</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เธเธนเนเธเนเธงเธข</TableHead>
                    <TableHead>เธซเธกเธญ</TableHead>
                    <TableHead>เธเธญเน€เธกเธทเนเธญ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingAppointments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        เนเธกเนเธกเธตเธเธฑเธ”เธซเธกเธฒเธขเธ—เธตเนเธฃเธญเธขเธทเธเธขเธฑเธ
                      </TableCell>
                    </TableRow>
                  ) : (
                    pendingAppointments.slice(0, 10).map((appointment) => (
                      <TableRow key={appointment.id}>
                        <TableCell>{userNameMap.get(appointment.patient_id) ?? appointment.patient_id}</TableCell>
                        <TableCell>{userNameMap.get(appointment.doctor_id) ?? appointment.doctor_id}</TableCell>
                        <TableCell>{fmt(appointment.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Invite เธ—เธตเนเธขเธฑเธ pending</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>เธซเธกเธ”เธญเธฒเธขเธธ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringInvites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        เนเธกเนเธกเธต invite เธ—เธตเนเธเนเธฒเธเธญเธขเธนเน
                      </TableCell>
                    </TableRow>
                  ) : (
                    expiringInvites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>
                          <Badge variant={inviteBadgeVariant(invite.status)}>{invite.status}</Badge>
                        </TableCell>
                        <TableCell>{fmt(invite.expires_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-cyan-700" />
              Doctor Invite เธ—เธฑเนเธเธซเธกเธ”
            </CardTitle>
            <CardDescription>เธ•เธดเธ”เธ•เธฒเธกเธชเธ–เธฒเธเธฐเธเนเธฒเธ/เธขเธญเธกเธฃเธฑเธ/เธขเธเน€เธฅเธดเธ</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      เธขเธฑเธเนเธกเนเธกเธต invite
                    </TableCell>
                  </TableRow>
                ) : (
                  invites.slice(0, 12).map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant={inviteBadgeVariant(invite.status)}>{invite.status}</Badge>
                      </TableCell>
                      <TableCell>{fmt(invite.expires_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-cyan-700" />
              Admin Audit Logs
            </CardTitle>
            <CardDescription>เน€เธเนเธเธเธฒเธฃเน€เธเธฅเธตเนเธขเธเนเธเธฅเธเธชเธณเธเธฑเธเธเธญเธเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      เนเธกเนเธกเธต audit logs
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.slice(0, 14).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-[180px] truncate">{log.action}</TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {log.target_type}:{log.target_id}
                      </TableCell>
                      <TableCell>{fmt(log.created_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {doctorsWithoutPatients.length ? (
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-cyan-700" />
                เธซเธกเธญเธ—เธตเนเธขเธฑเธเนเธกเนเธกเธตเธเธนเนเธเนเธงเธขเนเธเธเธงเธฒเธกเธ”เธนเนเธฅ
              </CardTitle>
              <CardDescription>เนเธเนเธชเธณเธซเธฃเธฑเธเธเธฃเธฐเธเธฒเธขเธ เธฒเธฃเธฐเธเธฒเธเนเธซเนเธชเธกเธ”เธธเธฅ</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เธเธทเนเธญเธซเธกเธญ</TableHead>
                    <TableHead>เนเธ—เธฃเธจเธฑเธเธ—เน</TableHead>
                    <TableHead>เธชเธฃเนเธฒเธเน€เธกเธทเนเธญ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doctorsWithoutPatients.map((doctor) => (
                    <TableRow key={doctor.id}>
                      <TableCell className="max-w-[260px] truncate">{doctor.full_name}</TableCell>
                      <TableCell>{doctor.phone ?? "-"}</TableCell>
                      <TableCell>{fmt(doctor.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}



