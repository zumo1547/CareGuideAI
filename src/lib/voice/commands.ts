"use client";

export type VoiceIntent =
  | {
      type: "navigate";
      sectionId: "medicine" | "appointment" | "chat" | "blood-pressure";
      label: string;
      requiresConfirmation: boolean;
    }
  | {
      type: "action";
      actionId:
        | "start-med-camera-scan"
        | "confirm-med-plan"
        | "send-chat-message"
        | "send-support-request"
        | "send-appointment-request"
        | "accept-appointment"
        | "decline-appointment"
        | "reschedule-appointment";
      label: string;
      requiresConfirmation: boolean;
      repeatText?: string;
    };

const stripNoise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeSpeechText = stripNoise;

const includesAny = (text: string, keywords: string[]) => keywords.some((keyword) => text.includes(keyword));

export const isAffirmativeSpeech = (text: string) =>
  includesAny(stripNoise(text), ["ใช่", "ยืนยัน", "ตกลง", "โอเค", "ถูกต้อง", "ได้"]);

export const isNegativeSpeech = (text: string) =>
  includesAny(stripNoise(text), ["ไม่", "ยกเลิก", "หยุด", "ไม่ใช่", "ไม่เอา"]);

export const isRepeatSpeech = (text: string) =>
  includesAny(stripNoise(text), ["ทบทวน", "ทวน", "พูดอีกครั้ง", "อีกครั้ง", "repeat"]);

export const isMedicationTakenSpeech = (text: string) =>
  includesAny(stripNoise(text), ["กินแล้ว", "ทานแล้ว", "รับประทานแล้ว", "เรียบร้อย", "กินยาแล้ว"]);

export const isMedicationSnoozeSpeech = (text: string) =>
  includesAny(stripNoise(text), [
    "ยังไม่ได้กิน",
    "ยังไม่กิน",
    "ขอเตือนอีกที",
    "เตือนอีกครั้ง",
    "เดี๋ยวก่อน",
  ]);

export const parseVoiceIntent = (rawText: string): VoiceIntent | null => {
  const text = stripNoise(rawText);
  if (!text) return null;

  if (
    includesAny(text, ["ส่งข้อความหาหมอ", "ส่งข้อความถึงหมอ", "ส่งแชทหาหมอ", "ส่งข้อความ"]) &&
    !includesAny(text, ["คำขอ", "ร้องขอ"])
  ) {
    return {
      type: "action",
      actionId: "send-chat-message",
      label: "ส่งข้อความถึงคุณหมอ",
      requiresConfirmation: true,
      repeatText: "ต้องการส่งข้อความนี้ใช่ไหม",
    };
  }

  if (includesAny(text, ["ส่งคำร้อง", "ร้องขอความช่วยเหลือ", "เปิดเคสช่วยเหลือ"])) {
    return {
      type: "action",
      actionId: "send-support-request",
      label: "ส่งคำร้องขอความช่วยเหลือถึงคุณหมอ",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["ยืนยันผลสแกนยา", "ยืนยันยา", "ยืนยันผลยา"])) {
    return {
      type: "action",
      actionId: "confirm-med-plan",
      label: "ยืนยันผลยาและบันทึกแผนยา",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["เริ่มสแกนยา", "เปิดกล้องสแกนยา", "สแกนยาด้วยกล้อง"])) {
    return {
      type: "action",
      actionId: "start-med-camera-scan",
      label: "เริ่มสแกนยาด้วยกล้อง",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["ส่งคำขอนัด", "ส่งนัดหมอ", "นัดหมอ"])) {
    return {
      type: "action",
      actionId: "send-appointment-request",
      label: "ส่งคำขอนัดหมายถึงคุณหมอ",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["ยืนยันนัด", "รับนัด"])) {
    return {
      type: "action",
      actionId: "accept-appointment",
      label: "ยืนยันรับนัดหมาย",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["ปฏิเสธนัด", "ยกเลิกนัด"])) {
    return {
      type: "action",
      actionId: "decline-appointment",
      label: "ปฏิเสธนัดหมาย",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["ขอเลื่อนนัด", "เลื่อนนัด"])) {
    return {
      type: "action",
      actionId: "reschedule-appointment",
      label: "ส่งคำขอเลื่อนนัดหมาย",
      requiresConfirmation: true,
    };
  }

  if (includesAny(text, ["แชทหมอ", "คุยหมอ", "หน้าคุยหมอ"])) {
    return {
      type: "navigate",
      sectionId: "chat",
      label: "ไปส่วนแชทกับคุณหมอ",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["นัดหมอ", "ไปหน้านัดหมอ", "หน้าการนัดหมาย"])) {
    return {
      type: "navigate",
      sectionId: "appointment",
      label: "ไปส่วนนัดหมายแพทย์",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["สแกนยา", "ไปหน้าสแกนยา"])) {
    return {
      type: "navigate",
      sectionId: "medicine",
      label: "ไปส่วนสแกนยา",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["สแกนความดัน", "วัดความดัน", "หน้าความดัน"])) {
    return {
      type: "navigate",
      sectionId: "blood-pressure",
      label: "ไปส่วนสแกนความดัน",
      requiresConfirmation: false,
    };
  }

  return null;
};
