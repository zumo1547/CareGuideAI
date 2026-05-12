"use client";

import { Loader2, RefreshCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_APP_TIMEZONE, formatDateTimeInTimeZone } from "@/lib/time";

type ReminderEventRow = {
  id: string;
  dueAt: string;
  channel: string;
  status: string;
  provider?: string | null;
  cancelledAt: string | null;
};

interface ReminderEventsTableProps {
  initialEvents: ReminderEventRow[];
  patientId?: string;
}

const COLLAPSED_ROWS = 8;

const formatDateTime = (dateValue: string | null) =>
  formatDateTimeInTimeZone(dateValue, DEFAULT_APP_TIMEZONE, "dd/MM/yy HH:mm");

const statusLabelMap: Record<string, string> = {
  pending: "รอดำเนินการ",
  sent: "ส่งแล้ว",
  failed: "ส่งไม่สำเร็จ",
  cancelled: "ยกเลิกแล้ว",
};

const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "pending") return "secondary";
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  return "outline";
};

const toDisplayStatus = (event: ReminderEventRow) => {
  if (event.status === "failed" && event.provider === "user-cancelled") {
    return "cancelled";
  }
  return event.status;
};

const asCancelledEvent = (event: ReminderEventRow, cancelledAt: string): ReminderEventRow => ({
  ...event,
  status: "cancelled",
  provider: "user-cancelled",
  cancelledAt,
});

export const ReminderEventsTable = ({ initialEvents, patientId }: ReminderEventsTableProps) => {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [isCancellingAllPending, setCancellingAllPending] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isExpanded, setExpanded] = useState(false);

  const hasMoreThanCollapsedRows = events.length > COLLAPSED_ROWS;
  const visibleEvents = isExpanded ? events : events.slice(0, COLLAPSED_ROWS);
  const pendingCount = useMemo(
    () => events.filter((event) => toDisplayStatus(event) === "pending").length,
    [events],
  );

  const refreshEvents = useCallback(
    async (silent = false) => {
      if (!patientId) return;

      if (!silent) {
        setRefreshing(true);
        setError(null);
      }

      try {
        const response = await fetch(
          `/api/reminders/list?patientId=${encodeURIComponent(patientId)}&limit=50`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as {
          error?: string;
          events?: ReminderEventRow[];
        };

        if (!response.ok) {
          if (!silent) {
            setError(payload.error ?? "โหลดรายการแจ้งเตือนไม่สำเร็จ");
          }
          return;
        }

        setEvents(payload.events ?? []);
      } catch {
        if (!silent) {
          setError("โหลดรายการแจ้งเตือนไม่สำเร็จ");
        }
      } finally {
        if (!silent) {
          setRefreshing(false);
        }
      }
    },
    [patientId],
  );

  useEffect(() => {
    if (!patientId) return;

    const kickoffTimeoutId = window.setTimeout(() => {
      void refreshEvents(true);
    }, 120);

    const handleFocus = () => {
      void refreshEvents(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshEvents(true);
      }
    };

    const handleReminderRefreshEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: string }>).detail;
      if (!detail?.patientId || detail.patientId === patientId) {
        void refreshEvents(true);
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshEvents(true);
    }, 15_000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(
      "careguide:reminder-events-refresh",
      handleReminderRefreshEvent as EventListener,
    );

    return () => {
      window.clearTimeout(kickoffTimeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(
        "careguide:reminder-events-refresh",
        handleReminderRefreshEvent as EventListener,
      );
    };
  }, [patientId, refreshEvents]);

  const cancelReminders = async (eventIds: string[], isBulk: boolean) => {
    if (!eventIds.length) return;

    setError(null);
    setSuccess(null);
    setCancellingIds((current) => {
      const next = new Set(current);
      eventIds.forEach((id) => next.add(id));
      return next;
    });
    if (isBulk) setCancellingAllPending(true);

    try {
      const response = await fetch("/api/reminders/cancel-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventIds,
          patientId: patientId ?? undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        cancelledAt?: string;
        cancelledCount?: number;
        cancelledIds?: string[];
      };

      if (!response.ok) {
        setError(payload.error ?? "ยกเลิกการแจ้งเตือนไม่สำเร็จ");
        return;
      }

      const cancelledAt = payload.cancelledAt ?? new Date().toISOString();
      const cancelledIds = payload.cancelledIds ?? eventIds;
      const cancelledIdSet = new Set(cancelledIds);

      setEvents((current) =>
        current.map((event) =>
          cancelledIdSet.has(event.id) ? asCancelledEvent(event, cancelledAt) : event,
        ),
      );

      const cancelledCount = payload.cancelledCount ?? cancelledIds.length;
      setSuccess(
        cancelledCount > 1
          ? `ยกเลิกรายการแจ้งเตือนแล้ว ${cancelledCount} รายการ`
          : "ยกเลิกรายการแจ้งเตือนแล้ว",
      );

      await refreshEvents(true);
      router.refresh();
    } catch {
      setError("ยกเลิกการแจ้งเตือนไม่สำเร็จ");
    } finally {
      setCancellingIds((current) => {
        const next = new Set(current);
        eventIds.forEach((id) => next.delete(id));
        return next;
      });
      if (isBulk) setCancellingAllPending(false);
    }
  };

  const cancelReminder = async (eventId: string) => {
    await cancelReminders([eventId], false);
  };

  const cancelAllPendingReminders = async () => {
    const confirmed = window.confirm("ต้องการยกเลิกรายการแจ้งเตือนที่รอดำเนินการทั้งหมดใช่หรือไม่");
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    setCancellingAllPending(true);

    try {
      const response = await fetch("/api/reminders/cancel-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancelAllPending: true,
          patientId: patientId ?? undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        cancelledCount?: number;
      };

      if (!response.ok) {
        setError(payload.error ?? "ยกเลิกรายการแจ้งเตือนทั้งหมดไม่สำเร็จ");
        return;
      }

      const cancelledCount = payload.cancelledCount ?? 0;
      setSuccess(
        cancelledCount > 0
          ? `ยกเลิกรายการแจ้งเตือนที่รอดำเนินการทั้งหมดแล้ว ${cancelledCount} รายการ`
          : "ไม่พบรายการที่รอดำเนินการให้ยกเลิก",
      );

      await refreshEvents(true);
      router.refresh();
    } catch {
      setError("ยกเลิกรายการแจ้งเตือนทั้งหมดไม่สำเร็จ");
    } finally {
      setCancellingAllPending(false);
    }
  };

  return (
    <div className="space-y-4">
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

      {patientId ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshEvents()}
            disabled={isRefreshing || isCancellingAllPending}
            aria-label="รีเฟรชรายการแจ้งเตือน"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            รีเฟรช
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void cancelAllPendingReminders()}
            disabled={isCancellingAllPending || pendingCount === 0}
            aria-label="ยกเลิกรายการแจ้งเตือนที่รอดำเนินการทั้งหมด"
          >
            {isCancellingAllPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {isCancellingAllPending
              ? "กำลังยกเลิกทั้งหมด..."
              : `ยกเลิกที่รอดำเนินการทั้งหมด (${pendingCount})`}
          </Button>
        </div>
      ) : null}

      <Table data-voice-table="patient-reminder-events">
        <TableHeader>
          <TableRow>
            <TableHead>เวลาแจ้งเตือน</TableHead>
            <TableHead>ช่องทาง</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead>การจัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleEvents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ไม่มีรายการแจ้งเตือน
              </TableCell>
            </TableRow>
          ) : (
            visibleEvents.map((event) => {
              const displayStatus = toDisplayStatus(event);
              const isCancellingThisRow = cancellingIds.has(event.id);

              return (
                <TableRow key={event.id}>
                  <TableCell>{formatDateTime(event.dueAt)}</TableCell>
                  <TableCell>{event.channel}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(displayStatus)}>
                      {statusLabelMap[displayStatus] ?? displayStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {displayStatus === "pending" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isCancellingThisRow || isCancellingAllPending}
                        onClick={() => void cancelReminder(event.id)}
                        aria-label="ยกเลิกรายการแจ้งเตือน"
                      >
                        {isCancellingThisRow ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            กำลังยกเลิก...
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4" />
                            ยกเลิก
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {displayStatus === "cancelled"
                          ? `ยกเลิกเมื่อ ${event.cancelledAt ? formatDateTime(event.cancelledAt) : "ไม่พบเวลา"}`
                          : "-"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {hasMoreThanCollapsedRows ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-cyan-200/70 bg-cyan-50/40 px-3 py-2">
          <p className="text-xs text-cyan-900/90">
            แสดง {visibleEvents.length} จากทั้งหมด {events.length} รายการ
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setExpanded((current) => !current)}
            aria-label={isExpanded ? "ย่อรายการแจ้งเตือน" : "ดูรายการแจ้งเตือนทั้งหมด"}
          >
            {isExpanded ? "ย่อรายการ" : "ดูรายการเต็ม"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
