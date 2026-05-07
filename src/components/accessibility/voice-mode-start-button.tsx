"use client";

import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const VOICE_AUTOSTART_KEY = "careguide-voice-autostart-v1";
const VOICE_START_EVENT = "careguide:voice-mode-start";

interface VoiceModeStartButtonProps {
  href: string;
  label?: string;
}

export const VoiceModeStartButton = ({
  href,
  label = "เริ่มใช้งานด้วยเสียง",
}: VoiceModeStartButtonProps) => {
  const router = useRouter();

  return (
    <Button
      type="button"
      size="lg"
      className="rounded-full px-6"
      aria-label={label}
      onClick={() => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(VOICE_AUTOSTART_KEY, "1");
          window.dispatchEvent(new Event(VOICE_START_EVENT));
        }
        router.push(href);
      }}
    >
      <Mic className="h-4 w-4" />
      {label}
    </Button>
  );
};
