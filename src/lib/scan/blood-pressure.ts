import type { BmiTrend } from "@/lib/onboarding";

export type BloodPressureCategory =
  | "normal"
  | "elevated"
  | "high_stage_1"
  | "high_stage_2"
  | "hypertensive_crisis";

export type ReadingSource = "labeled" | "ratio" | "triple" | "pair";

export interface ParsedBloodPressureReading {
  systolic: number;
  diastolic: number;
  pulse: number | null;
  confidence: number;
  source: ReadingSource;
  rawText: string;
  normalizedText: string;
}

export interface BloodPressureAssessment {
  category: BloodPressureCategory;
  categoryLabelTh: string;
  levelColorClass: string;
  summaryTh: string;
  actionTh: string;
}

const SYS_MIN = 70;
const SYS_MAX = 260;
const DIA_MIN = 40;
const DIA_MAX = 160;
const PULSE_MIN = 35;
const PULSE_MAX = 220;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const THAI_DIGIT_MAP: Record<string, string> = {
  "๐": "0",
  "๑": "1",
  "๒": "2",
  "๓": "3",
  "๔": "4",
  "๕": "5",
  "๖": "6",
  "๗": "7",
  "๘": "8",
  "๙": "9",
};

const normalizeDigits = (value: string) =>
  value
    .replace(/[๐-๙]/g, (digit) => THAI_DIGIT_MAP[digit] ?? digit)
    .replace(/(?<=\d)[oO](?=\d)/g, "0")
    .replace(/(?<=\d)[lI](?=\d)/g, "1")
    .replace(/(?<=\d)s(?=\d)/gi, "5");

const normalizeOcrText = (value: string) =>
  normalizeDigits(value)
    .replace(/[|]/g, "/")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

const parseInRange = (value: string | undefined, min: number, max: number) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= min && rounded <= max ? rounded : null;
};

const hasPlausiblePair = (systolic: number, diastolic: number) =>
  systolic > diastolic && systolic - diastolic >= 8 && systolic - diastolic <= 130;

const parseLabeled = (normalizedText: string) => {
  const systolic =
    parseInRange(
      normalizedText.match(
        /(?:sys|sbp|systolic|ค่าบน|ความดันบน|ตัวบน|บน)\D{0,10}(\d{2,3})/iu,
      )?.[1],
      SYS_MIN,
      SYS_MAX,
    ) ??
    parseInRange(normalizedText.match(/(?:bp|b\/p)\D{0,8}(\d{2,3})/iu)?.[1], SYS_MIN, SYS_MAX);

  const diastolic = parseInRange(
    normalizedText.match(
      /(?:dia|dbp|diastolic|ค่าล่าง|ความดันล่าง|ตัวล่าง|ล่าง)\D{0,10}(\d{2,3})/iu,
    )?.[1],
    DIA_MIN,
    DIA_MAX,
  );

  if (!systolic || !diastolic || !hasPlausiblePair(systolic, diastolic)) {
    return null;
  }

  const pulse = parseInRange(
    normalizedText.match(/(?:pul|pulse|pr|hr|bpm|ชีพจร|หัวใจ)\D{0,10}(\d{2,3})/iu)?.[1],
    PULSE_MIN,
    PULSE_MAX,
  );

  const hasKeyword = /(mmhg|sys|dia|systolic|diastolic|ความดัน|ชีพจร|pulse|bpm)/iu.test(
    normalizedText,
  );

  const confidence = clamp(0.7 + (pulse ? 0.08 : 0) + (hasKeyword ? 0.08 : 0), 0.45, 0.99);
  return { systolic, diastolic, pulse, confidence, source: "labeled" as const };
};

const parseRatio = (normalizedText: string) => {
  const ratioMatches = [...normalizedText.matchAll(/(\d{2,3})\s*(?:\/|\\|-)\s*(\d{2,3})/g)];
  for (const match of ratioMatches) {
    const systolic = parseInRange(match[1], SYS_MIN, SYS_MAX);
    const diastolic = parseInRange(match[2], DIA_MIN, DIA_MAX);
    if (!systolic || !diastolic || !hasPlausiblePair(systolic, diastolic)) continue;

    const pulse =
      parseInRange(
        normalizedText.match(/(?:pul|pulse|pr|hr|bpm|ชีพจร|หัวใจ)\D{0,10}(\d{2,3})/iu)?.[1],
        PULSE_MIN,
        PULSE_MAX,
      ) ??
      parseInRange(match.input?.slice(match.index + match[0].length).match(/(\d{2,3})/)?.[1], PULSE_MIN, PULSE_MAX);

    const confidence = clamp(0.62 + (pulse ? 0.06 : 0), 0.4, 0.95);
    return { systolic, diastolic, pulse, confidence, source: "ratio" as const };
  }
  return null;
};

const parseFromNumberSequence = (normalizedText: string) => {
  const numbers = [...normalizedText.matchAll(/\b\d{2,3}\b/g)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value <= SYS_MAX);

  if (numbers.length < 2) return null;

  for (let index = 0; index <= numbers.length - 2; index += 1) {
    const systolicCandidate = numbers[index];
    const diastolicCandidate = numbers[index + 1];
    if (
      systolicCandidate < SYS_MIN ||
      systolicCandidate > SYS_MAX ||
      diastolicCandidate < DIA_MIN ||
      diastolicCandidate > DIA_MAX ||
      !hasPlausiblePair(systolicCandidate, diastolicCandidate)
    ) {
      continue;
    }

    const pulseCandidate = numbers[index + 2];
    const pulse =
      pulseCandidate && pulseCandidate >= PULSE_MIN && pulseCandidate <= PULSE_MAX
        ? pulseCandidate
        : null;
    const confidence = clamp(pulse ? 0.58 : 0.53, 0.38, 0.9);

    return {
      systolic: systolicCandidate,
      diastolic: diastolicCandidate,
      pulse,
      confidence,
      source: pulse ? ("triple" as const) : ("pair" as const),
    };
  }

  return null;
};

export const parseBloodPressureFromText = (
  rawText: string,
): ParsedBloodPressureReading | null => {
  const normalizedText = normalizeOcrText(rawText);
  if (!normalizedText) return null;

  const candidate =
    parseLabeled(normalizedText) ??
    parseRatio(normalizedText) ??
    parseFromNumberSequence(normalizedText);
  if (!candidate) return null;

  return {
    ...candidate,
    rawText,
    normalizedText,
  };
};

export const assessBloodPressure = (
  systolic: number,
  diastolic: number,
): BloodPressureAssessment => {
  if (systolic >= 180 || diastolic >= 120) {
    return {
      category: "hypertensive_crisis",
      categoryLabelTh: "วิกฤตความดันสูง",
      levelColorClass: "text-red-700",
      summaryTh: "ความดันสูงอันตรายมากกว่าปกติ",
      actionTh: "ควรวัดซ้ำทันที และติดต่อบุคลากรทางการแพทย์โดยเร็ว",
    };
  }

  if (systolic >= 140 || diastolic >= 90) {
    return {
      category: "high_stage_2",
      categoryLabelTh: "ความดันสูง ระดับ 2",
      levelColorClass: "text-orange-700",
      summaryTh: "มีแนวโน้มความดันสูงชัดเจน",
      actionTh: "ควรติดตามต่อเนื่องและปรึกษาแพทย์เรื่องการควบคุมความดัน",
    };
  }

  if (systolic >= 130 || diastolic >= 80) {
    return {
      category: "high_stage_1",
      categoryLabelTh: "ความดันสูง ระดับ 1",
      levelColorClass: "text-amber-700",
      summaryTh: "เริ่มมีแนวโน้มความดันสูง",
      actionTh: "ควรลดปัจจัยเสี่ยง เช่น เค็มจัด น้ำหนักเกิน และพักผ่อนไม่พอ",
    };
  }

  if (systolic >= 120 && diastolic < 80) {
    return {
      category: "elevated",
      categoryLabelTh: "สูงกว่าปกติ",
      levelColorClass: "text-yellow-700",
      summaryTh: "ความดันเริ่มสูงกว่าปกติเล็กน้อย",
      actionTh: "ควรติดตามความดันสม่ำเสมอและดูแลพฤติกรรมสุขภาพ",
    };
  }

  return {
    category: "normal",
    categoryLabelTh: "อยู่ในเกณฑ์ปกติ",
    levelColorClass: "text-emerald-700",
    summaryTh: "ความดันอยู่ในช่วงที่ดี",
    actionTh: "รักษาพฤติกรรมการกินยาและการดูแลสุขภาพต่อเนื่อง",
  };
};

export const buildBmiLinkedBloodPressureSummary = (
  assessment: BloodPressureAssessment,
  bmiTrend: BmiTrend | null,
) => {
  if (!bmiTrend) {
    return assessment.summaryTh;
  }

  const bmiRiskHigh =
    bmiTrend.band === "obesity_level_2" ||
    bmiTrend.band === "obesity_level_3" ||
    bmiTrend.band === "overweight_level_1";

  if (bmiRiskHigh && assessment.category !== "normal") {
    return `${assessment.summaryTh} และจาก BMI (${bmiTrend.bmi.toFixed(2)}) มีแนวโน้มเสี่ยงความดันสูงเพิ่มขึ้น`;
  }

  if (!bmiRiskHigh && assessment.category === "normal") {
    return `${assessment.summaryTh} โดยแนวโน้ม BMI ปัจจุบันยังสนับสนุนความเสี่ยงต่ำ`;
  }

  return `${assessment.summaryTh} | แนวโน้มจาก BMI: ${bmiTrend.bloodPressureTrendLabel}`;
};

export const buildBloodPressureSpeech = ({
  reading,
  assessment,
  bmiTrend,
}: {
  reading: ParsedBloodPressureReading;
  assessment: BloodPressureAssessment;
  bmiTrend: BmiTrend | null;
}) => {
  const pulsePart = reading.pulse ? ` ชีพจร ${reading.pulse} ครั้งต่อนาที` : "";
  const bmiPart = bmiTrend
    ? ` BMI ล่าสุด ${bmiTrend.bmi.toFixed(1)} แนวโน้ม ${bmiTrend.bloodPressureTrendLabel}`
    : "";
  return `วัดได้ ${reading.systolic} ต่อ ${reading.diastolic}${pulsePart} ระดับ ${assessment.categoryLabelTh} ${assessment.actionTh} ${bmiPart}`.trim();
};
