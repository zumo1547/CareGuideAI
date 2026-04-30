import type { BmiTrend } from "@/lib/onboarding";

export type BloodPressureCategory =
  | "normal"
  | "elevated"
  | "high_stage_1"
  | "high_stage_2"
  | "hypertensive_crisis";

export type ReadingSource =
  | "labeled"
  | "ratio"
  | "line_pair"
  | "triple"
  | "pair";

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

const AMBIGUOUS_DIGIT_MAP: Record<string, string> = {
  O: "0",
  o: "0",
  D: "0",
  Q: "0",
  I: "1",
  l: "1",
  "|": "1",
  Z: "2",
  z: "2",
  A: "4",
  S: "5",
  s: "5",
  B: "8",
  G: "6",
  q: "9",
  g: "9",
};

const hasPlausiblePair = (systolic: number, diastolic: number) =>
  systolic > diastolic && systolic - diastolic >= 8 && systolic - diastolic <= 130;

const normalizeNumericToken = (raw: string) => {
  const token = raw.replace(/[๐-๙]/g, (digit) => THAI_DIGIT_MAP[digit] ?? digit);
  return token
    .split("")
    .map((char) => AMBIGUOUS_DIGIT_MAP[char] ?? char)
    .join("")
    .replace(/[^\d]/g, "");
};

const parseRawDigits = (raw: string | undefined) => {
  if (!raw) return null;
  const normalized = normalizeNumericToken(raw);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parsePulse = (raw: string | undefined) => {
  const parsed = parseRawDigits(raw);
  if (parsed === null) return null;
  return parsed >= PULSE_MIN && parsed <= PULSE_MAX ? parsed : null;
};

const expandSystolicCandidates = (value: number | null) => {
  if (value === null) return [] as Array<{ value: number; penalty: number }>;
  const candidates = [{ value, penalty: 0 }];
  if (value >= 10 && value <= 99) {
    candidates.push({ value: value + 100, penalty: 0.08 });
  }
  return candidates.filter((candidate) => candidate.value >= SYS_MIN && candidate.value <= SYS_MAX);
};

const expandDiastolicCandidates = (value: number | null) => {
  if (value === null) return [] as Array<{ value: number; penalty: number }>;
  const candidates = [{ value, penalty: 0 }];
  if (value >= 10 && value <= 39) {
    candidates.push({ value: value + 40, penalty: 0.09 });
    candidates.push({ value: value + 50, penalty: 0.11 });
    candidates.push({ value: value + 60, penalty: 0.13 });
  }
  return candidates.filter((candidate) => candidate.value >= DIA_MIN && candidate.value <= DIA_MAX);
};

const resolvePair = (rawSys: string | undefined, rawDia: string | undefined) => {
  const sysRaw = parseRawDigits(rawSys);
  const diaRaw = parseRawDigits(rawDia);
  if (sysRaw === null || diaRaw === null) return null;

  const sysCandidates = expandSystolicCandidates(sysRaw);
  const diaCandidates = expandDiastolicCandidates(diaRaw);
  let best: { systolic: number; diastolic: number; penalty: number } | null = null;

  for (const sys of sysCandidates) {
    for (const dia of diaCandidates) {
      if (!hasPlausiblePair(sys.value, dia.value)) continue;
      const penalty = sys.penalty + dia.penalty;
      if (!best || penalty < best.penalty) {
        best = {
          systolic: sys.value,
          diastolic: dia.value,
          penalty,
        };
      }
    }
  }

  return best;
};

const normalizeOcrText = (value: string) =>
  value
    .replace(/[๐-๙]/g, (digit) => THAI_DIGIT_MAP[digit] ?? digit)
    .replace(/[|]/g, "/")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

const scoreConfidence = ({
  source,
  adjustmentPenalty,
  pulse,
  normalizedText,
}: {
  source: ReadingSource;
  adjustmentPenalty: number;
  pulse: number | null;
  normalizedText: string;
}) => {
  const sourceBase: Record<ReadingSource, number> = {
    labeled: 0.82,
    ratio: 0.74,
    line_pair: 0.7,
    triple: 0.67,
    pair: 0.62,
  };
  const hasKeywords = /(sys|dia|pulse|mmhg|bp|systolic|diastolic|ค่าบน|ค่าล่าง|ความดัน)/iu.test(
    normalizedText,
  );
  const score =
    sourceBase[source] + (pulse ? 0.05 : 0) + (hasKeywords ? 0.04 : 0) - adjustmentPenalty;
  return Number(clamp(score, 0.35, 0.99).toFixed(2));
};

const parseLabeled = (normalizedText: string) => {
  const patterns: Array<{
    source: ReadingSource;
    regex: RegExp;
    sysIndex: number;
    diaIndex: number;
  }> = [
    {
      source: "labeled",
      regex:
        /(?:sys|sbp|systolic|ค่าบน|ความดันบน|ตัวบน|บน)\D{0,40}([0-9A-Za-z|]{2,4})[\s\S]{0,70}?(?:dia|dbp|diastolic|ค่าล่าง|ความดันล่าง|ตัวล่าง|ล่าง)\D{0,40}([0-9A-Za-z|]{2,4})/iu,
      sysIndex: 1,
      diaIndex: 2,
    },
    {
      source: "labeled",
      regex:
        /(?:dia|dbp|diastolic|ค่าล่าง|ความดันล่าง|ตัวล่าง|ล่าง)\D{0,40}([0-9A-Za-z|]{2,4})[\s\S]{0,70}?(?:sys|sbp|systolic|ค่าบน|ความดันบน|ตัวบน|บน)\D{0,40}([0-9A-Za-z|]{2,4})/iu,
      sysIndex: 2,
      diaIndex: 1,
    },
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern.regex);
    if (!match) continue;
    const resolved = resolvePair(match[pattern.sysIndex], match[pattern.diaIndex]);
    if (!resolved) continue;

    const pulse = parsePulse(
      normalizedText.match(
        /(?:pul|pulse|pr|hr|bpm|ชีพจร|หัวใจ)\D{0,24}([0-9A-Za-z|]{2,4})/iu,
      )?.[1],
    );

    return {
      systolic: resolved.systolic,
      diastolic: resolved.diastolic,
      pulse,
      confidence: scoreConfidence({
        source: pattern.source,
        adjustmentPenalty: resolved.penalty,
        pulse,
        normalizedText,
      }),
      source: pattern.source,
    };
  }

  return null;
};

const parseRatio = (normalizedText: string) => {
  const matches = [...normalizedText.matchAll(/([0-9A-Za-z|]{2,4})\s*(?:\/|\\|-|_|—)\s*([0-9A-Za-z|]{2,4})/g)];
  for (const match of matches) {
    const resolved = resolvePair(match[1], match[2]);
    if (!resolved) continue;

    const pulse =
      parsePulse(
        normalizedText.match(
          /(?:pul|pulse|pr|hr|bpm|ชีพจร|หัวใจ)\D{0,24}([0-9A-Za-z|]{2,4})/iu,
        )?.[1],
      ) ??
      parsePulse(match.input?.slice(match.index + match[0].length).match(/([0-9A-Za-z|]{2,4})/)?.[1]);

    return {
      systolic: resolved.systolic,
      diastolic: resolved.diastolic,
      pulse,
      confidence: scoreConfidence({
        source: "ratio",
        adjustmentPenalty: resolved.penalty,
        pulse,
        normalizedText,
      }),
      source: "ratio" as const,
    };
  }

  return null;
};

const parseByLabelLines = (normalizedText: string) => {
  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const findNearNumber = (startIndex: number) => {
    for (let offset = 0; offset <= 2; offset += 1) {
      const line = lines[startIndex + offset];
      if (!line) continue;
      const match = line.match(/([0-9A-Za-z|]{2,4})/);
      if (match?.[1]) {
        return match[1];
      }
    }
    return undefined;
  };

  let sysToken: string | undefined;
  let diaToken: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!sysToken && /(sys|systolic|sbp|ค่าบน|ตัวบน)/iu.test(line)) {
      sysToken = line.match(/([0-9A-Za-z|]{2,4})/)?.[1] ?? findNearNumber(index);
    }
    if (!diaToken && /(dia|diastolic|dbp|ค่าล่าง|ตัวล่าง)/iu.test(line)) {
      diaToken = line.match(/([0-9A-Za-z|]{2,4})/)?.[1] ?? findNearNumber(index);
    }
  }

  const resolved = resolvePair(sysToken, diaToken);
  if (!resolved) return null;

  const pulse = parsePulse(
    normalizedText.match(/(?:pul|pulse|pr|hr|bpm|ชีพจร|หัวใจ)\D{0,24}([0-9A-Za-z|]{2,4})/iu)?.[1],
  );

  return {
    systolic: resolved.systolic,
    diastolic: resolved.diastolic,
    pulse,
    confidence: scoreConfidence({
      source: "line_pair",
      adjustmentPenalty: resolved.penalty,
      pulse,
      normalizedText,
    }),
    source: "line_pair" as const,
  };
};

const parseFromNumberSequence = (normalizedText: string) => {
  const numbers = [...normalizedText.matchAll(/\b[0-9A-Za-z|]{2,4}\b/g)]
    .map((match) => parseRawDigits(match[0]))
    .filter((value): value is number => Number.isFinite(value))
    .filter((value) => value <= SYS_MAX + 100);

  if (numbers.length < 2) return null;

  const toToken = (value: number) => String(value);

  for (let index = 0; index <= numbers.length - 2; index += 1) {
    const resolved = resolvePair(toToken(numbers[index]), toToken(numbers[index + 1]));
    if (!resolved) continue;

    const third = numbers[index + 2];
    const pulse = third && third >= PULSE_MIN && third <= PULSE_MAX ? third : null;

    return {
      systolic: resolved.systolic,
      diastolic: resolved.diastolic,
      pulse,
      confidence: scoreConfidence({
        source: pulse ? "triple" : "pair",
        adjustmentPenalty: resolved.penalty,
        pulse,
        normalizedText,
      }),
      source: pulse ? ("triple" as const) : ("pair" as const),
    };
  }

  return null;
};

export const parseBloodPressureFromText = (rawText: string): ParsedBloodPressureReading | null => {
  const normalizedText = normalizeOcrText(rawText);
  if (!normalizedText) return null;

  const candidate =
    parseLabeled(normalizedText) ??
    parseRatio(normalizedText) ??
    parseByLabelLines(normalizedText) ??
    parseFromNumberSequence(normalizedText);

  if (!candidate) return null;

  return {
    systolic: candidate.systolic,
    diastolic: candidate.diastolic,
    pulse: candidate.pulse,
    confidence: candidate.confidence,
    source: candidate.source,
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
