"use client";

import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VOICE_AUTOSTART_KEY = "careguide-voice-autostart-v1";
const VOICE_START_EVENT = "careguide:voice-mode-start";

interface VoiceModeStartButtonProps {
  href?: string;
  label?: string;
  className?: string;
}

export const VoiceModeStartButton = ({
  href,
  label = "เริ่มใช้งานด้วยเสียง",
  className,
}: VoiceModeStartButtonProps) => {
  const router = useRouter();

  return (
    <Button
      type="button"
      size="lg"
      className={cn("rounded-full px-6", className)}
      aria-label={label}
      data-voice-action="start-voice-mode"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(VOICE_AUTOSTART_KEY, String(Date.now()));
          window.dispatchEvent(new Event(VOICE_START_EVENT));
        }
        if (href) {
          router.push(href);
        }
      }}
    >
      <Mic className="h-4 w-4" />
      {label}
    </Button>
  );
};
