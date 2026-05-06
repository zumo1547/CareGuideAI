"use client";

import Link from "next/link";
import { Loader2, Plus, RefreshCcw, Trash2, UserRoundPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

interface CaregiverLinkRow {
  id: string;
  patientId: string;
  notes: string | null;
  createdAt: string;
  patient: {
    fullName: string | null;
    phone: string | null;
  } | null;
  onboarding: {
    disabilityType: string | null;
    disabilitySeverity: string | null;
  } | null;
}

interface CaregiverLinkManagerProps {
  links: CaregiverLinkRow[];
  selectedPatientId: string | null;
}

const severityLabel: Record<string, string> = {
  none: "ปกติ",
  mild: "เล็กน้อย",
  moderate: "ปานกลาง",
  severe: "รุนแรง",
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

export const CaregiverLinkManager = ({
  links,
  selectedPatientId,
}: CaregiverLinkManagerProps) => {
  const router = useRouter();
  const [patientId, setPatientId] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const addLink = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/caregiver/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patientId.trim() || undefined,
          patientPhone: patientPhone.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        link?: {
          patientId?: string;
        };
      };
      if (!response.ok) {
        setError(payload.error ?? "เพิ่มผู้ป่วยไม่สำเร็จ");
        return;
      }
      setSuccess("รับผู้ป่วยเข้าสู่ความดูแลสำเร็จ");
      setPatientId("");
      setPatientPhone("");
      setNotes("");
      if (payload.link?.patientId) {
        router.push(`/app/caregiver?patientId=${payload.link.patientId}`);
      }
      router.refresh();
    } catch {
      setError("เพิ่มผู้ป่วยไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const removeLink = async (linkId: string) => {
    setRemovingId(linkId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/caregiver/links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "ยกเลิกการดูแลไม่สำเร็จ");
        return;
      }
      setSuccess("ยกเลิกการดูแลผู้ป่วยสำเร็จ");
      router.refresh();
    } catch {
      setError("ยกเลิกการดูแลไม่สำเร็จ");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundPlus className="h-5 w-5 text-cyan-700" />
          จัดการผู้ป่วยที่ดูแล
        </CardTitle>
        <CardDescription>
          เพิ่มผู้ป่วยเข้าสู่ความดูแล และสลับผู้ป่วยเพื่อจัดการแทนได้ในหน้าเดียว
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>สำเร็จ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="caregiver-patient-id">Patient ID (ถ้ามี)</Label>
              <Input
                id="caregiver-patient-id"
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
                placeholder="วาง UUID ของผู้ป่วย"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caregiver-patient-phone">
                เบอร์โทรผู้ป่วย (ถ้าไม่ทราบ Patient ID)
              </Label>
              <Input
                id="caregiver-patient-phone"
                value={patientPhone}
                onChange={(event) => setPatientPhone(event.target.value)}
                placeholder="เช่น 0812345678"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caregiver-notes">หมายเหตุการดูแล (ถ้ามี)</Label>
            <Textarea
              id="caregiver-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="เช่น ลูกหลานดูแลร่วมกันช่วงเย็น"
            />
          </div>
          <Button
            type="button"
            onClick={() => void addLink()}
            disabled={loading || (!patientId.trim() && !patientPhone.trim())}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            รับผู้ป่วยเข้าสู่ความดูแล
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">ผู้ป่วยที่กำลังดูแล ({links.length})</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              <RefreshCcw className="h-4 w-4" />
              รีเฟรช
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ผู้ป่วย</TableHead>
                <TableHead>ระดับความรุนแรง</TableHead>
                <TableHead>เริ่มดูแลเมื่อ</TableHead>
                <TableHead className="text-right">การทำงาน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีผู้ป่วยในความดูแล
                  </TableCell>
                </TableRow>
              ) : (
                links.map((link) => (
                  <TableRow key={link.id}>
                    <TableCell>
                      <p className="font-medium">{link.patient?.fullName ?? link.patientId}</p>
                      <p className="text-xs text-muted-foreground">{link.patient?.phone ?? "-"}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {severityLabel[link.onboarding?.disabilitySeverity ?? ""] ?? "ไม่ระบุ"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(link.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link
                          href={`/app/caregiver?patientId=${link.patientId}`}
                          className={buttonVariants({
                            size: "sm",
                            variant: selectedPatientId === link.patientId ? "default" : "outline",
                          })}
                        >
                          {selectedPatientId === link.patientId ? "กำลังดูแล" : "เลือกดู"}
                        </Link>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void removeLink(link.id)}
                          disabled={removingId === link.id}
                        >
                          {removingId === link.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                          ยกเลิก
                        </Button>
                      </div>
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
