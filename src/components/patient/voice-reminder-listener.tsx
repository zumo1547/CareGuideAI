"use client";

import { useEffect, useRef } from "react";

import { speakThai } from "@/lib/voice/speak";

interface PendingVoiceEvent {
  id: string;
  message: string;
}

export const VoiceReminderListener = () => {
  const inflightRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      if (inflightRef.current) return;
      inflightRef.current = true;

      try {
        const response = await fetch("/api/reminders/pending");
        if (!response.ok) return;
        const payload = (await response.json()) as { events?: PendingVoiceEvent[] };
        const events = payload.events ?? [];
        if (!events.length) return;

        for (const event of events) {
          speakThai(event.message, 1);
        }

        await fetch("/api/reminders/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventIds: events.map((event) => event.id) }),
        });
      } finally {
        inflightRef.current = false;
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  return null;
};
