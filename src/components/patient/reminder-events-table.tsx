"use client";

import { format } from "date-fns";
import { Loader2, RefreshCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const formatDateTime = (dateValue: string | null) =>
  dateValue ? format(new Date(dateValue), "dd/MM/yyyy HH:mm") : "-";

const statusLabelMap: Record<string, string> = {
  pending: "pending",
  sent: "sent",
  failed: "failed",
  cancelled: "cancelled",
};

const statusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "pending") return "secondary";
  if (status === "sent") return "default";
  if (status === "failed") return "destructive";
  return "outline";
};

const getDisplayStatus = (event: ReminderEventRow) => {
  if (event.status === "failed" && event.provider === "user-cancelled") {
    return "cancelled";
  }
  return event.status;
};

export const ReminderEventsTable = ({
  initialEvents,
  patientId,
}: ReminderEventsTableProps) => {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [isCancellingId, setCancellingId] = useState<string | null>(null);
  const [isRefreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  const cancelReminder = async (eventId: string) => {
    setCancellingId(eventId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/reminders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          patientId: patientId ?? undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        cancelledAt?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Cancel reminder failed");
        return;
      }

      const cancelledAt = payload.cancelledAt ?? new Date().toISOString();
      setEvents((current) =>
        current.map((event) =>
          event.id === eventId
            ? { ...event, status: "cancelled", provider: "user-cancelled", cancelledAt }
            : event,
        ),
      );
      setSuccess("Cancel reminder success");
      await refreshEvents(true);
      router.refresh();
    } catch {
      setError("Cancel reminder failed");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Cancel failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertTitle>Done</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {patientId ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshEvents()}
            disabled={isRefreshing}
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Due Time</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No reminder events
              </TableCell>
            </TableRow>
          ) : (
            events.map((event) => {
              const displayStatus = getDisplayStatus(event);

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
                        disabled={isCancellingId === event.id}
                        onClick={() => cancelReminder(event.id)}
                      >
                        {isCancellingId === event.id ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Cancelling...
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4" />
                            Cancel
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {displayStatus === "cancelled"
                          ? `Cancelled ${formatDateTime(event.cancelledAt)}`
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
    </div>
  );
};
