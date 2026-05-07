"use client";

import { CheckCircle2, Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DEFAULT_APP_TIMEZONE,
  formatDateTimeInTimeZone,
  todayInTimeZone,
} from "@/lib/time";

interface RoutineItem {
  id: string;
  routineDate: string;
  timeSlot: "morning" | "noon" | "evening" | "night" | "custom";
  timeText: string | null;
  taskText: string;
  isDone: boolean;
  doneAt: string | null;
}

interface CaregiverRoutineBoardProps {
  patientId: string;
  initialRoutines: RoutineItem[];
}

const timeSlotOptions: Array<{ value: RoutineItem["timeSlot"]; label: string }> = [
  { value: "morning", label: "เช้า" },
  { value: "noon", label: "กลางวัน" },
  { value: "evening", label: "เย็น" },
  { value: "night", label: "ก่อนนอน" },
  { value: "custom", label: "กำหนดเอง" },
];

const timeSlotOrder: Record<RoutineItem["timeSlot"], number> = {
  morning: 1,
  noon: 2,
  evening: 3,
  night: 4,
  custom: 5,
};

const formatDateTime = (value: string | null) =>
  formatDateTimeInTimeZone(value, DEFAULT_APP_TIMEZONE, "dd/MM/yy HH:mm");

export const CaregiverRoutineBoard = ({
  patientId,
  initialRoutines,
}: CaregiverRoutineBoardProps) => {
  const today = useMemo(() => todayInTimeZone(DEFAULT_APP_TIMEZONE), []);
  const [routines, setRoutines] = useState(initialRoutines);
  const [routineDate] = useState(today);
  const [timeSlot, setTimeSlot] = useState<RoutineItem["timeSlot"]>("morning");
  const [timeText, setTimeText] = useState("");
  const [taskText, setTaskText] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [busyRoutineId, setBusyRoutineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sortedRoutines = useMemo(
    () =>
      [...routines].sort((a, b) => {
        const slotDiff = timeSlotOrder[a.timeSlot] - timeSlotOrder[b.timeSlot];
        if (slotDiff !== 0) return slotDiff;
        return (a.timeText ?? "").localeCompare(b.timeText ?? "", "th");
      }),
    [routines],
  );

  const summaryLines = useMemo(() => {
    const entries = sortedRoutines.map((routine) => {
      const slotLabel =
        timeSlotOptions.find((item) => item.value === routine.timeSlot)?.label ?? "กำหนดเอง";
      const timeLabel = routine.timeText ? ` (${routine.timeText})` : "";
      const doneLabel = routine.isDone ? "เสร็จแล้ว" : "ยังไม่ทำ";
      return `${slotLabel}${timeLabel}: ${routine.taskText} - ${doneLabel}`;
    });
    return entries;
  }, [sortedRoutines]);

  const refreshRoutines = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/caregiver/routines?patientId=${patientId}&date=${routineDate}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        error?: string;
        routines?: RoutineItem[];
      };
      if (!response.ok) {
        setError(payload.error ?? "โหลดกิจวัตรไม่สำเร็จ");
        return;
      }
      setRoutines(payload.routines ?? []);
    } catch {
      setError("โหลดกิจวัตรไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  };

  const createRoutine = async () => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/caregiver/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          routineDate,
          timeSlot,
          timeText: timeText.trim() || undefined,
          taskText: taskText.trim(),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "เพิ่มกิจวัตรไม่สำเร็จ");
        return;
      }
      setTaskText("");
      setTimeText("");
      setSuccess("เพิ่มกิจวัตรประจำวันแล้ว");
      await refreshRoutines();
    } catch {
      setError("เพิ่มกิจวัตรไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDone = async (routine: RoutineItem) => {
    setBusyRoutineId(routine.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/caregiver/routines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routineId: routine.id,
          isDone: !routine.isDone,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "อัปเดตกิจวัตรไม่สำเร็จ");
        return;
      }
      setSuccess(!routine.isDone ? "ทำรายการนี้เสร็จแล้ว" : "ยกเลิกสถานะเสร็จแล้ว");
      await refreshRoutines();
    } catch {
      setError("อัปเดตกิจวัตรไม่สำเร็จ");
    } finally {
      setBusyRoutineId(null);
    }
  };

  const removeRoutine = async (routineId: string) => {
    setBusyRoutineId(routineId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/caregiver/routines", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routineId,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "ลบกิจวัตรไม่สำเร็จ");
        return;
      }
      setSuccess("ลบกิจวัตรแล้ว");
      await refreshRoutines();
    } catch {
      setError("ลบกิจวัตรไม่สำเร็จ");
    } finally {
      setBusyRoutineId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>โหมดกิจวัตรแบบง่ายสำหรับผู้พิการ</CardTitle>
        <CardDescription>
          สร้างรายการวันนี้ให้อ่านง่ายหรือฟังง่าย เช่น ตอนเช้า: ล้างหน้า กินยา 1 เม็ด
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
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="routine-time-slot">ช่วงเวลา</Label>
              <select
                id="routine-time-slot"
                value={timeSlot}
                onChange={(event) => setTimeSlot(event.target.value as RoutineItem["timeSlot"])}
                className="flex h-10 w-full rounded-md border bg-transparent px-3 text-sm"
              >
                {timeSlotOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="routine-time-text">เวลา (ถ้ามี)</Label>
              <Input
                id="routine-time-text"
                value={timeText}
                onChange={(event) => setTimeText(event.target.value)}
                placeholder="เช่น 10:30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="routine-date">วันที่</Label>
              <Input id="routine-date" type="date" value={routineDate} readOnly />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="routine-task-text">รายการวันนี้</Label>
            <Input
              id="routine-task-text"
              value={taskText}
              onChange={(event) => setTaskText(event.target.value)}
              placeholder="เช่น ตอนเย็น: หยอดตา"
            />
          </div>
          <Button
            type="button"
            onClick={() => void createRoutine()}
            disabled={isSubmitting || taskText.trim().length < 2}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            เพิ่มกิจวัตร
          </Button>
        </section>

        <section className="space-y-3 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">รายการวันนี้แบบอ่านง่าย</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshRoutines()}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              รีเฟรช
            </Button>
          </div>
          {summaryLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีรายการกิจวัตรของวันนี้</p>
          ) : (
            <ul className="space-y-2">
              {summaryLines.map((line) => (
                <li key={line} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 rounded-xl border p-3">
          <h3 className="text-sm font-semibold">ตารางกิจวัตร (จัดการรายการ)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>เวลา</TableHead>
                <TableHead>กิจกรรม</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead className="text-right">การทำงาน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRoutines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีรายการ
                  </TableCell>
                </TableRow>
              ) : (
                sortedRoutines.map((routine) => (
                  <TableRow key={routine.id}>
                    <TableCell>
                      {timeSlotOptions.find((item) => item.value === routine.timeSlot)?.label ??
                        "กำหนดเอง"}
                      {routine.timeText ? ` (${routine.timeText})` : ""}
                    </TableCell>
                    <TableCell>{routine.taskText}</TableCell>
                    <TableCell>
                      <Badge variant={routine.isDone ? "default" : "secondary"}>
                        {routine.isDone ? `เสร็จแล้ว ${formatDateTime(routine.doneAt)}` : "ยังไม่ทำ"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void toggleDone(routine)}
                          disabled={busyRoutineId === routine.id}
                        >
                          {busyRoutineId === routine.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {routine.isDone ? "ทำใหม่" : "ทำเสร็จ"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void removeRoutine(routine.id)}
                          disabled={busyRoutineId === routine.id}
                        >
                          <Trash2 className="h-4 w-4" />
                          ลบ
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
