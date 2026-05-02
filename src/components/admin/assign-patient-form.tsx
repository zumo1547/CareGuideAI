"use client";

import { Link2, Loader2, Unlink2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface PersonOption {
  id: string;
  fullName: string;
}

interface ExistingLink {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  createdAt: string | null;
}

interface AssignPatientFormProps {
  patients: PersonOption[];
  doctors: PersonOption[];
  existingLinks: ExistingLink[];
}

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
};

export const AssignPatientForm = ({
  patients,
  doctors,
  existingLinks,
}: AssignPatientFormProps) => {
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [unassigningLinkId, setUnassigningLinkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [links, setLinks] = useState(existingLinks);

  const patientMap = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient.fullName])),
    [patients],
  );
  const doctorMap = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor.fullName])),
    [doctors],
  );

  const submit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/assign-patient-doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId,
        doctorId,
      }),
    });
    const payload = (await response.json()) as { error?: string; linkId?: string };
    setLoading(false);

    if (!response.ok || !payload.linkId) {
      setError(payload.error ?? "จับคู่ไม่สำเร็จ");
      return;
    }

    const patientName = patientMap.get(patientId) ?? patientId;
    const doctorName = doctorMap.get(doctorId) ?? doctorId;
    const newLink: ExistingLink = {
      id: payload.linkId,
      patientId,
      patientName,
      doctorId,
      doctorName,
      createdAt: new Date().toISOString(),
    };

    setLinks((current) => {
      const withoutSameId = current.filter((item) => item.id !== newLink.id);
      return [newLink, ...withoutSameId];
    });

    setMessage("จับคู่คนไข้-หมอสำเร็จ");
    setPatientId("");
    setDoctorId("");
  };

  const unassign = async (link: ExistingLink) => {
    setUnassigningLinkId(link.id);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/assign-patient-doctor", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkId: link.id,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    setUnassigningLinkId(null);

    if (!response.ok) {
      setError(payload.error ?? "ยกเลิกคู่ไม่สำเร็จ");
      return;
    }

    setLinks((current) => current.filter((item) => item.id !== link.id));
    setMessage(`ยกเลิกคู่สำเร็จ: ${link.patientName} ↔ ${link.doctorName}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-cyan-700" />
          จับคู่และยกเลิกคู่คนไข้-หมอ
        </CardTitle>
        <CardDescription>
          แอดมินกำหนดคู่ดูแลผู้ป่วยได้ และสามารถยกเลิกคู่เมื่อมีการย้ายการดูแล
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {message ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <div className="space-y-2">
            <Label htmlFor="assign-patient-id">Patient ID</Label>
            <Input
              id="assign-patient-id"
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="วาง UUID หรือเลือกจากรายการด้านล่าง"
            />
          </div>
          <div className="space-y-2">
            <Label>เลือกคนไข้</Label>
            <Select value={patientId || undefined} onValueChange={(value) => setPatientId(value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="เลือกคนไข้เพื่อเติม Patient ID" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((patient) => (
                  <SelectItem key={patient.id} value={patient.id}>
                    {patient.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assign-doctor-id">Doctor ID</Label>
            <Input
              id="assign-doctor-id"
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              placeholder="วาง UUID หรือเลือกจากรายการด้านล่าง"
            />
          </div>
          <div className="space-y-2">
            <Label>เลือกหมอ</Label>
            <Select value={doctorId || undefined} onValueChange={(value) => setDoctorId(value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="เลือกหมอเพื่อเติม Doctor ID" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} disabled={loading || !patientId || !doctorId}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{loading ? "กำลังบันทึก..." : "จับคู่คนไข้-หมอ"}</span>
          </Button>
        </section>

        <section className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">คู่ที่กำลังใช้งาน ({links.length})</h3>
            <Badge variant="outline">Admin Managed</Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>คนไข้</TableHead>
                <TableHead>หมอ</TableHead>
                <TableHead>จับคู่เมื่อ</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีคู่คนไข้-หมอ
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell className="font-medium">{link.patientName}</TableCell>
                    <TableCell>{link.doctorName}</TableCell>
                    <TableCell>{formatDateTime(link.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void unassign(link)}
                        disabled={unassigningLinkId === link.id}
                      >
                        {unassigningLinkId === link.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Unlink2 className="h-4 w-4" />
                        )}
                        ยกเลิกคู่
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </CardContent>
    </Card>
  );
};
