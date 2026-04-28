import type { ReminderProvider } from "@/lib/reminders/provider";
import { MockSmsProvider } from "@/lib/reminders/mock-sms-provider";
import { hasTwilioConfig, TwilioSmsProvider } from "@/lib/reminders/twilio-sms-provider";

export const getSmsProvider = (): ReminderProvider => {
  if (hasTwilioConfig()) {
    return new TwilioSmsProvider();
  }

  return new MockSmsProvider();
};
