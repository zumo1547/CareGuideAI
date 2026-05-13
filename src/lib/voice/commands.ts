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
        | "start-bp-camera-scan"
        | "confirm-med-plan"
        | "read-latest-reminders"
        | "send-chat-message"
        | "send-support-request"
        | "send-appointment-request"
        | "voice-compose-support-request"
        | "voice-compose-appointment-request"
        | "accept-appointment"
        | "decline-appointment"
        | "reschedule-appointment"
        | "submit-login"
        | "go-register"
        | "submit-register"
        | "go-login"
        | "describe-login-fields"
        | "describe-register-fields"
        | "go-patient-dashboard"
        | "go-medicine-scan-page"
        | "go-bp-scan-page"
        | "go-profile-page";
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

const normalizeIntentText = (value: string) => {
  let text = stripNoise(value);

  const replacements: Array<[RegExp, string]> = [
    [/\blog\s*in\b/gu, " login "],
    [/\bsign\s*in\b/gu, " login "],
    [/\bregister\b/gu, " register "],
    [/\bsign\s*up\b/gu, " register "],
    [/\bcreate\s*account\b/gu, " register "],
    [/ล๊อกอิน|ล็อคอิน|ลอกอิน|ล้อกอิน|ล็อกอืน|ล็อกอินน์/gu, "ล็อกอิน"],
    [/ไซน์อิน|ซายอิน|ซายนอิน|ไซนอืน|ไซน์ in/gu, "login"],
    [/ไซน์อัพ|ซายอัพ|ซายนอัพ|สมัครแอคเคาท์/gu, "register"],
    [/เขาสู่ระบบ|เข้า\s*สู่\s*ระบบ|เข้า\s*ระบบ|เข้าระบบ|เขา\s*ระบบ|เข้าสู่ระบม|เขาสู่ระบม/gu, "เข้าสู่ระบบ"],
    [/สมัครสมาชิค|สมัครสมาชีก|สมัครสมาขิก|สมัครสมาขี/gu, "สมัครสมาชิก"],
    [/ลงทะเบีน|ลงทะเบียน|ลงทะเบียน/gu, "ลงทะเบียน"],
    [/แสกน|สแกรน|สะแกน|สแกน/gu, "สแกน"],
    [/แจ้งเดือน|แจ้งเดอน|แจงเดอน|แจงเดือน|แจ้งเตอืน|แจงเตอน/gu, "แจ้งเตือน"],
    [/ล้าสุด|ลาสุด|ล่าสุดๆ|ล่ะสุด/gu, "ล่าสุด"],
    [/แฟ้มข้อมูล|แฟ้ม|โปรไฟล์|โพรไฟล์/gu, "แฟ้มข้อมูล"],
    [/แดชบอร์ด|หน้าหลัก|หน้าแรก/gu, "แดชบอร์ด"],
    [/แช็ต|แชท|chat/gu, "แชท"],
    [/นัดหมาย|นัดหมอ|นัดแพทย์|นัดคุณหมอ/gu, "นัดหมอ"],
    [/ความดันโลหิต|วัดความดัน|เช็คความดัน|ความดัน/gu, "สแกนความดัน"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return stripNoise(text);
};

export const normalizeSpeechText = stripNoise;

const includesAny = (text: string, keywords: string[]) => {
  const normalizedText = stripNoise(text);
  return keywords.some((keyword) => normalizedText.includes(stripNoise(keyword)));
};

const normalizeConfirmationSpeech = (value: string) =>
  stripNoise(value)
    .replace(/ไช่|ใช่ๆ|ช่าย|ใช่จ้า|ใช่ครับ|ใช่ค่ะ|ใช้|ใช/gu, "ใช่")
    .replace(/โอเค|โอเคครับ|โอเคค่ะ|โอเคคับ|โอเคคะ/gu, "โอเค")
    .replace(/ยืนยันเลย|ยืนยันได้เลย|ตกลงครับ|ตกลงค่ะ/gu, "ยืนยัน")
    .replace(/ไม่ใช่|ไม่โอเค|ไม่เอา|ไม่ครับ|ไม่ค่ะ|โน|no/gu, "ไม่")
    .replace(/ทบทวนอีกครั้ง|ทวนอีกครั้ง|ทวนอีกที|พูดอีกครั้ง|พูดใหม่|ขออีกที|ขอทวน|ทวน/gu, "ทบทวน")
    .replace(/\s+/gu, " ")
    .trim();

export const isAffirmativeSpeech = (text: string) =>
  includesAny(normalizeConfirmationSpeech(text), [
    "ใช่",
    "ยืนยัน",
    "ตกลง",
    "โอเค",
    "ถูกต้อง",
    "ได้",
    "ไปต่อ",
    "ส่งเลย",
    "เริ่มเลย",
    "ยอมรับ",
    "ครับ",
    "ค่ะ",
    "จ้า",
    "ฮะ",
  ]);

export const isNegativeSpeech = (text: string) =>
  includesAny(normalizeConfirmationSpeech(text), [
    "ไม่",
    "ยกเลิก",
    "หยุด",
    "ไม่เอา",
    "ไม่ต้อง",
    "ปฏิเสธ",
    "ยกเลิกไป",
  ]);

export const isRepeatSpeech = (text: string) =>
  includesAny(normalizeConfirmationSpeech(text), [
    "ทบทวน",
    "พูดอีกครั้ง",
    "อีกครั้ง",
    "repeat",
    "ขอใหม่",
    "อ่านใหม่",
    "ไม่ทัน",
    "ทวนคำสั่ง",
  ]);

export const isVoiceModeStopSpeech = (text: string) =>
  includesAny(stripNoise(text), [
    "ปิดการใช้งาน",
    "ปิดโหมดเสียง",
    "หยุดโหมดเสียง",
    "หยุดฟังเสียง",
    "ปิดผู้ช่วยเสียง",
    "ปิดไมค์",
    "ปิดไมโครโฟน",
    "หยุดฟัง",
  ]);

export const isMedicationTakenSpeech = (text: string) =>
  includesAny(stripNoise(text), [
    "กินแล้ว",
    "กินยาแล้ว",
    "ทานแล้ว",
    "ทานยาแล้ว",
    "รับประทานแล้ว",
    "รับประทานยาแล้ว",
    "เรียบร้อย",
    "เรียบร้อยแล้ว",
    "กินเสร็จแล้ว",
    "ทานเสร็จแล้ว",
  ]);

export const isMedicationSnoozeSpeech = (text: string) =>
  includesAny(stripNoise(text), [
    "ยังไม่ได้กิน",
    "ยังไม่กิน",
    "ยังไม่ได้ทาน",
    "ยังไม่ทาน",
    "ยังไม่กินยา",
    "ยังไม่ทานยา",
    "ขอเตือนอีกที",
    "เตือนอีกครั้ง",
    "เตือนใหม่",
    "ค่อยแจ้งเตือน",
    "ค่อยเตือน",
    "ค่อยแจ้ง",
    "เตือนภายหลัง",
    "เตือนทีหลัง",
    "ไว้ก่อน",
    "เดี๋ยวก่อน",
  ]);

export const parseVoiceIntent = (rawText: string): VoiceIntent | null => {
  const text = normalizeIntentText(rawText);
  if (!text) return null;

  const looksLikeLoginCommand =
    includesAny(text, ["เข้าสู่ระบบ", "ล็อกอิน", "login", "sign in"]) ||
    (includesAny(text, ["เข้า", "เขา"]) && includesAny(text, ["ระบบ", "ระบม"]));

  const looksLikeRegisterCommand =
    includesAny(text, ["สมัครสมาชิก", "ลงทะเบียน", "register", "sign up", "create account"]) ||
    (includesAny(text, ["สมัคร", "ลงทะเบียน"]) && includesAny(text, ["สมาชิก", "บัญชี", "account"]));

  if (includesAny(text, ["วิธีเข้าสู่ระบบ", "ล็อกอินยังไง", "ต้องกรอกอะไรเข้าสู่ระบบ"])) {
    return {
      type: "action",
      actionId: "describe-login-fields",
      label: "ฟังวิธีกรอกข้อมูลเข้าสู่ระบบ",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["วิธีสมัครสมาชิก", "สมัครยังไง", "ต้องกรอกอะไรบ้าง", "กรอกอะไรบ้าง"])) {
    return {
      type: "action",
      actionId: "describe-register-fields",
      label: "ฟังวิธีกรอกข้อมูลสมัครสมาชิก",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["ไปหน้าสมัครสมาชิก", "เปิดหน้าสมัครสมาชิก", "ไปหน้าสมัคร"])) {
    return {
      type: "action",
      actionId: "go-register",
      label: "ไปหน้าสมัครสมาชิก",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["ไปหน้าเข้าสู่ระบบ", "เปิดหน้าเข้าสู่ระบบ", "ไปหน้า login"])) {
    return {
      type: "action",
      actionId: "go-login",
      label: "ไปหน้าเข้าสู่ระบบ",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "ไปหน้าแดชบอร์ด",
      "เข้าแดชบอร์ด",
      "กลับหน้าแดชบอร์ด",
      "ไปหน้าหลัก",
      "กลับหน้าหลัก",
      "ไปหน้าแรก",
      "แดชบอร์ดผู้พิการ",
    ])
  ) {
    return {
      type: "action",
      actionId: "go-patient-dashboard",
      label: "ไปหน้าแดชบอร์ดผู้พิการ",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "ไปหน้าแฟ้มข้อมูล",
      "เปิดแฟ้มข้อมูล",
      "ไปโปรไฟล์",
      "ไปหน้าโปรไฟล์",
      "แฟ้มข้อมูลของฉัน",
    ])
  ) {
    return {
      type: "action",
      actionId: "go-profile-page",
      label: "ไปหน้าแฟ้มข้อมูลของฉัน",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "ไปหน้าสแกนยา",
      "เปิดหน้าสแกนยา",
      "ไปสแกนยา",
      "เปิดสแกนยา",
      "หน้า สแกนยา",
    ])
  ) {
    return {
      type: "action",
      actionId: "go-medicine-scan-page",
      label: "ไปหน้าสแกนยา",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "ไปหน้าสแกนความดัน",
      "เปิดหน้าสแกนความดัน",
      "ไปสแกนความดัน",
      "เปิดสแกนความดัน",
      "ไปหน้าวัดความดัน",
      "เปิดหน้าวัดความดัน",
    ])
  ) {
    return {
      type: "action",
      actionId: "go-bp-scan-page",
      label: "ไปหน้าสแกนความดัน",
      requiresConfirmation: false,
    };
  }

  if (looksLikeRegisterCommand || includesAny(text, ["สร้างบัญชี"])) {
    return {
      type: "action",
      actionId: "submit-register",
      label: "กดปุ่มสมัครสมาชิก",
      requiresConfirmation: true,
      repeatText: "ต้องการสมัครสมาชิกใช่ไหม",
    };
  }

  if (looksLikeLoginCommand) {
    return {
      type: "action",
      actionId: "submit-login",
      label: "กดปุ่มเข้าสู่ระบบ",
      requiresConfirmation: true,
      repeatText: "ต้องการเข้าสู่ระบบใช่ไหม",
    };
  }

  if (
    includesAny(text, ["ส่งข้อความหาแพทย์", "ส่งข้อความถึงแพทย์", "ส่งแชทหาแพทย์", "ส่งข้อความหาหมอ", "ส่งข้อความถึงหมอ", "ส่งแชทหาหมอ", "ส่งข้อความ"]) &&
    !includesAny(text, ["คำขอ", "ร้องขอ"])
  ) {
    return {
      type: "action",
      actionId: "send-chat-message",
      label: "ส่งข้อความถึงแพทย์",
      requiresConfirmation: true,
      repeatText: "ต้องการส่งข้อความนี้ใช่ไหม",
    };
  }

  if (includesAny(text, ["ส่งคำร้อง", "ร้องขอความช่วยเหลือ", "เปิดเคสช่วยเหลือ"])) {
    return {
      type: "action",
      actionId: "send-support-request",
      label: "ส่งคำร้องขอความช่วยเหลือถึงแพทย์",
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

  if (
    includesAny(text, [
      "ดูการแจ้งเตือนล่าสุด",
      "ไปดูการแจ้งเตือนล่าสุด",
      "ดูแจ้งเตือนล่าสุด",
      "อ่านแจ้งเตือนล่าสุด",
      "อ่านรายการแจ้งเตือนล่าสุด",
      "รายการแจ้งเตือนล่าสุด",
      "ดูเตือนล่าสุด",
      "อ่านการแจ้งเตือนล่าสุด",
      "อ่านตารางยา",
      "ดูตารางยา",
      "อ่านตารางยาและการแจ้งเตือนล่าสุด",
      "สรุปการแจ้งเตือนล่าสุด",
      "อ่านยาและแจ้งเตือนล่าสุด",
    ])
  ) {
    return {
      type: "action",
      actionId: "read-latest-reminders",
      label: "อ่านตารางยาและการแจ้งเตือนล่าสุด",
      requiresConfirmation: false,
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

  if (includesAny(text, ["เริ่มสแกนความดันด้วยกล้อง", "เปิดกล้องสแกนความดัน", "สแกนความดันด้วยกล้อง"])) {
    return {
      type: "action",
      actionId: "start-bp-camera-scan",
      label: "เริ่มสแกนความดันด้วยกล้อง",
      requiresConfirmation: true,
    };
  }

  if (
    includesAny(text, [
      "ส่งคำขอนัด",
      "ส่งนัดหมอ",
      "ส่งนัดแพทย์",
      "ส่งคำนัด",
      "ขอส่งนัด",
      "ส่งคำขอนัดหมาย",
      "ส่งคำขอนัดแพทย์",
    ])
  ) {
    return {
      type: "action",
      actionId: "send-appointment-request",
      label: "ส่งคำขอนัดหมายถึงแพทย์",
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

  if (includesAny(text, ["ร้องขอแพทย์ด้วยเสียง", "ร้องขอหมอด้วยเสียง", "ขอความช่วยเหลือด้วยเสียง", "ส่งคำร้องด้วยเสียง"])) {
    return {
      type: "action",
      actionId: "voice-compose-support-request",
      label: "เริ่มส่งคำร้องหาแพทย์ด้วยเสียง",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["นัดแพทย์ด้วยเสียง", "นัดหมอด้วยเสียง", "ส่งนัดด้วยเสียง", "ส่งคำขอนัดด้วยเสียง"])) {
    return {
      type: "action",
      actionId: "voice-compose-appointment-request",
      label: "เริ่มส่งคำขอนัดหมายด้วยเสียง",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "แชทหมอ",
      "แชทแพทย์",
      "คุยหมอ",
      "คุยแพทย์",
      "หน้าคุยหมอ",
      "หน้าคุยแพทย์",
      "คุยกับหมอ",
      "คุยกับแพทย์",
      "คุยกับคุณหมอ",
      "คุยกับคุณแพทย์",
      "แชทกับหมอ",
      "แชทกับแพทย์",
      "แชทคุณหมอ",
      "แชทแพทย์",
    ])
  ) {
    return {
      type: "navigate",
      sectionId: "chat",
      label: "ไปส่วนแชทกับแพทย์",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "นัดหมอ",
      "นัดแพทย์",
      "ไปหน้านัดหมอ",
      "ไปหน้านัดแพทย์",
      "หน้าการนัดหมาย",
      "เปิดหน้านัดหมอ",
      "เปิดหน้านัดแพทย์",
      "นัดหมายแพทย์",
      "ไปหน้านัดหมาย",
    ])
  ) {
    return {
      type: "navigate",
      sectionId: "appointment",
      label: "ไปส่วนนัดหมายแพทย์",
      requiresConfirmation: false,
    };
  }

  if (includesAny(text, ["สแกนยา", "ไปหน้าสแกนยา", "เปิดสแกนยา"])) {
    return {
      type: "navigate",
      sectionId: "medicine",
      label: "ไปส่วนสแกนยา",
      requiresConfirmation: false,
    };
  }

  if (
    includesAny(text, [
      "สแกนความดัน",
      "วัดความดัน",
      "หน้าความดัน",
      "เช็คความดัน",
      "วัดค่าความดัน",
      "สแกนค่าเลือดดัน",
    ])
  ) {
    return {
      type: "navigate",
      sectionId: "blood-pressure",
      label: "ไปส่วนสแกนความดัน",
      requiresConfirmation: false,
    };
  }

  return null;
};
