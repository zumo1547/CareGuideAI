import { env } from "@/lib/env";
import type { ReminderProvider, ReminderSendPayload } from "@/lib/reminders/provider";
import type { ReminderDispatchResult } from "@/types/domain";

const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

const sanitizePhone = (input: string) => input.replace(/[\s()-]/g, "").trim();

const toE164Phone = (phone: string) => {
  const sanitized = sanitizePhone(phone);
  if (!sanitized) return null;

  if (sanitized.startsWith("+")) {
    return E164_PHONE_REGEX.test(sanitized) ? sanitized : null;
  }

  if (sanitized.startsWith("00")) {
    const candidate = `+${sanitized.slice(2)}`;
    return E164_PHONE_REGEX.test(candidate) ? candidate : null;
  }

  // CareGuideAI targets Thai users by default. Convert domestic format to +66.
  if (sanitized.startsWith("0") && sanitized.length >= 9 && sanitized.length <= 10) {
    const candidate = `+66${sanitized.slice(1)}`;
    return E164_PHONE_REGEX.test(candidate) ? candidate : null;
  }

  return null;
};

const summarizeTwilioError = (payload: unknown) => {
  if (payload && typeof payload === "object") {
    const message =
      "message" in payload && typeof payload.message === "string" ? payload.message : null;
    const code = "code" in payload ? String(payload.code) : null;
    if (message && code) return `Twilio error ${code}: ${message}`;
    if (message) return message;
  }

  return "Twilio request failed";
};

export const hasTwilioConfig = () =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_PHONE);

export class TwilioSmsProvider implements ReminderProvider {
  providerName = "twilio";

  async sendReminder(payload: ReminderSendPayload): Promise<ReminderDispatchResult> {
    if (!payload.patientPhone) {
      return {
        eventId: payload.eventId,
        channel: payload.channel,
        success: false,
        provider: this.providerName,
        message: "Missing patient phone number",
      };
    }

    const to = toE164Phone(payload.patientPhone);
    if (!to) {
      return {
        eventId: payload.eventId,
        channel: payload.channel,
        success: false,
        provider: this.providerName,
        message: `Invalid phone format: ${payload.patientPhone}. Use E.164, e.g. +66812345678`,
      };
    }

    const from = toE164Phone(env.TWILIO_FROM_PHONE);
    if (!from) {
      return {
        eventId: payload.eventId,
        channel: payload.channel,
        success: false,
        provider: this.providerName,
        message: "Invalid TWILIO_FROM_PHONE format. Use E.164, e.g. +12025550123",
      };
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const body = new URLSearchParams({
      To: to,
      From: from,
      Body: payload.message,
    });

    const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString(
      "base64",
    );

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return {
          eventId: payload.eventId,
          channel: payload.channel,
          success: false,
          provider: this.providerName,
          message: summarizeTwilioError(data),
        };
      }

      const sid = typeof data.sid === "string" ? data.sid : null;
      return {
        eventId: payload.eventId,
        channel: payload.channel,
        success: true,
        provider: this.providerName,
        message: sid ? `Twilio SMS queued (${sid})` : "Twilio SMS queued",
      };
    } catch (error) {
      return {
        eventId: payload.eventId,
        channel: payload.channel,
        success: false,
        provider: this.providerName,
        message:
          error instanceof Error ? `Twilio request failed: ${error.message}` : "Twilio request failed",
      };
    }
  }
}
