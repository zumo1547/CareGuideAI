"use client";

import {
  Accessibility,
  Contrast,
  Hand,
  Mic,
  MicOff,
  Type,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isAffirmativeSpeech,
  isNegativeSpeech,
  isRepeatSpeech,
  parseVoiceIntent,
  type VoiceIntent,
} from "@/lib/voice/commands";
import {
  isSpeechRecognitionSupported,
  listenForSpeechOnce,
} from "@/lib/voice/recognition";
import { speakThai, stopThaiSpeech, warmupSpeechSynthesis } from "@/lib/voice/speak";

interface AccessibilityPrefs {
  voiceEnabled: boolean;
  announceButtonPress: boolean;
  largeText: boolean;
  highContrast: boolean;
}

type StoredAccessibilityPrefs = Partial<AccessibilityPrefs> & {
  announceInteractions?: boolean;
};

interface PendingConfirmation {
  intent: VoiceIntent;
  prompt: string;
}

const STORAGE_KEY = "careguide-a11y-prefs-v2";
const VOICE_AUTOSTART_KEY = "careguide-voice-autostart-v1";
const VOICE_START_EVENT = "careguide:voice-mode-start";
const VOICE_AUTOSTART_MAX_AGE_MS = 20_000;

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

  return "ปุ่มคำสั่ง";
};

const sectionIdByIntent: Record<Extract<VoiceIntent, { type: "navigate" }>["sectionId"], string> = {
  medicine: "voice-section-medicine",
  "blood-pressure": "voice-section-blood-pressure",
  appointment: "voice-section-appointment",
  chat: "voice-section-chat",
};

const actionSelectorByIntent: Record<Extract<VoiceIntent, { type: "action" }>["actionId"], string> = {
  "start-med-camera-scan": "[data-voice-action='start-med-camera-scan']",
  "confirm-med-plan": "[data-voice-action='confirm-med-plan']",
  "send-chat-message": "[data-voice-action='send-chat-message']",
  "send-support-request": "[data-voice-action='send-support-request']",
  "send-appointment-request": "[data-voice-action='send-appointment-request']",
  "accept-appointment": "[data-voice-action='appointment-accept']",
  "decline-appointment": "[data-voice-action='appointment-decline']",
  "reschedule-appointment": "[data-voice-action='appointment-reschedule']",
  "submit-login": "[data-voice-action='submit-login']",
  "go-register": "[data-voice-action='go-register-page']",
  "submit-register": "[data-voice-action='submit-register']",
  "go-login": "[data-voice-action='go-login-page']",
  "describe-login-fields": "",
  "describe-register-fields": "",
};

const fieldSelectorByIntent: Partial<
  Record<Extract<VoiceIntent, { type: "action" }>["actionId"], string>
> = {
  "send-chat-message": "[data-voice-field='chat-message']",
  "send-support-request": "[data-voice-field='support-request-message']",
  "send-appointment-request": "[data-voice-field='appointment-request-note']",
  "accept-appointment": "[data-voice-field='appointment-response-note']",
  "decline-appointment": "[data-voice-field='appointment-response-note']",
  "reschedule-appointment": "[data-voice-field='appointment-response-note']",
  "submit-login": "[data-voice-field='login-email']",
  "submit-register": "[data-voice-field='register-fullname']",
};

const getErrorAlertText = (element: HTMLElement) => {
  const text = normalizeText(element.innerText || element.textContent || "");
  if (!text) return "";
  const lowered = text.toLowerCase();
  if (
    lowered.includes("error") ||
    lowered.includes("failed") ||
    text.includes("ข้อผิดพลาด") ||
    text.includes("ไม่สำเร็จ")
  ) {
    return text;
  }
  return "";
};

export const AccessibilityAssistant = () => {
  const router = useRouter();
  const pathname = usePathname();
  const isPatientRoute = pathname?.startsWith("/app/patient") ?? false;
  const isLoginRoute = pathname === "/login";
  const isRegisterRoute = pathname === "/register";

  const [prefs, setPrefs] = useState<AccessibilityPrefs>(readInitialPrefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatusText, setVoiceStatusText] = useState(
    "โหมดเสียงยังไม่เริ่ม กดปุ่มเริ่มใช้งานด้วยเสียง",
  );
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const shouldRunVoiceLoopRef = useRef(false);
  const recognitionAbortRef = useRef<AbortController | null>(null);
  const lastSpokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const lastErrorSpokenRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const speakFeedback = useCallback(
    (text: string, force = false) => {
      const normalized = normalizeText(text);
      if (!normalized) return;
      if (!force && !prefs.voiceEnabled) return;

      const now = Date.now();
      if (lastSpokenRef.current.text === normalized && now - lastSpokenRef.current.at < 1100) {
        return;
      }

      speakThai(normalized, 1);
      lastSpokenRef.current = { text: normalized, at: now };
    },
    [prefs.voiceEnabled],
  );

  const clickBySelector = useCallback((selector: string) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return false;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    if (
      target instanceof HTMLButtonElement ||
      target instanceof HTMLAnchorElement ||
      target.getAttribute("role") === "button"
    ) {
      target.click();
      return true;
    }

    target.focus({ preventScroll: true });
    return true;
  }, []);

  const moveToSection = useCallback(
    (sectionId: string) => {
      const section = document.getElementById(sectionId);
      if (!section) {
        const hashUrl = `/app/patient#${sectionId}`;
        router.push(hashUrl);
        return false;
      }

      section.scrollIntoView({ behavior: "smooth", block: "start" });
      const focusTarget = section.querySelector<HTMLElement>(
        "button, input, textarea, select, a[href], h1, h2, h3",
      );
      focusTarget?.focus({ preventScroll: true });
      return true;
    },
    [router],
  );

  const executeIntent = useCallback(
    (intent: VoiceIntent) => {
      if (intent.type === "navigate") {
        const sectionId = sectionIdByIntent[intent.sectionId];
        const ok = moveToSection(sectionId);
        if (ok) {
          setVoiceStatusText(`กำลังไปที่ ${intent.label}`);
          speakFeedback(`กำลังไปที่ ${intent.label}`);
        } else {
          setVoiceStatusText(`กำลังเปิดหน้าเพื่อ ${intent.label}`);
          speakFeedback(`กำลังเปิดหน้าเพื่อ ${intent.label}`);
        }
        return;
      }

      if (intent.actionId === "describe-login-fields") {
        const guide =
          "การเข้าสู่ระบบ ให้กรอก 1 อีเมล 2 รหัสผ่าน แล้วพูดว่า เข้าสู่ระบบ หรือกดปุ่มเข้าสู่ระบบ";
        setVoiceStatusText(guide);
        speakFeedback(guide, true);
        return;
      }

      if (intent.actionId === "describe-register-fields") {
        const guide =
          "การสมัครสมาชิก ให้กรอก 1 ชื่อ นามสกุล 2 อีเมล 3 เบอร์โทรศัพท์ 4 รหัสผ่าน 5 ประเภทผู้ใช้งาน แล้วพูดว่า สมัครสมาชิก";
        setVoiceStatusText(guide);
        speakFeedback(guide, true);
        return;
      }

      if (intent.actionId === "submit-register" && isLoginRoute) {
        const moved = clickBySelector("[data-voice-action='go-register-page']");
        if (moved) {
          setVoiceStatusText("กำลังพาไปหน้าสมัครสมาชิก");
          speakFeedback("กำลังพาไปหน้าสมัครสมาชิก");
        } else {
          setVoiceStatusText("ยังไม่พบหน้าสมัครสมาชิก");
          speakFeedback("ยังไม่พบหน้าสมัครสมาชิก");
        }
        return;
      }

      if (intent.actionId === "submit-login" && isRegisterRoute) {
        const moved = clickBySelector("[data-voice-action='go-login-page']");
        if (moved) {
          setVoiceStatusText("กำลังพาไปหน้าเข้าสู่ระบบ");
          speakFeedback("กำลังพาไปหน้าเข้าสู่ระบบ");
        } else {
          setVoiceStatusText("ยังไม่พบหน้าเข้าสู่ระบบ");
          speakFeedback("ยังไม่พบหน้าเข้าสู่ระบบ");
        }
        return;
      }

      const selector = actionSelectorByIntent[intent.actionId];
      const ok = clickBySelector(selector);
      if (ok) {
        setVoiceStatusText(`ดำเนินการแล้ว: ${intent.label}`);
        speakFeedback(`ดำเนินการแล้ว: ${intent.label}`);
      } else {
        setVoiceStatusText(`ยังไม่พบปุ่มสำหรับ ${intent.label}`);
        speakFeedback(`ยังไม่พบปุ่มสำหรับ ${intent.label} กรุณาเลื่อนไปส่วนที่เกี่ยวข้องก่อน`);
      }
    },
    [clickBySelector, isLoginRoute, isRegisterRoute, moveToSection, speakFeedback],
  );

  const buildConfirmationPrompt = useCallback((intent: VoiceIntent) => {
    if (intent.type !== "action") return `ต้องการ${intent.label}ใช่ไหม`;

    const fieldSelector = fieldSelectorByIntent[intent.actionId];
    if (fieldSelector) {
      const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(fieldSelector);
      const value = normalizeText(field?.value ?? "");
      if (value) {
        return `ต้องการ${intent.label}ใช่ไหม ข้อความคือ ${value}`;
      }
      return `ต้องการ${intent.label}ใช่ไหม`;
    }

    return `ต้องการ${intent.label}ใช่ไหม`;
  }, []);

  const handleHeardSpeech = useCallback(
    async (heardText: string) => {
      const normalized = normalizeText(heardText);
      if (!normalized) {
        setVoiceStatusText("ไม่ได้ยินคำสั่ง ลองพูดใหม่");
        return;
      }

      setVoiceStatusText(`ได้ยิน: ${normalized}`);

      if (pendingConfirmation) {
        if (isAffirmativeSpeech(normalized)) {
          const confirmedIntent = pendingConfirmation.intent;
          setPendingConfirmation(null);
          setVoiceStatusText("ยืนยันคำสั่งแล้ว กำลังดำเนินการ");
          speakFeedback("ยืนยันแล้ว กำลังดำเนินการ");
          executeIntent(confirmedIntent);
          return;
        }

        if (isNegativeSpeech(normalized)) {
          setPendingConfirmation(null);
          setVoiceStatusText("ยกเลิกคำสั่งแล้ว");
          speakFeedback("ยกเลิกคำสั่งแล้ว");
          return;
        }

        if (isRepeatSpeech(normalized)) {
          setVoiceStatusText("กำลังทวนคำสั่ง");
          speakFeedback(pendingConfirmation.prompt, true);
          return;
        }

        setVoiceStatusText("กรุณาตอบ ใช่ ไม่ หรือ ทบทวน");
        speakFeedback("กรุณาตอบ ใช่ ไม่ หรือ ทบทวน");
        return;
      }

      const intent = parseVoiceIntent(normalized);
      if (!intent) {
        setVoiceStatusText("ยังไม่เข้าใจคำสั่ง ลองพูดว่า สแกนยา นัดหมอ หรือ แชทหมอ");
        speakFeedback("ยังไม่เข้าใจคำสั่ง ลองพูดว่า สแกนยา นัดหมอ หรือ แชทหมอ");
        return;
      }

      if (intent.requiresConfirmation) {
        const prompt = buildConfirmationPrompt(intent);
        setPendingConfirmation({ intent, prompt });
        setVoiceStatusText(prompt);
        speakFeedback(`${prompt} ตอบว่า ใช่ ไม่ หรือ ทบทวน`, true);
        return;
      }

      executeIntent(intent);
    },
    [buildConfirmationPrompt, executeIntent, pendingConfirmation, speakFeedback],
  );

  const runVoiceLoop = useCallback(async () => {
    if (!shouldRunVoiceLoopRef.current || !prefs.voiceEnabled) {
      setVoiceListening(false);
      return;
    }

    if (!isSpeechRecognitionSupported()) {
      setVoiceListening(false);
      setVoiceStatusText("อุปกรณ์นี้ยังไม่รองรับการสั่งงานด้วยเสียง");
      speakFeedback("อุปกรณ์นี้ยังไม่รองรับการสั่งงานด้วยเสียง", true);
      return;
    }

    while (shouldRunVoiceLoopRef.current) {
      setVoiceListening(true);
      const abortController = new AbortController();
      recognitionAbortRef.current = abortController;
      const heard = await listenForSpeechOnce({
        timeoutMs: 8000,
        signal: abortController.signal,
      });
      recognitionAbortRef.current = null;
      setVoiceListening(false);

      if (!shouldRunVoiceLoopRef.current) {
        break;
      }

      if (!heard.text.trim()) {
        continue;
      }

      await handleHeardSpeech(heard.text);
    }
  }, [handleHeardSpeech, prefs.voiceEnabled, speakFeedback]);

  const startVoiceMode = useCallback(() => {
    if (shouldRunVoiceLoopRef.current) {
      return;
    }
    warmupSpeechSynthesis();
    shouldRunVoiceLoopRef.current = true;
    setVoiceModeEnabled(true);
    setVoiceStatusText("เริ่มโหมดใช้งานด้วยเสียงแล้ว พูดได้เลย เช่น สแกนยา นัดหมอ แชทหมอ");
    speakFeedback(
      "เริ่มโหมดใช้งานด้วยเสียงแล้ว พูดได้เลย เช่น สแกนยา นัดหมอ แชทหมอ",
      true,
    );
    window.setTimeout(() => {
      void runVoiceLoop();
    }, 0);
  }, [runVoiceLoop, speakFeedback]);

  const stopVoiceMode = useCallback(() => {
    shouldRunVoiceLoopRef.current = false;
    recognitionAbortRef.current?.abort();
    recognitionAbortRef.current = null;
    setVoiceModeEnabled(false);
    setVoiceListening(false);
    setPendingConfirmation(null);
    stopThaiSpeech();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(VOICE_AUTOSTART_KEY);
    }
    setVoiceStatusText("ปิดโหมดใช้งานด้วยเสียงแล้ว");
  }, []);

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

  useEffect(() => {
    if (!prefs.voiceEnabled) return;

    const seen = new WeakSet<HTMLElement>();
    const observer = new MutationObserver(() => {
      const alerts = Array.from(document.querySelectorAll<HTMLElement>("[role='alert']"));
      for (const alert of alerts) {
        if (seen.has(alert)) continue;
        const errorText = getErrorAlertText(alert);
        if (!errorText) continue;

        const now = Date.now();
        if (
          errorText === lastErrorSpokenRef.current.text &&
          now - lastErrorSpokenRef.current.at < 1200
        ) {
          continue;
        }

        seen.add(alert);
        lastErrorSpokenRef.current = { text: errorText, at: now };
        speakFeedback(`แจ้งเตือนข้อผิดพลาด ${errorText}`);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, [prefs.voiceEnabled, speakFeedback]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStartEvent = () => {
      startVoiceMode();
    };

    window.addEventListener(VOICE_START_EVENT, handleStartEvent);

    const autoStartRaw = window.localStorage.getItem(VOICE_AUTOSTART_KEY);
    let shouldAutoStart = false;
    if (autoStartRaw) {
      const parsedTimestamp = Number(autoStartRaw);
      shouldAutoStart =
        Number.isFinite(parsedTimestamp) &&
        Date.now() - parsedTimestamp >= 0 &&
        Date.now() - parsedTimestamp <= VOICE_AUTOSTART_MAX_AGE_MS;
      window.localStorage.removeItem(VOICE_AUTOSTART_KEY);
    }

    let autoStartTimer: number | null = null;
    if (shouldAutoStart) {
      autoStartTimer = window.setTimeout(() => {
        startVoiceMode();
      }, 0);
    }

    return () => {
      if (autoStartTimer !== null) {
        window.clearTimeout(autoStartTimer);
      }
      window.removeEventListener(VOICE_START_EVENT, handleStartEvent);
    };
  }, [startVoiceMode]);

  const voiceLabel = useMemo(
    () =>
      prefs.voiceEnabled
        ? "ปิดเสียงช่วยอ่านปุ่ม"
        : "เปิดเสียงช่วยอ่านปุ่ม",
    [prefs.voiceEnabled],
  );

  const shouldHighlightLauncher = isPatientRoute && !voiceModeEnabled;

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[70] md:right-5 md:bottom-5">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {panelOpen ? (
          <section
            className="w-[22rem] rounded-2xl border bg-background/95 p-3 shadow-xl backdrop-blur"
            aria-label="ผู้ช่วยการเข้าถึงและคำสั่งเสียง"
          >
            <p className="text-sm font-semibold">ผู้ช่วยการเข้าถึง</p>
            <p className="mt-1 text-xs text-muted-foreground">
              รองรับการอ่านปุ่ม คำสั่งเสียง และโหมดตัวอักษรใหญ่สำหรับผู้พิการทางสายตา
            </p>

            <div className="mt-3 flex flex-col gap-2">
              <Button
                type="button"
                variant={voiceModeEnabled ? "default" : "secondary"}
                className="justify-start"
                onClick={() => {
                  if (voiceModeEnabled) {
                    stopVoiceMode();
                  } else {
                    startVoiceMode();
                  }
                }}
                aria-label={voiceModeEnabled ? "ปิดโหมดใช้งานด้วยเสียง" : "เริ่มโหมดใช้งานด้วยเสียง"}
              >
                {voiceModeEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span>{voiceModeEnabled ? "ปิดโหมดใช้งานด้วยเสียง" : "เริ่มโหมดใช้งานด้วยเสียง"}</span>
              </Button>

              <div
                className="rounded-lg border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <p className="font-medium text-foreground">สถานะคำสั่งเสียง</p>
                <p>{voiceListening ? "กำลังฟังคำสั่ง..." : "ยังไม่ได้ฟัง"}</p>
                <p>{voiceStatusText}</p>
              </div>

              <Button
                type="button"
                variant={prefs.voiceEnabled ? "default" : "outline"}
                className="justify-start"
                onClick={() => {
                  const next = !prefs.voiceEnabled;
                  setPrefs((previous) => ({ ...previous, voiceEnabled: next }));
                  if (next) {
                    warmupSpeechSynthesis();
                    speakFeedback("เปิดเสียงช่วยอ่านปุ่มแล้ว", true);
                  } else {
                    stopVoiceMode();
                    speakFeedback("ปิดเสียงช่วยอ่านปุ่มแล้ว", true);
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
                <span>
                  {prefs.announceButtonPress
                    ? "อ่านชื่อปุ่มที่กด: เปิด"
                    : "อ่านชื่อปุ่มที่กด: ปิด"}
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
          </section>
        ) : null}

        {!panelOpen && shouldHighlightLauncher ? (
          <div
            id="voice-launcher-hint"
            className="max-w-[17rem] rounded-2xl border border-cyan-300/80 bg-cyan-50 px-3 py-2 text-xs leading-relaxed text-cyan-900 shadow-lg soft-pulse"
            role="note"
            aria-live="polite"
          >
            <p className="font-semibold">เริ่มพูดได้จากปุ่มนี้</p>
            <p className="mt-1 flex items-start gap-1.5">
              <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              แตะปุ่มวงกลมมุมขวาล่าง แล้วเลือก
              <span className="font-semibold">“เริ่มโหมดใช้งานด้วยเสียง”</span>
            </p>
          </div>
        ) : null}

        <Button
          type="button"
          size="icon-lg"
          className={cn(
            "rounded-full shadow-lg",
            shouldHighlightLauncher && "soft-pulse ring-4 ring-cyan-200",
          )}
          aria-label="เปิดผู้ช่วยการเข้าถึง"
          aria-describedby={shouldHighlightLauncher ? "voice-launcher-hint" : undefined}
          onClick={() => setPanelOpen((previous) => !previous)}
        >
          <Accessibility className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
};
