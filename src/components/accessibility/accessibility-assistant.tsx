"use client";

import { Accessibility, Contrast, Type, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { speakThai, warmupSpeechSynthesis } from "@/lib/voice/speak";

interface AccessibilityPrefs {
  voiceEnabled: boolean;
  announceButtonPress: boolean;
  largeText: boolean;
  highContrast: boolean;
}

type StoredAccessibilityPrefs = Partial<AccessibilityPrefs> & {
  announceInteractions?: boolean;
};

const STORAGE_KEY = "careguide-a11y-prefs-v1";

const DEFAULT_PREFS: AccessibilityPrefs = {
  voiceEnabled: true,
  announceButtonPress: true,
  largeText: false,
  highContrast: false,
};

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const readInitialPrefs = (): AccessibilityPrefs => {
  if (typeof window === "undefined") return DEFAULT_PREFS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;

    const parsed = JSON.parse(raw) as StoredAccessibilityPrefs;
    const announceButtonPress =
      typeof parsed.announceButtonPress === "boolean"
        ? parsed.announceButtonPress
        : typeof parsed.announceInteractions === "boolean"
          ? parsed.announceInteractions
          : DEFAULT_PREFS.announceButtonPress;

    return {
      voiceEnabled:
        typeof parsed.voiceEnabled === "boolean" ? parsed.voiceEnabled : DEFAULT_PREFS.voiceEnabled,
      announceButtonPress,
      largeText: typeof parsed.largeText === "boolean" ? parsed.largeText : DEFAULT_PREFS.largeText,
      highContrast:
        typeof parsed.highContrast === "boolean" ? parsed.highContrast : DEFAULT_PREFS.highContrast,
    };
  } catch {
    return DEFAULT_PREFS;
  }
};

const getElementLabel = (element: HTMLElement) => {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel);

  const ariaLabelledBy = element.getAttribute("aria-labelledby");
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(" ").map((id) => id.trim());
    const text = ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) {
    const text = normalizeText(element.textContent ?? "");
    if (text) return text;
  }

  return "คำสั่ง";
};

export const AccessibilityAssistant = () => {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(readInitialPrefs);
  const [panelOpen, setPanelOpen] = useState(false);

  const lastSpokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const speakFeedback = useCallback(
    (text: string, force = false) => {
      const normalized = normalizeText(text);
      if (!normalized) return;
      if (!force && !prefs.voiceEnabled) return;

      const now = Date.now();
      if (lastSpokenRef.current.text === normalized && now - lastSpokenRef.current.at < 900) {
        return;
      }

      speakThai(normalized, 1);
      lastSpokenRef.current = { text: normalized, at: now };
    },
    [prefs.voiceEnabled],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    root.classList.toggle("a11y-large-text", prefs.largeText);
    root.classList.toggle("a11y-high-contrast", prefs.highContrast);
  }, [prefs.highContrast, prefs.largeText]);

  useEffect(() => {
    if (!prefs.voiceEnabled || !prefs.announceButtonPress) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest("button, [role='button'], a[href], [role='link']") as
        | HTMLElement
        | null;
      if (!control) return;

      const label = getElementLabel(control);
      const type = control instanceof HTMLAnchorElement ? "ลิงก์" : "ปุ่ม";
      speakFeedback(`กด${type} ${label}`);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [prefs.announceButtonPress, prefs.voiceEnabled, speakFeedback]);

  const voiceLabel = useMemo(
    () => (prefs.voiceEnabled ? "เปิดเสียงช่วยการกดปุ่ม" : "ปิดเสียงช่วยการกดปุ่ม"),
    [prefs.voiceEnabled],
  );

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[70] md:right-5 md:bottom-5">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {panelOpen ? (
          <div className="w-[19rem] rounded-2xl border bg-background/95 p-3 shadow-xl backdrop-blur">
            <p className="text-sm font-semibold">ผู้ช่วยการเข้าถึง</p>
            <p className="mt-1 text-xs text-muted-foreground">
              โหมดนี้จะอ่านเสียงเฉพาะตอนกดปุ่มหรือกดลิงก์ เพื่อให้ใช้งานง่ายขึ้นสำหรับผู้พิการทางสายตา
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Button
                type="button"
                variant={prefs.voiceEnabled ? "default" : "outline"}
                className="justify-start"
                onClick={() => {
                  const next = !prefs.voiceEnabled;
                  setPrefs((previous) => ({ ...previous, voiceEnabled: next }));
                  if (next) {
                    warmupSpeechSynthesis();
                    speakFeedback("เปิดเสียงช่วยการกดปุ่มแล้ว", true);
                  } else {
                    speakFeedback("ปิดเสียงช่วยการกดปุ่มแล้ว", true);
                  }
                }}
              >
                {prefs.voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span>{voiceLabel}</span>
              </Button>

              <Button
                type="button"
                variant={prefs.announceButtonPress ? "default" : "outline"}
                className="justify-start"
                onClick={() =>
                  setPrefs((previous) => ({
                    ...previous,
                    announceButtonPress: !previous.announceButtonPress,
                  }))
                }
                disabled={!prefs.voiceEnabled}
              >
                <Accessibility className="h-4 w-4" />
                <span>{prefs.announceButtonPress ? "อ่านชื่อปุ่มที่กด: เปิด" : "อ่านชื่อปุ่มที่กด: ปิด"}</span>
              </Button>

              <Button
                type="button"
                variant={prefs.largeText ? "default" : "outline"}
                className="justify-start"
                onClick={() =>
                  setPrefs((previous) => ({
                    ...previous,
                    largeText: !previous.largeText,
                  }))
                }
              >
                <Type className="h-4 w-4" />
                <span>{prefs.largeText ? "ตัวอักษรใหญ่: เปิด" : "ตัวอักษรใหญ่: ปิด"}</span>
              </Button>

              <Button
                type="button"
                variant={prefs.highContrast ? "default" : "outline"}
                className="justify-start"
                onClick={() =>
                  setPrefs((previous) => ({
                    ...previous,
                    highContrast: !previous.highContrast,
                  }))
                }
              >
                <Contrast className="h-4 w-4" />
                <span>{prefs.highContrast ? "คอนทราสต์สูง: เปิด" : "คอนทราสต์สูง: ปิด"}</span>
              </Button>
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          size="icon-lg"
          className="rounded-full shadow-lg"
          aria-label="เปิดผู้ช่วยการเข้าถึง"
          onClick={() => setPanelOpen((previous) => !previous)}
        >
          <Accessibility className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};

