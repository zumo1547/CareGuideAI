import { addMinutes, formatISO } from "date-fns";

import { isWithinDueWindow } from "@/lib/medications/schedule";
import type { ReminderSendPayload } from "@/lib/reminders/provider";

export interface ReminderRuntimeEvent {
  eventId: string;
  patientId: string;
  patientPhone?: string | null;
  dueAt: Date;
  medicineName: string;
  dosage: string;
}

export const makeReminderMessage = (event: ReminderRuntimeEvent) =>
  `ถึงเวลากินยา ${event.medicineName} ขนาด ${event.dosage} กรุณาทานยาตามคำแนะนำแพทย์`;

export const toReminderPayload = (
  event: ReminderRuntimeEvent,
  channel: "sms" | "voice",
): ReminderSendPayload => ({
  eventId: event.eventId,
  patientId: event.patientId,
  patientPhone: event.patientPhone,
  channel,
  dueAt: formatISO(event.dueAt),
  message:
    channel === "sms"
      ? makeReminderMessage(event)
      : `แจ้งเตือนจาก CareGuideAI ถึงเวลาทานยา ${event.medicineName}`,
});

export const shouldDispatchNow = (dueAt: Date, now = new Date()) =>
  isWithinDueWindow({ now, dueAt, earlyMinutes: 3, lateMinutes: 7 });

export const nextDueDate = (
  scheduleTime: string,
  reference = new Date(),
): Date | null => {
  const [h, m] = scheduleTime.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return null;
  }

  const next = new Date(reference);
  next.setHours(h, m, 0, 0);
  if (next < reference) {
    return addMinutes(next, 24 * 60);
  }

  return next;
};
