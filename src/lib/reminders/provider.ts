import type { ReminderChannel, ReminderDispatchResult } from "@/types/domain";

export interface ReminderSendPayload {
  eventId: string;
  patientId: string;
  patientPhone?: string | null;
  message: string;
  dueAt: string;
  channel: ReminderChannel;
}

export interface ReminderProvider {
  providerName: string;
  sendReminder(payload: ReminderSendPayload): Promise<ReminderDispatchResult>;
}
