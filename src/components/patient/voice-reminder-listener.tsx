"use client";

import { useEffect, useRef } from "react";

import {
  isMedicationSnoozeSpeech,
  isMedicationTakenSpeech,
} from "@/lib/voice/commands";
import { listenForSpeechOnce } from "@/lib/voice/recognition";
import { speakThai } from "@/lib/voice/speak";

interface PendingVoiceEvent {
  id: string;
  dueAt: string;
  message: string;
  planId: string | null;
}

interface VoiceReminderListenerProps {
  patientId: string;
}

export const VoiceReminderListener = ({ patientId }: VoiceReminderListenerProps) => {
  const inflightRef = useRef(false);

  useEffect(() => {
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

    const askMedicationResponse = async (event: PendingVoiceEvent) => {
      speakThai(`${event.message} กินแล้วหรือยัง ตอบว่า กินแล้ว หรือ เตือนอีกที`);
      const heard = await listenForSpeechOnce({ timeoutMs: 7000 });
      const text = heard.text.trim();

      if (isMedicationTakenSpeech(text)) {
        const takenLogged = await logTaken(event);
        if (!takenLogged) {
          speakThai("บันทึกการกินยาไม่สำเร็จ จะเตือนซ้ำให้อีกครั้ง");
          return false;
        }

        await acknowledgeEvents([event.id]);
        speakThai("รับทราบว่ากินยาแล้ว และบันทึกเรียบร้อย");
        return true;
      }

      if (isMedicationSnoozeSpeech(text)) {
        speakThai("รับทราบ เดี๋ยวจะเตือนใหม่ตามรอบที่ตั้งไว้");
        return false;
      }

      if (!text) {
        speakThai("ยังไม่ได้ยินคำตอบ จะเตือนให้อีกครั้ง");
        return false;
      }

      speakThai("หากกินยาแล้วให้ตอบว่า กินแล้ว หากยังไม่กินให้ตอบว่า เตือนอีกที");
      return false;
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

        for (const event of events) {
          await askMedicationResponse(event);
        }
      } finally {
        inflightRef.current = false;
      }
    };

    void checkPendingVoiceReminders();
    const interval = window.setInterval(() => {
      void checkPendingVoiceReminders();
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [patientId]);

  return null;
};
