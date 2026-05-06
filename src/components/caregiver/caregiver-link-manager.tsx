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
  none: "เธเธเธ•เธด",
  mild: "เน€เธฅเนเธเธเนเธญเธข",
  moderate: "เธเธฒเธเธเธฅเธฒเธ",
  severe: "เธฃเธธเธเนเธฃเธ",
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "เน€เธเธดเนเธกเธเธนเนเธเนเธงเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
        return;
      }
      setSuccess("เธฃเธฑเธเธเธนเนเธเนเธงเธขเน€เธเนเธฒเธ”เธนเนเธฅเธชเธณเน€เธฃเนเธ");
      setPatientId("");
      setPatientPhone("");
      setNotes("");
      router.refresh();
    } catch {
      setError("เน€เธเธดเนเธกเธเธนเนเธเนเธงเธขเนเธกเนเธชเธณเน€เธฃเนเธ");
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
        setError(payload.error ?? "เธขเธเน€เธฅเธดเธเธเธฒเธฃเธ”เธนเนเธฅเนเธกเนเธชเธณเน€เธฃเนเธ");
        return;
      }
      setSuccess("เธขเธเน€เธฅเธดเธเธเธฒเธฃเธ”เธนเนเธฅเธเธนเนเธเนเธงเธขเธชเธณเน€เธฃเนเธ");
      router.refresh();
    } catch {
      setError("เธขเธเน€เธฅเธดเธเธเธฒเธฃเธ”เธนเนเธฅเนเธกเนเธชเธณเน€เธฃเนเธ");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundPlus className="h-5 w-5 text-cyan-700" />
          เธเธฑเธ”เธเธฒเธฃเธเธนเนเธเนเธงเธขเธ—เธตเนเธ”เธนเนเธฅ
        </CardTitle>
        <CardDescription>
          เธฃเธฑเธเธเธนเนเธเนเธงเธขเน€เธเนเธฒเธ”เธนเนเธฅเนเธฅเธฐเธชเธฅเธฑเธเธเธนเนเธเนเธงเธขเน€เธเธทเนเธญเธ—เธณเธเธฒเธเนเธ—เธเนเธเธฃเธฐเธเธเน€เธ”เธตเธขเธง
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertTitle>เธชเธณเน€เธฃเนเธ</AlertTitle>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-3 rounded-xl border p-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="caregiver-patient-id">Patient ID (เธ–เนเธฒเธกเธต)</Label>
              <Input
                id="caregiver-patient-id"
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
                placeholder="เธงเธฒเธ UUID เธเธนเนเธเนเธงเธข"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caregiver-patient-phone">เน€เธเธญเธฃเนเนเธ—เธฃเธเธนเนเธเนเธงเธข (เธ–เนเธฒเนเธกเนเธ—เธฃเธฒเธ ID)</Label>
              <Input
                id="caregiver-patient-phone"
                value={patientPhone}
                onChange={(event) => setPatientPhone(event.target.value)}
                placeholder="เน€เธเนเธ 0812345678"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caregiver-notes">เธซเธกเธฒเธขเน€เธซเธ•เธธเธเธฒเธฃเธ”เธนเนเธฅ (optional)</Label>
            <Textarea
              id="caregiver-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="เน€เธเนเธ เธฅเธนเธเธซเธฅเธฒเธเธ”เธนเนเธฅเธฃเนเธงเธกเธเธฑเธเธเนเธงเธเน€เธขเนเธ"
            />
          </div>
          <Button
            type="button"
            onClick={() => void addLink()}
            disabled={loading || (!patientId.trim() && !patientPhone.trim())}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            เธฃเธฑเธเธเธนเนเธเนเธงเธขเน€เธเนเธฒเธ”เธนเนเธฅ
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">เธเธนเนเธเนเธงเธขเธ—เธตเนเธเธณเธฅเธฑเธเธ”เธนเนเธฅ ({links.length})</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
              <RefreshCcw className="h-4 w-4" />
              เธฃเธตเน€เธเธฃเธ
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เธเธนเนเธเนเธงเธข</TableHead>
                <TableHead>เธฃเธฐเธ”เธฑเธเธเธงเธฒเธกเธฃเธธเธเนเธฃเธ</TableHead>
                <TableHead>เน€เธฃเธดเนเธกเธ”เธนเนเธฅเน€เธกเธทเนเธญ</TableHead>
                <TableHead className="text-right">เธเธฒเธฃเธ—เธณเธเธฒเธ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    เธขเธฑเธเนเธกเนเธกเธตเธเธนเนเธเนเธงเธขเนเธเธเธงเธฒเธกเธ”เธนเนเธฅ
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
                        {severityLabel[link.onboarding?.disabilitySeverity ?? ""] ?? "เนเธกเนเธฃเธฐเธเธธ"}
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
                          เธขเธเน€เธฅเธดเธ
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


