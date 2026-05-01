import { format } from "date-fns";
import { ClipboardList, MessageSquareText, TrendingUp } from "lucide-react";

import { AdherenceChart } from "@/components/doctor/adherence-chart";
import { DoctorSupportDesk } from "@/components/doctor/doctor-support-desk";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const fmt = (value: string | null) => (value ? format(new Date(value), "dd/MM/yyyy HH:mm") : "-");

export default async function DoctorDashboardPage() {
  const session = await requireRole(["doctor", "admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: links } = await supabase
    .from("patient_doctor_links")
    .select("patient_id")
    .eq("doctor_id", session.userId);

  const patientIds = [...new Set((links ?? []).map((item) => item.patient_id))];

  const [{ data: patients }, { data: adherenceLogs }, { data: messages }, { data: appointments }] =
    await Promise.all([
      patientIds.length
        ? supabase.from("profiles").select("id, full_name, phone").in("id", patientIds)
        : Promise.resolve({
            data: [] as { id: string; full_name: string; phone: string | null }[],
          }),
      patientIds.length
        ? supabase
            .from("adherence_logs")
            .select("id, patient_id, status, scheduled_for, taken_at")
            .in("patient_id", patientIds)
            .order("scheduled_for", { ascending: false })
            .limit(120)
        : Promise.resolve({
            data: [] as {
              id: string;
              patient_id: string;
              status: string;
              scheduled_for: string;
              taken_at: string | null;
            }[],
          }),
      supabase
        .from("doctor_messages")
        .select("id, patient_id, subject, message, created_at, sender_id")
        .eq("doctor_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("appointments")
        .select("id, patient_id, status, request_note, scheduled_at, created_at")
        .eq("doctor_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

  const patientMap = new Map((patients ?? []).map((patient) => [patient.id, patient]));

  const chartDataMap = new Map<string, { taken: number; missed: number }>();
  (adherenceLogs ?? []).forEach((log) => {
    const day = format(new Date(log.scheduled_for), "dd/MM");
    const entry = chartDataMap.get(day) ?? { taken: 0, missed: 0 };
    if (log.status === "taken") entry.taken += 1;
    if (log.status === "missed") entry.missed += 1;
    chartDataMap.set(day, entry);
  });

  const chartData = [...chartDataMap.entries()]
    .map(([day, counts]) => ({ day, ...counts }))
    .slice(-14);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>จำนวนผู้ป่วยที่รับผิดชอบ</CardDescription>
            <CardTitle className="text-2xl">{patientIds.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ข้อความล่าสุด</CardDescription>
            <CardTitle className="text-2xl">{messages?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>คำขอนัดหมายล่าสุด</CardDescription>
            <CardTitle className="text-2xl">{appointments?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-cyan-700" />
              แนวโน้มการทานยา (14 วันล่าสุด)
            </CardTitle>
            <CardDescription>ใช้ดูจำนวน taken/missed ของผู้ป่วยรวม</CardDescription>
          </CardHeader>
          <CardContent>
            <AdherenceChart data={chartData} />
          </CardContent>
        </Card>
        <DoctorSupportDesk doctorId={session.userId} />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-cyan-700" />
              กล่องข้อความ
            </CardTitle>
            <CardDescription>ข้อความที่เกี่ยวข้องกับผู้ป่วยในความดูแล</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ผู้ป่วย</TableHead>
                  <TableHead>หัวข้อ</TableHead>
                  <TableHead>เวลา</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(messages ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      ไม่มีข้อความ
                    </TableCell>
                  </TableRow>
                ) : (
                  messages?.map((message) => (
                    <TableRow key={message.id}>
                      <TableCell>{patientMap.get(message.patient_id)?.full_name ?? message.patient_id}</TableCell>
                      <TableCell className="max-w-[180px] truncate">
                        {message.subject || message.message}
                      </TableCell>
                      <TableCell>{fmt(message.created_at)}</TableCell>
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
              คำขอนัดหมาย
            </CardTitle>
            <CardDescription>สถานะ pending/confirmed/completed</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ผู้ป่วย</TableHead>
                  <TableHead>เวลา</TableHead>
                  <TableHead>สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(appointments ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      ไม่มีคำขอนัดหมาย
                    </TableCell>
                  </TableRow>
                ) : (
                  appointments?.map((appointment) => (
                    <TableRow key={appointment.id}>
                      <TableCell>
                        {patientMap.get(appointment.patient_id)?.full_name ?? appointment.patient_id}
                      </TableCell>
                      <TableCell>{fmt(appointment.scheduled_at ?? appointment.created_at)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={appointment.status === "pending" ? "secondary" : "default"}
                          className="capitalize"
                        >
                          {appointment.status}
                        </Badge>
                      </TableCell>
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
