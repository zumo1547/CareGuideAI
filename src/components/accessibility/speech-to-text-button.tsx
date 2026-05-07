"use client";

import { Loader2, Mic } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { listenForSpeechOnce } from "@/lib/voice/recognition";
import { speakThai } from "@/lib/voice/speak";

interface SpeechToTextButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
}

export const SpeechToTextButton = ({
  onTranscript,
  disabled = false,
  label = "พูดแทนพิมพ์",
  ariaLabel = "กดเพื่อพูดแทนการพิมพ์",
}: SpeechToTextButtonProps) => {
  const [isListening, setListening] = useState(false);

  const startListening = async () => {
    if (disabled || isListening) return;

    setListening(true);
    try {
      speakThai("เริ่มฟังแล้ว กรุณาพูดได้เลย");
      const heard = await listenForSpeechOnce({ timeoutMs: 8000 });
      const text = heard.text.trim();
      if (!text) {
        speakThai("ยังไม่ได้ยินข้อความ กรุณาลองใหม่อีกครั้ง");
        return;
      }
      onTranscript(text);
      speakThai(`รับข้อความแล้ว ${text}`);
    } catch {
      speakThai("อุปกรณ์นี้ยังไม่รองรับการพูดแทนพิมพ์");
    } finally {
      setListening(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={ariaLabel}
      disabled={disabled || isListening}
      onClick={() => void startListening()}
      data-voice-action="open-speech-to-text"
    >
      {isListening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      {isListening ? "กำลังฟัง..." : label}
    </Button>
  );
};
