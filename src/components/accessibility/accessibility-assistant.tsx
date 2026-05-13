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
  isVoiceModeStopSpeech,
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

interface VoiceStartEventDetail {
  forceEnableVoice?: boolean;
  source?: string;
}

interface StartVoiceModeOptions {
  forceEnableVoice?: boolean;
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
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const estimatePromptLeadMs = (text: string) => {
  const base = 800;
  const byLength = Math.min(2200, Math.max(0, text.length * 22));
  return base + byLength;
};

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
  "start-bp-camera-scan": "[data-voice-action='start-bp-camera-scan']",
  "confirm-med-plan": "[data-voice-action='confirm-med-plan']",
  "read-latest-reminders": "",
  "send-chat-message": "[data-voice-action='send-chat-message']",
  "send-support-request": "[data-voice-action='send-support-request']",
  "send-appointment-request": "[data-voice-action='send-appointment-request']",
  "voice-compose-support-request": "",
  "voice-compose-appointment-request": "",
  "accept-appointment": "[data-voice-action='appointment-accept']",
  "decline-appointment": "[data-voice-action='appointment-decline']",
  "reschedule-appointment": "[data-voice-action='appointment-reschedule']",
  "submit-login": "[data-voice-action='submit-login']",
  "go-register": "[data-voice-action='go-register-page']",
  "submit-register": "[data-voice-action='submit-register']",
  "go-login": "[data-voice-action='go-login-page']",
  "describe-login-fields": "",
  "describe-register-fields": "",
  "go-patient-dashboard": "[data-voice-action='go-patient-dashboard']",
  "go-medicine-scan-page": "[data-voice-action='go-medicine-scan-page']",
  "go-bp-scan-page": "[data-voice-action='go-bp-scan-page']",
  "go-profile-page": "[data-voice-action='go-profile-page']",
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

const reminderStatusToThai = (statusText: string) => {
  const normalized = normalizeText(statusText).toLowerCase();
  if (!normalized) return "-";
  if (normalized.includes("active")) return "กำลังใช้งาน";
  if (normalized.includes("inactive")) return "หยุดใช้งาน";
  if (normalized.includes("pending")) return "รอดำเนินการ";
  if (normalized.includes("sent")) return "ส่งแล้ว";
  if (normalized.includes("cancelled")) return "ยกเลิกแล้ว";
  if (normalized.includes("failed")) return "ส่งไม่สำเร็จ";
  if (normalized.includes("รอดำเนินการ")) return "รอดำเนินการ";
  if (normalized.includes("ส่งแล้ว")) return "ส่งแล้ว";
  if (normalized.includes("ยกเลิกแล้ว")) return "ยกเลิกแล้ว";
  if (normalized.includes("ส่งไม่สำเร็จ")) return "ส่งไม่สำเร็จ";
  return statusText;
};

export const AccessibilityAssistant = () => {
  const router = useRouter();
  const pathname = usePathname();
  const isHomeRoute = pathname === "/";
  const isPatientRoute = pathname?.startsWith("/app/patient") ?? false;
  const isLoginRoute = pathname === "/login";
  const isRegisterRoute = pathname === "/register";
  const isAuthRoute = isLoginRoute || isRegisterRoute;
  const isPreAuthRoute = isHomeRoute || isAuthRoute;
  const showAssistantUi = isPreAuthRoute || (pathname?.startsWith("/app") ?? false);
  const showVoiceModeControlsInAssistant = !isPreAuthRoute;

  const [prefs, setPrefs] = useState<AccessibilityPrefs>(readInitialPrefs);
  const [panelOpen, setPanelOpen] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatusText, setVoiceStatusText] = useState(
    "โหมดเสียงยังไม่เริ่ม กดปุ่มเริ่มใช้งานด้วยเสียง",
  );

  const shouldRunVoiceLoopRef = useRef(false);
  const voiceEnabledRef = useRef(prefs.voiceEnabled);
  const pendingConfirmationRef = useRef<PendingConfirmation | null>(null);
  const noMatchStreakRef = useRef(0);
  const noIntentStreakRef = useRef(0);
  const lastGuidanceSpokenAtRef = useRef(0);
  const pauseListeningUntilRef = useRef(0);
  const routeFlagsRef = useRef({
    isHomeRoute,
    isLoginRoute,
    isRegisterRoute,
    isPreAuthRoute,
    isPatientRoute,
  });
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

  const speakGuidanceWithCooldown = useCallback(
    (text: string, minIntervalMs = 3500) => {
      const now = Date.now();
      if (now - lastGuidanceSpokenAtRef.current < minIntervalMs) {
        return;
      }
      lastGuidanceSpokenAtRef.current = now;
      speakFeedback(text, true);
      pauseListeningUntilRef.current = Date.now() + estimatePromptLeadMs(text);
    },
    [speakFeedback],
  );

  const deactivateVoiceMode = useCallback(
    (speakAfterStop = false) => {
      shouldRunVoiceLoopRef.current = false;
      recognitionAbortRef.current?.abort();
      recognitionAbortRef.current = null;
      noMatchStreakRef.current = 0;
      noIntentStreakRef.current = 0;
      setVoiceModeEnabled(false);
      setVoiceListening(false);
      pendingConfirmationRef.current = null;
      stopThaiSpeech();
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(VOICE_AUTOSTART_KEY);
      }
      setVoiceStatusText("ปิดโหมดใช้งานด้วยเสียงแล้ว");
      if (speakAfterStop) {
        speakFeedback("ปิดโหมดใช้งานด้วยเสียงแล้ว", true);
      }
    },
    [speakFeedback],
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

  const setFieldValueBySelector = useCallback((selector: string, value: string) => {
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!field) return false;
    field.focus({ preventScroll: true });

    const isTextArea = field instanceof HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(
      isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(field, value);
    if (!descriptor?.set) {
      field.value = value;
    }

    const inputEvent =
      typeof InputEvent !== "undefined"
        ? new InputEvent("input", { bubbles: true, data: value })
        : new Event("input", { bubbles: true });
    field.dispatchEvent(inputEvent);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, []);

  const captureSpeechText = useCallback(
    async (prompt: string, timeoutMs = 14_000) => {
      if (!shouldRunVoiceLoopRef.current || !voiceEnabledRef.current) {
        return null;
      }

      setVoiceStatusText(prompt);
      speakFeedback(prompt, true);
      const leadMs = estimatePromptLeadMs(prompt);
      pauseListeningUntilRef.current = Date.now() + leadMs;
      await sleep(leadMs);
      setVoiceListening(true);
      const heard = await listenForSpeechOnce({
        timeoutMs,
        maxAlternatives: 6,
      });
      setVoiceListening(false);

      const transcript = normalizeText(heard.text);
      if (!transcript) {
        const retryMessage = "ยังไม่ได้ยินข้อความชัดเจน กรุณาลองสั่งใหม่อีกครั้ง";
        setVoiceStatusText(retryMessage);
        speakFeedback(retryMessage, true);
        return null;
      }

      if (isVoiceModeStopSpeech(transcript)) {
        deactivateVoiceMode(true);
        return null;
      }

      return transcript;
    },
    [deactivateVoiceMode, speakFeedback],
  );

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

  const queueConfirmation = useCallback(
    (intent: VoiceIntent, prompt: string) => {
      const nextConfirmation = { intent, prompt };
      pendingConfirmationRef.current = nextConfirmation;
      setVoiceStatusText(prompt);
      speakFeedback(`${prompt} ตอบว่า ใช่ ไม่ หรือ ทบทวน`, true);
      pauseListeningUntilRef.current = Date.now() + estimatePromptLeadMs(prompt);
    },
    [speakFeedback],
  );

  const buildLatestMedicationReminderSpeech = useCallback(() => {
    const section = document.querySelector<HTMLElement>(
      "[data-voice-section='latest-medication-reminders']",
    );
    if (!section) {
      return "ยังไม่พบส่วนตารางยาและการแจ้งเตือนล่าสุดในหน้านี้";
    }

    section.scrollIntoView({ behavior: "smooth", block: "start" });

    const medicationRows = Array.from(
      section.querySelectorAll<HTMLTableRowElement>(
        "[data-voice-table='latest-medication-plan'] tbody tr",
      ),
    );

    let medicationSummary = "ตารางยาล่าสุดยังไม่มีข้อมูล";
    if (medicationRows.length > 0) {
      const singleCellText = normalizeText(
        medicationRows[0]?.querySelectorAll("td").length === 1
          ? medicationRows[0].textContent ?? ""
          : "",
      );

      if (singleCellText.includes("ยังไม่มีแผนยา")) {
        medicationSummary = "ตอนนี้ยังไม่มีแผนยาในระบบ";
      } else {
        const parsedMedicationRows = medicationRows
          .map((row) => {
            const cells = row.querySelectorAll<HTMLTableCellElement>("td");
            if (cells.length < 4) return null;
            const medicine = normalizeText(cells[0]?.textContent ?? "");
            const dosage = normalizeText(cells[1]?.textContent ?? "");
            const time = normalizeText(cells[2]?.textContent ?? "");
            const status = reminderStatusToThai(normalizeText(cells[3]?.textContent ?? ""));
            if (!medicine && !dosage && !time) return null;
            return { medicine, dosage, time, status };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (parsedMedicationRows.length > 0) {
          const latestMedication = parsedMedicationRows[0];
          const activeCount = parsedMedicationRows.filter((row) => row.status === "กำลังใช้งาน").length;
          medicationSummary = `มียาทั้งหมด ${parsedMedicationRows.length} รายการ ใช้งานอยู่ ${activeCount} รายการ รายการล่าสุดคือ ${latestMedication?.medicine ?? "-"} ขนาดยา ${latestMedication?.dosage || "-"} เวลา ${latestMedication?.time || "-"} สถานะ ${latestMedication?.status || "-"}`;
        }
      }
    }

    const reminderSection = document.querySelector<HTMLElement>(
      "[data-voice-section='patient-reminder-events']",
    );
    const reminderRows = reminderSection
      ? Array.from(
          reminderSection.querySelectorAll<HTMLTableRowElement>(
            "[data-voice-table='patient-reminder-events'] tbody tr",
          ),
        )
      : [];

    let reminderSummary = "ยังไม่มีรายการแจ้งเตือนล่าสุด";
    if (reminderRows.length > 0) {
      const singleCellText = normalizeText(
        reminderRows[0]?.querySelectorAll("td").length === 1 ? reminderRows[0].textContent ?? "" : "",
      );

      if (singleCellText.includes("ไม่มีรายการแจ้งเตือน")) {
        reminderSummary = "ตอนนี้ยังไม่มีรายการแจ้งเตือน";
      } else {
        const parsedReminderRows = reminderRows
          .map((row) => {
            const cells = row.querySelectorAll<HTMLTableCellElement>("td");
            if (cells.length < 3) return null;
            const dueTime = normalizeText(cells[0]?.textContent ?? "");
            const channel = normalizeText(cells[1]?.textContent ?? "");
            const status = reminderStatusToThai(normalizeText(cells[2]?.textContent ?? ""));
            if (!dueTime && !channel && !status) return null;
            return { dueTime, channel, status };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));

        if (parsedReminderRows.length > 0) {
          const latestReminder = parsedReminderRows[0];
          const pendingCount = parsedReminderRows.filter((row) => row.status === "รอดำเนินการ").length;
          const sentCount = parsedReminderRows.filter((row) => row.status === "ส่งแล้ว").length;
          const cancelledCount = parsedReminderRows.filter((row) => row.status === "ยกเลิกแล้ว").length;
          const failedCount = parsedReminderRows.filter((row) => row.status === "ส่งไม่สำเร็จ").length;

          reminderSummary = `มีรายการแจ้งเตือนทั้งหมด ${parsedReminderRows.length} รายการ รอดำเนินการ ${pendingCount} รายการ ส่งแล้ว ${sentCount} รายการ ยกเลิกแล้ว ${cancelledCount} รายการ ส่งไม่สำเร็จ ${failedCount} รายการ และรายการล่าสุดคือ เวลา ${latestReminder?.dueTime || "-"} ช่องทาง ${latestReminder?.channel || "-"} สถานะ ${latestReminder?.status || "-"}`;
        }
      }
    }

    return `สรุปตารางยาและการแจ้งเตือนล่าสุด ${medicationSummary} และข้อมูล Reminder Events ${reminderSummary}`;
  }, []);

  const runSupportRequestVoiceFlow = useCallback(async () => {
    const intro = "ถึงส่วนแชทแพทย์แล้ว กรุณาพูดข้อความร้องขอความช่วยเหลือ";
    const spokenText = await captureSpeechText(intro, 18_000);
    if (!spokenText) {
      return;
    }

    const fillOk = setFieldValueBySelector("[data-voice-field='support-request-message']", spokenText);
    if (!fillOk) {
      const message = "ยังไม่พบช่องข้อความคำร้องหาแพทย์";
      setVoiceStatusText(message);
      speakFeedback(message, true);
      return;
    }

    const confirmIntent: VoiceIntent = {
      type: "action",
      actionId: "send-support-request",
      label: "ส่งคำร้องขอความช่วยเหลือถึงแพทย์",
      requiresConfirmation: true,
    };
    queueConfirmation(confirmIntent, `ต้องการส่งคำร้องถึงแพทย์ ข้อความว่า ${spokenText} ใช่ไหม`);
  }, [captureSpeechText, queueConfirmation, setFieldValueBySelector, speakFeedback]);

  const runAppointmentRequestVoiceFlow = useCallback(async () => {
    const intro = "ถึงส่วนนัดแพทย์แล้ว กรุณาพูดอาการหรือเหตุผลที่ต้องการนัดพบแพทย์";
    const spokenText = await captureSpeechText(intro, 18_000);
    if (!spokenText) {
      return;
    }

    const fillOk = setFieldValueBySelector("[data-voice-field='appointment-request-note']", spokenText);
    if (!fillOk) {
      const message = "ยังไม่พบช่องข้อความคำขอนัดหมาย";
      setVoiceStatusText(message);
      speakFeedback(message, true);
      return;
    }

    const confirmIntent: VoiceIntent = {
      type: "action",
      actionId: "send-appointment-request",
      label: "ส่งคำขอนัดหมายถึงแพทย์",
      requiresConfirmation: true,
    };
    queueConfirmation(confirmIntent, `ต้องการส่งคำขอนัดหมาย ข้อความว่า ${spokenText} ใช่ไหม`);
  }, [captureSpeechText, queueConfirmation, setFieldValueBySelector, speakFeedback]);

  const ensureActionFieldHasContent = useCallback(
    async (actionId: Extract<VoiceIntent, { type: "action" }>["actionId"]) => {
      const fieldSelector = fieldSelectorByIntent[actionId];
      if (!fieldSelector) return true;

      const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(fieldSelector);
      if (!field) return false;

      const currentValue = normalizeText(field.value ?? "");
      if (currentValue.length > 0) return true;

      const promptByAction: Partial<Record<typeof actionId, string>> = {
        "send-chat-message": "กรุณาพูดข้อความที่ต้องการส่งหาแพทย์",
        "send-support-request": "กรุณาพูดข้อความคำร้องขอความช่วยเหลือ",
        "send-appointment-request": "กรุณาพูดอาการหรือเหตุผลที่ต้องการนัดหมาย",
        "accept-appointment": "หากต้องการส่งข้อความถึงแพทย์ กรุณาพูดได้เลย",
        "decline-appointment": "กรุณาพูดเหตุผลการปฏิเสธนัด",
        "reschedule-appointment": "กรุณาพูดเหตุผลการขอเลื่อนนัด",
      };

      const spokenText = await captureSpeechText(
        promptByAction[actionId] ?? "กรุณาพูดข้อความ",
        18_000,
      );
      if (!spokenText) return false;

      return setFieldValueBySelector(fieldSelector, spokenText);
    },
    [captureSpeechText, setFieldValueBySelector],
  );

  const executeIntent = useCallback(
    async (intent: VoiceIntent) => {
      const currentFlags = routeFlagsRef.current;
      if (intent.type === "navigate") {
        if (currentFlags.isPreAuthRoute) {
          const message = currentFlags.isRegisterRoute
            ? "หน้านี้ใช้คำสั่ง สมัครสมาชิก วิธีสมัครสมาชิก หรือ เข้าสู่ระบบ"
            : "หน้านี้ใช้คำสั่ง เข้าสู่ระบบ วิธีเข้าสู่ระบบ หรือ สมัครสมาชิก";
          setVoiceStatusText(message);
          speakFeedback(message, true);
          return;
        }

        const sectionId = sectionIdByIntent[intent.sectionId];
        const ok = moveToSection(sectionId);
        if (ok) {
          setVoiceStatusText(`กำลังไปที่ ${intent.label}`);
          speakFeedback(`กำลังไปที่ ${intent.label}`);
        } else {
          setVoiceStatusText(`กำลังเปิดหน้าเพื่อ ${intent.label}`);
          speakFeedback(`กำลังเปิดหน้าเพื่อ ${intent.label}`);
        }

        if (currentFlags.isPatientRoute) {
          if (intent.sectionId === "medicine") {
            const followIntent: VoiceIntent = {
              type: "action",
              actionId: "start-med-camera-scan",
              label: "เริ่มสแกนยาด้วยกล้อง",
              requiresConfirmation: true,
            };
            queueConfirmation(followIntent, "ถึงส่วนสแกนยาแล้ว ต้องการเริ่มสแกนด้วยกล้องเลยไหม");
            return;
          }

          if (intent.sectionId === "blood-pressure") {
            const followIntent: VoiceIntent = {
              type: "action",
              actionId: "start-bp-camera-scan",
              label: "เริ่มสแกนความดันด้วยกล้อง",
              requiresConfirmation: true,
            };
            queueConfirmation(followIntent, "ถึงส่วนสแกนความดันแล้ว ต้องการเริ่มสแกนด้วยกล้องเลยไหม");
            return;
          }

          if (intent.sectionId === "chat") {
            await runSupportRequestVoiceFlow();
            return;
          }

          if (intent.sectionId === "appointment") {
            await runAppointmentRequestVoiceFlow();
            return;
          }
        }
        return;
      }

      if (currentFlags.isPreAuthRoute) {
        const unsupportedInPreAuth = new Set([
          "start-med-camera-scan",
          "confirm-med-plan",
          "send-chat-message",
          "send-support-request",
          "send-appointment-request",
          "start-bp-camera-scan",
          "voice-compose-support-request",
          "voice-compose-appointment-request",
          "accept-appointment",
          "decline-appointment",
          "reschedule-appointment",
        ]);
        if (unsupportedInPreAuth.has(intent.actionId)) {
          const message = "ก่อนเข้าสู่ระบบ ใช้ได้เฉพาะคำสั่ง เข้าสู่ระบบ หรือ สมัครสมาชิก";
          setVoiceStatusText(message);
          speakFeedback(message, true);
          return;
        }
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

      if (intent.actionId === "read-latest-reminders") {
        if (!currentFlags.isPatientRoute) {
          const message = "คำสั่งนี้ใช้ได้ในหน้าแดชบอร์ดผู้พิการเท่านั้น";
          setVoiceStatusText(message);
          speakFeedback(message, true);
          return;
        }

        const speech = buildLatestMedicationReminderSpeech();
        setVoiceStatusText("กำลังอ่านตารางยาและการแจ้งเตือนล่าสุด");
        speakFeedback(speech, true);
        return;
      }

      if (intent.actionId === "voice-compose-support-request") {
        await runSupportRequestVoiceFlow();
        return;
      }

      if (intent.actionId === "voice-compose-appointment-request") {
        await runAppointmentRequestVoiceFlow();
        return;
      }

      if (intent.actionId === "submit-register" && currentFlags.isLoginRoute) {
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

      if (intent.actionId === "submit-login" && currentFlags.isRegisterRoute) {
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

      if (intent.actionId === "submit-login" && currentFlags.isHomeRoute) {
        const moved = clickBySelector("[data-voice-action='go-login-page']");
        if (moved) {
          setVoiceStatusText("กำลังพาไปหน้าเข้าสู่ระบบ");
          speakFeedback("กำลังพาไปหน้าเข้าสู่ระบบ");
        } else {
          setVoiceStatusText("ยังไม่พบปุ่มไปหน้าเข้าสู่ระบบ");
          speakFeedback("ยังไม่พบปุ่มไปหน้าเข้าสู่ระบบ");
        }
        return;
      }

      if (intent.actionId === "submit-register" && currentFlags.isHomeRoute) {
        const moved = clickBySelector("[data-voice-action='go-register-page']");
        if (moved) {
          setVoiceStatusText("กำลังพาไปหน้าสมัครสมาชิก");
          speakFeedback("กำลังพาไปหน้าสมัครสมาชิก");
        } else {
          setVoiceStatusText("ยังไม่พบปุ่มไปหน้าสมัครสมาชิก");
          speakFeedback("ยังไม่พบปุ่มไปหน้าสมัครสมาชิก");
        }
        return;
      }

      const selector = actionSelectorByIntent[intent.actionId];
      if (!selector) {
        setVoiceStatusText(`ยังไม่พบคำสั่งที่ทำงานได้สำหรับ ${intent.label}`);
        speakFeedback(`ยังไม่พบคำสั่งที่ทำงานได้สำหรับ ${intent.label}`);
        return;
      }

      const shouldAutoCaptureField = new Set([
        "send-chat-message",
        "send-support-request",
        "send-appointment-request",
        "accept-appointment",
        "decline-appointment",
        "reschedule-appointment",
      ]);
      if (shouldAutoCaptureField.has(intent.actionId)) {
        const isReady = await ensureActionFieldHasContent(intent.actionId);
        if (!isReady) {
          const message = "ยังไม่พร้อมส่งคำสั่งนี้ กรุณาลองพูดข้อความอีกครั้ง";
          setVoiceStatusText(message);
          speakFeedback(message, true);
          return;
        }
      }

      const ok = clickBySelector(selector);
      if (ok) {
        setVoiceStatusText(`ดำเนินการแล้ว: ${intent.label}`);
        speakFeedback(`ดำเนินการแล้ว: ${intent.label}`);
      } else {
        setVoiceStatusText(`ยังไม่พบปุ่มสำหรับ ${intent.label}`);
        speakFeedback(`ยังไม่พบปุ่มสำหรับ ${intent.label} กรุณาเลื่อนไปส่วนที่เกี่ยวข้องก่อน`);
      }
    },
    [
      clickBySelector,
      ensureActionFieldHasContent,
      buildLatestMedicationReminderSpeech,
      moveToSection,
      queueConfirmation,
      runAppointmentRequestVoiceFlow,
      runSupportRequestVoiceFlow,
      speakFeedback,
    ],
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

      if (isVoiceModeStopSpeech(normalized)) {
        deactivateVoiceMode(true);
        return;
      }

      setVoiceStatusText(`ได้ยิน: ${normalized}`);

      const activePendingConfirmation = pendingConfirmationRef.current;
      if (activePendingConfirmation) {
        if (isNegativeSpeech(normalized)) {
          pendingConfirmationRef.current = null;
          noIntentStreakRef.current = 0;
          setVoiceStatusText("ยกเลิกคำสั่งแล้ว");
          speakFeedback("ยกเลิกคำสั่งแล้ว");
          return;
        }

        if (isAffirmativeSpeech(normalized)) {
          const confirmedIntent = activePendingConfirmation.intent;
          pendingConfirmationRef.current = null;
          noIntentStreakRef.current = 0;
          setVoiceStatusText("ยืนยันคำสั่งแล้ว กำลังดำเนินการ");
          speakFeedback("ยืนยันแล้ว กำลังดำเนินการ");
          await executeIntent(confirmedIntent);
          return;
        }

        if (isRepeatSpeech(normalized)) {
          noIntentStreakRef.current = 0;
          setVoiceStatusText("กำลังทวนคำสั่ง");
          speakFeedback(activePendingConfirmation.prompt, true);
          pauseListeningUntilRef.current =
            Date.now() + estimatePromptLeadMs(activePendingConfirmation.prompt);
          return;
        }

        setVoiceStatusText("กรุณาตอบ ใช่ ไม่ หรือ ทบทวน");
        speakFeedback("กรุณาตอบ ใช่ ไม่ หรือ ทบทวน");
        pauseListeningUntilRef.current = Date.now() + estimatePromptLeadMs("กรุณาตอบ ใช่ ไม่ หรือ ทบทวน");
        return;
      }

      const intent = parseVoiceIntent(normalized);
      if (!intent) {
        noIntentStreakRef.current += 1;
        const currentFlags = routeFlagsRef.current;
        const message = currentFlags.isPreAuthRoute
          ? currentFlags.isRegisterRoute
            ? "ยังไม่เข้าใจคำสั่ง ลองพูดว่า สมัครสมาชิก วิธีสมัครสมาชิก หรือ เข้าสู่ระบบ"
            : "ยังไม่เข้าใจคำสั่ง ลองพูดว่า เข้าสู่ระบบ วิธีเข้าสู่ระบบ หรือ สมัครสมาชิก"
          : "ยังไม่เข้าใจคำสั่ง ลองพูดว่า สแกนยา สแกนความดัน นัดแพทย์ แชทแพทย์ หรือ ดูการแจ้งเตือนล่าสุด";

        if (noIntentStreakRef.current < 2) {
          setVoiceStatusText("กำลังฟังอยู่ ลองพูดช้าๆ อีกครั้ง");
          return;
        }

        setVoiceStatusText(message);
        speakGuidanceWithCooldown(message);
        noIntentStreakRef.current = 0;
        return;
      }

      noIntentStreakRef.current = 0;
      if (intent.requiresConfirmation) {
        const prompt = buildConfirmationPrompt(intent);
        queueConfirmation(intent, prompt);
        return;
      }

      await executeIntent(intent);
    },
    [
      buildConfirmationPrompt,
      deactivateVoiceMode,
      executeIntent,
      queueConfirmation,
      speakGuidanceWithCooldown,
      speakFeedback,
    ],
  );

  const runVoiceLoop = useCallback(async () => {
    if (!shouldRunVoiceLoopRef.current || !voiceEnabledRef.current) {
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
      const now = Date.now();
      if (pauseListeningUntilRef.current > now) {
        await sleep(pauseListeningUntilRef.current - now);
        if (!shouldRunVoiceLoopRef.current) {
          break;
        }
      }

      setVoiceListening(true);
      const abortController = new AbortController();
      recognitionAbortRef.current = abortController;
      const currentFlags = routeFlagsRef.current;
      const hasPendingConfirmation = Boolean(pendingConfirmationRef.current);
      const heard = await listenForSpeechOnce({
        timeoutMs: hasPendingConfirmation ? 16_000 : currentFlags.isPreAuthRoute ? 14_000 : 12_500,
        maxAlternatives: hasPendingConfirmation ? 6 : 4,
        signal: abortController.signal,
      });
      recognitionAbortRef.current = null;
      setVoiceListening(false);

      if (!shouldRunVoiceLoopRef.current) {
        break;
      }

      if (!heard.text.trim() || normalizeText(heard.text).length < 2) {
        noMatchStreakRef.current += 1;
        const noMatchThreshold = currentFlags.isPreAuthRoute ? 2 : 3;
        if (noMatchStreakRef.current >= noMatchThreshold) {
          const dynamicFlags = routeFlagsRef.current;
          const retryMessage = dynamicFlags.isPreAuthRoute
            ? dynamicFlags.isRegisterRoute
              ? "ยังฟังไม่ชัด ลองพูดช้าๆ ว่า สมัครสมาชิก หรือ เข้าสู่ระบบ"
              : "ยังฟังไม่ชัด ลองพูดช้าๆ ว่า เข้าสู่ระบบ หรือ สมัครสมาชิก"
            : "ยังฟังไม่ชัด ลองพูดสั้นๆ เช่น สแกนยา สแกนความดัน นัดแพทย์ แชทแพทย์ หรือ ดูการแจ้งเตือนล่าสุด";
          setVoiceStatusText(retryMessage);
          speakGuidanceWithCooldown(retryMessage, 4500);
          noMatchStreakRef.current = 0;
        }
        continue;
      }

      noMatchStreakRef.current = 0;
      await handleHeardSpeech(heard.text);
    }
  }, [handleHeardSpeech, speakGuidanceWithCooldown, speakFeedback]);

  const startVoiceMode = useCallback((options?: StartVoiceModeOptions) => {
    if (options?.forceEnableVoice && !voiceEnabledRef.current) {
      voiceEnabledRef.current = true;
      setPrefs((previous) => ({ ...previous, voiceEnabled: true }));
    }

    if (shouldRunVoiceLoopRef.current) {
      setVoiceStatusText("โหมดเสียงกำลังทำงานอยู่");
      speakFeedback("โหมดเสียงกำลังทำงานอยู่", true);
      return;
    }

    warmupSpeechSynthesis();
    shouldRunVoiceLoopRef.current = true;
    setVoiceModeEnabled(true);
    const currentFlags = routeFlagsRef.current;
    const startMessage = currentFlags.isPreAuthRoute
      ? currentFlags.isRegisterRoute
        ? "เริ่มโหมดใช้งานด้วยเสียงแล้ว พูดได้เลย เช่น สมัครสมาชิก หรือ วิธีสมัครสมาชิก"
        : "เริ่มโหมดใช้งานด้วยเสียงแล้ว พูดได้เลย เช่น เข้าสู่ระบบ หรือ วิธีเข้าสู่ระบบ"
      : "เริ่มโหมดใช้งานด้วยเสียงแล้ว พูดได้เลย เช่น สแกนยา สแกนความดัน นัดแพทย์ แชทแพทย์ หรือ ดูการแจ้งเตือนล่าสุด";
    setVoiceStatusText(startMessage);
    speakFeedback(startMessage, true);
    window.setTimeout(() => {
      void runVoiceLoop();
    }, 0);
  }, [runVoiceLoop, speakFeedback]);

  const stopVoiceMode = useCallback(() => {
    deactivateVoiceMode(false);
  }, [deactivateVoiceMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    voiceEnabledRef.current = prefs.voiceEnabled;
  }, [prefs.voiceEnabled]);

  useEffect(() => {
    routeFlagsRef.current = {
      isHomeRoute,
      isLoginRoute,
      isRegisterRoute,
      isPreAuthRoute,
      isPatientRoute,
    };
  }, [isHomeRoute, isLoginRoute, isRegisterRoute, isPreAuthRoute, isPatientRoute]);

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

    const handleStartEvent = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as VoiceStartEventDetail | undefined)
          : undefined;
      startVoiceMode({ forceEnableVoice: detail?.forceEnableVoice });
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
        startVoiceMode({ forceEnableVoice: true });
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

  if (!showAssistantUi) {
    return null;
  }

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
              {showVoiceModeControlsInAssistant ? (
                <>
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
                </>
              ) : null}

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

