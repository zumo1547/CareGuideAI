import { format } from "date-fns";
import { Shield, UserCog } from "lucide-react";

import { AssignPatientForm } from "@/components/admin/assign-patient-form";
import { AssignRoleForm } from "@/components/admin/assign-role-form";
import { InviteDoctorForm } from "@/components/admin/invite-doctor-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const fmt = (value: string | null) => (value ? format(new Date(value), "dd/MM/yyyy HH:mm") : "-");

export default async function AdminDashboardPage() {
  await requireRole(["admin"]);
  const supabase = await createSupabaseServerClient();

  const [{ data: users }, { data: invites }, { data: links }, { data: logs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("doctor_invites")
      .select("id, email, token, status, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("patient_doctor_links")
      .select("id, patient_id, doctor_id, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("admin_audit_logs")
      .select("id, action, target_type, target_id, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Users ทั้งหมด</CardDescription>
            <CardTitle className="text-2xl">{users?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>คำเชิญหมอค้างอยู่</CardDescription>
            <CardTitle className="text-2xl">
              {invites?.filter((item) => item.status === "pending").length ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>คู่ patient-doctor</CardDescription>
            <CardTitle className="text-2xl">{links?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>admin audit logs</CardDescription>
            <CardTitle className="text-2xl">{logs?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <InviteDoctorForm />
        <AssignRoleForm />
        <AssignPatientForm />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5 text-cyan-700" />
              รายชื่อผู้ใช้ล่าสุด
            </CardTitle>
            <CardDescription>ตรวจสอบ role เพื่อจัดการสิทธิ์</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ชื่อ</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>สร้างเมื่อ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      ยังไม่มีข้อมูลผู้ใช้
                    </TableCell>
                  </TableRow>
                ) : (
                  users?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{user.full_name}</p>
                          <p className="text-xs text-muted-foreground">{user.id}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className="capitalize">{user.role}</Badge>
                      </TableCell>
                      <TableCell>{fmt(user.created_at)}</TableCell>
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
              <Shield className="h-5 w-5 text-cyan-700" />
              Invite และ Audit
            </CardTitle>
            <CardDescription>ติดตามคำเชิญหมอและกิจกรรมของแอดมิน</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Doctor Invites</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expiry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invites ?? []).slice(0, 8).map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.email}</TableCell>
                      <TableCell>{invite.status}</TableCell>
                      <TableCell>{fmt(invite.expires_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Audit Logs</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(logs ?? []).slice(0, 8).map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{log.action}</TableCell>
                      <TableCell className="max-w-[160px] truncate">
                        {log.target_type}:{log.target_id}
                      </TableCell>
                      <TableCell>{fmt(log.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
