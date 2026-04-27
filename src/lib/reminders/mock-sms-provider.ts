import type { ReminderDispatchResult } from "@/types/domain";

import type { ReminderProvider, ReminderSendPayload } from "@/lib/reminders/provider";

export class MockSmsProvider implements ReminderProvider {
  providerName = "mock-sms";

  async sendReminder(payload: ReminderSendPayload): Promise<ReminderDispatchResult> {
    console.info("[MockSmsProvider] Sending SMS", payload);

    return {
      eventId: payload.eventId,
      channel: payload.channel,
      success: true,
      provider: this.providerName,
      message: `Mock SMS sent to ${payload.patientPhone ?? "unknown phone"}`,
    };
  }
}
