"use client";

import { useEffect, useRef } from "react";

import {
  isMedicationSnoozeSpeech,
  isMedicationTakenSpeech,
} from "@/lib/voice/commands";
import { listenForSpeechOnce } from "@/lib/voice/recognition";
import { speakThaiAndWait } from "@/lib/voice/speak";

interface PendingVoiceEvent {
  id: string;
  dueAt: string;
  message: string;
  planId: string | null;
}

interface VoiceReminderListenerProps {
  patientId: string;
}

const REMINDER_POLL_MS = 30_000;
const LISTEN_TIMEOUT_MS = 16_000;
const LISTEN_RETRY_TIMEOUT_MS = 14_000;
const RETRY_GAP_MS = 1_500;
const VOICE_REPROMPT_COOLDOWN_MS = 2 * 60 * 1000;
const VOICE_SNOOZE_COOLDOWN_MS = 5 * 60 * 1000;

type AskResult = "taken" | "snooze" | "unanswered";

export const VoiceReminderListener = ({ patientId }: VoiceReminderListenerProps) => {
  const inflightRef = useRef(false);
  const nextAllowedAskRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const nextAllowedAskMap = nextAllowedAskRef.current;

    const acknowledgeEvents = async (eventIds: string[]) => {
      if (!eventIds.length) return;
      await fetch("/api/reminders/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds }),
      });
    };

    const logTaken = async (event: PendingVoiceEvent) => {
      if (!event.planId) return true;
      const response = await fetch("/api/adherence/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: event.planId,
          scheduledFor: event.dueAt,
          status: "taken",
          notes: "voice-confirmed",
          patientId,
        }),
      });

      return response.ok;
    };

    const setNextAskAfter = (eventId: string, cooldownMs: number) => {
      nextAllowedAskMap.set(eventId, Date.now() + cooldownMs);
    };

    const askMedicationResponse = async (event: PendingVoiceEvent): Promise<AskResult> => {
      await speakThaiAndWait(
        `${event.message} กินแล้วหรือยัง พูดว่า กินแล้ว หรือ เตือนอีกที`,
        0.88,
        RETRY_GAP_MS,
      );

      const heard = await listenForSpeechOnce({
        timeoutMs: LISTEN_TIMEOUT_MS,
        maxAlternatives: 3,
        interimResults: true,
        waitForTimeoutOnNoMatch: true,
      });
      const text = heard.text.trim();

      if (isMedicationTakenSpeech(text)) {
        const takenLogged = await logTaken(event);
        if (!takenLogged) {
          await speakThaiAndWait("บันทึกการกินยาไม่สำเร็จ จะเตือนใหม่อีกครั้ง", 0.9, 400);
          return "unanswered";
        }

        await acknowledgeEvents([event.id]);
        nextAllowedAskMap.delete(event.id);
        await speakThaiAndWait("รับทราบว่ากินยาแล้ว และบันทึกเรียบร้อย", 0.9, 400);
        return "taken";
      }

      if (isMedicationSnoozeSpeech(text)) {
        await speakThaiAndWait("รับทราบ เดี๋ยวจะเตือนใหม่ตามรอบที่ตั้งไว้", 0.9, 400);
        return "snooze";
      }

      await speakThaiAndWait(
        "ยังจับคำตอบไม่ชัดเจน กรุณาตอบว่า กินแล้ว หรือ เตือนอีกที",
        0.86,
        RETRY_GAP_MS,
      );
      const retryHeard = await listenForSpeechOnce({
        timeoutMs: LISTEN_RETRY_TIMEOUT_MS,
        maxAlternatives: 3,
        interimResults: true,
        waitForTimeoutOnNoMatch: true,
      });
      const retryText = retryHeard.text.trim();

      if (isMedicationTakenSpeech(retryText)) {
        const takenLogged = await logTaken(event);
        if (!takenLogged) {
          await speakThaiAndWait("บันทึกการกินยาไม่สำเร็จ จะเตือนใหม่อีกครั้ง", 0.9, 400);
          return "unanswered";
        }
        await acknowledgeEvents([event.id]);
        nextAllowedAskMap.delete(event.id);
        await speakThaiAndWait("รับทราบว่ากินยาแล้ว และบันทึกเรียบร้อย", 0.9, 400);
        return "taken";
      }

      if (isMedicationSnoozeSpeech(retryText)) {
        await speakThaiAndWait("รับทราบ เดี๋ยวจะเตือนใหม่ตามรอบที่ตั้งไว้", 0.9, 400);
        return "snooze";
      }

      await speakThaiAndWait("ยังไม่ได้ยินคำตอบที่ชัดเจน จะเตือนใหม่อีกครั้งในอีกสักครู่", 0.86, 200);
      return "unanswered";
    };

    const checkPendingVoiceReminders = async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;

      try {
        const response = await fetch("/api/reminders/pending", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { events?: PendingVoiceEvent[] };
        const events = payload.events ?? [];
        if (!events.length) return;

        const now = Date.now();
        const nextEvent = events.find((event) => (nextAllowedAskMap.get(event.id) ?? 0) <= now);
        if (!nextEvent) return;

        const result = await askMedicationResponse(nextEvent);
        if (result === "snooze") {
          setNextAskAfter(nextEvent.id, VOICE_SNOOZE_COOLDOWN_MS);
        } else if (result === "unanswered") {
          setNextAskAfter(nextEvent.id, VOICE_REPROMPT_COOLDOWN_MS);
        }
      } finally {
        inflightRef.current = false;
      }
    };

    void checkPendingVoiceReminders();
    const interval = window.setInterval(() => {
      void checkPendingVoiceReminders();
    }, REMINDER_POLL_MS);

    return () => {
      window.clearInterval(interval);
      nextAllowedAskMap.clear();
    };
  }, [patientId]);

  return null;
};
