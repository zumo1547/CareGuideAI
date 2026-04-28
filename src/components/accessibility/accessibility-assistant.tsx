"use client";

import { Accessibility, Contrast, Type, Volume2, VolumeX } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { speakThai, warmupSpeechSynthesis } from "@/lib/voice/speak";

interface AccessibilityPrefs {
  voiceEnabled: boolean;
  announceInteractions: boolean;
  largeText: boolean;
  highContrast: boolean;
}

const STORAGE_KEY = "careguide-a11y-prefs-v1";

const DEFAULT_PREFS: AccessibilityPrefs = {
  voiceEnabled: true,
  announceInteractions: true,
  largeText: false,
  highContrast: false,
};

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
].join(",");

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const routeNameFromPath = (pathname: string) => {
  if (pathname.startsWith("/login")) return "login page";
  if (pathname.startsWith("/register")) return "register page";
  if (pathname.startsWith("/app/patient")) return "patient dashboard";
  if (pathname.startsWith("/app/doctor")) return "doctor dashboard";
  if (pathname.startsWith("/app/admin")) return "admin dashboard";
  if (pathname.startsWith("/app/scan")) return "scan page";
  if (pathname.startsWith("/app")) return "app home";
  if (pathname === "/") return "home page";
  return "page";
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

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const labelFromControl = element.labels?.[0]?.textContent;
    if (labelFromControl) return normalizeText(labelFromControl);

    const elementId = element.id;
    if (elementId) {
      const escaped = typeof CSS !== "undefined" ? CSS.escape(elementId) : elementId;
      const linkedLabel = document.querySelector<HTMLLabelElement>(`label[for="${escaped}"]`);
      if (linkedLabel?.textContent) return normalizeText(linkedLabel.textContent);
    }

    if (element.placeholder) return normalizeText(element.placeholder);
    if (element.name) return normalizeText(element.name);
  }

  if (element instanceof HTMLSelectElement) {
    const labelFromControl = element.labels?.[0]?.textContent;
    if (labelFromControl) return normalizeText(labelFromControl);
    if (element.name) return normalizeText(element.name);
  }

  if (element instanceof HTMLButtonElement) {
    const text = normalizeText(element.textContent ?? "");
    if (text) return text;
  }

  if (element instanceof HTMLAnchorElement) {
    const text = normalizeText(element.textContent ?? "");
    if (text) return text;
  }

  const dataLabel = element.getAttribute("data-a11y-label");
  if (dataLabel) return normalizeText(dataLabel);

  return normalizeText(element.textContent ?? "") || "control";
};

const describeElementType = (element: HTMLElement) => {
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLInputElement) return "input";
  if (element instanceof HTMLTextAreaElement) return "text area";
  if (element instanceof HTMLSelectElement) return "selection";
  return "control";
};

export const AccessibilityAssistant = () => {
  const pathname = usePathname();
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(() => {
    if (typeof window === "undefined") return DEFAULT_PREFS;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PREFS;
      const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
      return {
        ...DEFAULT_PREFS,
        ...parsed,
      };
    } catch {
      return DEFAULT_PREFS;
    }
  });
  const [panelOpen, setPanelOpen] = useState(false);

  const lastSpokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const inputTimersRef = useRef<Map<EventTarget, number>>(new Map());

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
    if (!prefs.voiceEnabled) return;
    speakFeedback(`Opened ${routeNameFromPath(pathname)}`);
  }, [pathname, prefs.voiceEnabled, speakFeedback]);

  useEffect(() => {
    if (!prefs.voiceEnabled || !prefs.announceInteractions) return;

    const inputTimers = inputTimersRef.current;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
      if (!control) return;

      const label = getElementLabel(control);
      const type = describeElementType(control);
      speakFeedback(`${type} ${label}`);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest("button, a[href], [role='button'], [role='link']") as
        | HTMLElement
        | null;
      if (!control) return;

      const label = getElementLabel(control);
      const type = describeElementType(control);
      speakFeedback(`Pressed ${type} ${label}`);
    };

    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      const existingTimer = inputTimers.get(target);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const nextTimer = window.setTimeout(() => {
        const label = getElementLabel(target);
        if (target instanceof HTMLInputElement && target.type === "password") {
          speakFeedback(`Editing password field ${label}`);
          return;
        }

        const charCount = target.value.length;
        speakFeedback(`Editing ${label}. ${charCount} characters`);
      }, 450);

      inputTimers.set(target, nextTimer);
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);

    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);

      inputTimers.forEach((timerId) => window.clearTimeout(timerId));
      inputTimers.clear();
    };
  }, [prefs.announceInteractions, prefs.voiceEnabled, speakFeedback]);

  const voiceLabel = useMemo(
    () => (prefs.voiceEnabled ? "Voice Feedback: On" : "Voice Feedback: Off"),
    [prefs.voiceEnabled],
  );

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[70] md:right-5 md:bottom-5">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {panelOpen ? (
          <div className="w-[19rem] rounded-2xl border bg-background/95 p-3 shadow-xl backdrop-blur">
            <p className="text-sm font-semibold">Accessibility Assistant</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Improve usability for visually impaired users with spoken interaction feedback.
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
                    speakFeedback("Voice feedback enabled", true);
                  } else {
                    speakFeedback("Voice feedback disabled", true);
                  }
                }}
              >
                {prefs.voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span>{voiceLabel}</span>
              </Button>

              <Button
                type="button"
                variant={prefs.announceInteractions ? "default" : "outline"}
                className="justify-start"
                onClick={() =>
                  setPrefs((previous) => ({
                    ...previous,
                    announceInteractions: !previous.announceInteractions,
                  }))
                }
                disabled={!prefs.voiceEnabled}
              >
                <Accessibility className="h-4 w-4" />
                <span>
                  {prefs.announceInteractions ? "Spoken Button/Input Cues: On" : "Spoken Button/Input Cues: Off"}
                </span>
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
                <span>{prefs.largeText ? "Large Text: On" : "Large Text: Off"}</span>
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
                <span>{prefs.highContrast ? "High Contrast: On" : "High Contrast: Off"}</span>
              </Button>
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          size="icon-lg"
          className="rounded-full shadow-lg"
          aria-label="Open accessibility assistant"
          onClick={() => setPanelOpen((previous) => !previous)}
        >
          <Accessibility className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};
