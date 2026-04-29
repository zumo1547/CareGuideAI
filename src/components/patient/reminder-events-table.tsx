"use client";

import { format } from "date-fns";
import { Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ReminderEventRow = {
  id: string;
  dueAt: string;
  channel: string;
  status: string;
  cancelledAt: string | null;
};

interface ReminderEventsTableProps {
  initialEvents: ReminderEventRow[];
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

export const ReminderEventsTable = ({ initialEvents }: ReminderEventsTableProps) => {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [isCancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cancelReminder = async (eventId: string) => {
    setCancellingId(eventId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/reminders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
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
            ? { ...event, status: "cancelled", cancelledAt }
            : event,
        ),
      );
      setSuccess("Cancel reminder success");
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
            events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatDateTime(event.dueAt)}</TableCell>
                <TableCell>{event.channel}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(event.status)}>{statusLabelMap[event.status] ?? event.status}</Badge>
                </TableCell>
                <TableCell>
                  {event.status === "pending" ? (
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
                      {event.status === "cancelled" ? `Cancelled ${formatDateTime(event.cancelledAt)}` : "-"}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

