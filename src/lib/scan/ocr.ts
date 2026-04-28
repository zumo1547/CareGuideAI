export type MealTiming = "before_meal" | "after_meal" | "unspecified";
export type DayPeriod = "morning" | "noon" | "evening" | "night";

export interface ParsedMedicationDetails {
  medicineQuery: string;
  medicineNameEn: string | null;
  medicineNameTh: string | null;
  dosageText: string;
  quantityPerDose: string | null;
  frequencyPerDay: number | null;
  mealTiming: MealTiming;
  periods: DayPeriod[];
  customTimes: string[];
  confidence: number;
  rawText: string;
}

const INSTRUCTION_SKIP_PATTERNS = [
  /รับประทาน/,
  /วันละ/,
  /ครั้งละ/,
  /ก่อนอาหาร/,
  /หลังอาหาร/,
  /เช้า/,
  /กลางวัน/,
  /เที่ยง/,
  /เย็น/,
  /ก่อนนอน/,
  /โรงพยาบาล/,
  /hn\b/i,
  /opd\b/i,
  /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/,
];

const cleanLine = (line: string) =>
  line
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[|`~^*_=+<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeText = (text: string) =>
  text
    .replace(/[\r\t]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

const unique = <T>(items: T[]) => Array.from(new Set(items));

const matchEnglishDrugLine = (lines: string[]) =>
  lines.find((line) => /[A-Za-z]/.test(line) && /(mg|mcg|g|ml|tab|cap)/i.test(line));

const matchThaiDrugLine = (lines: string[]) =>
  lines.find((line) => /[ก-๙]/.test(line) && !INSTRUCTION_SKIP_PATTERNS.some((pattern) => pattern.test(line)));

const extractMedicineFromEnglishLine = (line: string | undefined) => {
  if (!line) return null;

  const cleaned = cleanLine(line);
  const bracketed = cleaned.match(/([A-Za-z][A-Za-z0-9\- ]{2,40})\s*\(/);
  if (bracketed?.[1]) {
    return bracketed[1].trim();
  }

  const strengthMarker = cleaned.match(/(.+?)\s+\d+(?:\.\d+)?\s*(mg|mcg|g|ml)\b/i);
  if (strengthMarker?.[1]) {
    return strengthMarker[1].trim();
  }

  const words = cleaned.match(/[A-Za-z][A-Za-z0-9\- ]{2,50}/);
  return words?.[0]?.trim() ?? null;
};

const extractMedicineFromThaiLine = (line: string | undefined) => {
  if (!line) return null;
  const cleaned = cleanLine(line);
  if (cleaned.length < 2) return null;
  if (INSTRUCTION_SKIP_PATTERNS.some((pattern) => pattern.test(cleaned))) return null;
  return cleaned;
};

const extractDoseTextLines = (lines: string[]) => {
  const doseLines = lines.filter((line) =>
    /(รับประทาน|วันละ|ครั้งละ|ก่อนอาหาร|หลังอาหาร|เช้า|กลางวัน|เที่ยง|เย็น|ก่อนนอน|take|after meal|before meal|daily)/i.test(
      line,
    ),
  );

  return doseLines.slice(0, 4);
};

const extractQuantityPerDose = (text: string) => {
  const thai = text.match(/ครั้งละ\s*([0-9]+(?:[.,][0-9]+)?)\s*(เม็ด|แคปซูล|ช้อน|ml|มล|ซีซี)?/i);
  if (thai) {
    return `${thai[1]}${thai[2] ? ` ${thai[2]}` : ""}`;
  }

  const english = text.match(/(?:take|dose)\s*([0-9]+(?:[.,][0-9]+)?)\s*(tablet|tablets|capsule|capsules|ml)?/i);
  if (english) {
    return `${english[1]}${english[2] ? ` ${english[2]}` : ""}`;
  }

  return null;
};

const extractFrequencyPerDay = (text: string) => {
  const thai = text.match(/วันละ\s*([0-9]+)\s*ครั้ง/i);
  if (thai) return Number(thai[1]);

  const english = text.match(/([0-9]+)\s*times?\s*(?:per|a)\s*day/i);
  if (english) return Number(english[1]);

  return null;
};

const extractMealTiming = (text: string): MealTiming => {
  if (/ก่อนอาหาร|before meal|before food/i.test(text)) return "before_meal";
  if (/หลังอาหาร|after meal|after food/i.test(text)) return "after_meal";
  return "unspecified";
};

const extractPeriods = (text: string): DayPeriod[] => {
  const periods: DayPeriod[] = [];
  if (/เช้า|morning/i.test(text)) periods.push("morning");
  if (/กลางวัน|เที่ยง|noon|afternoon/i.test(text)) periods.push("noon");
  if (/เย็น|ค่ำ|evening/i.test(text)) periods.push("evening");
  if (/ก่อนนอน|night|bedtime/i.test(text)) periods.push("night");
  return unique(periods);
};

const extractCustomTimes = (text: string) => {
  const matches = text.match(/(?:^|\s)([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s|$)/g) ?? [];
  return unique(
    matches
      .map((value) => value.trim().match(/([01]?\d|2[0-3])[:.]([0-5]\d)/))
      .filter(Boolean)
      .map((parts) => `${parts?.[1]?.padStart(2, "0")}:${parts?.[2]}`),
  );
};

const fallbackPeriodsFromFrequency = (frequencyPerDay: number | null): DayPeriod[] => {
  if (frequencyPerDay === 1) return ["morning"];
  if (frequencyPerDay === 2) return ["morning", "evening"];
  if (frequencyPerDay && frequencyPerDay >= 3) return ["morning", "noon", "evening"];
  return [];
};

const computeConfidence = (details: Omit<ParsedMedicationDetails, "confidence">) => {
  let score = 0.2;
  if (details.medicineQuery.length >= 3) score += 0.25;
  if (details.dosageText.length >= 8) score += 0.2;
  if (details.frequencyPerDay) score += 0.2;
  if (details.periods.length || details.customTimes.length) score += 0.1;
  if (details.mealTiming !== "unspecified") score += 0.1;
  return Math.min(0.98, Number(score.toFixed(2)));
};

export const parseMedicationDetailsFromText = (inputText: string): ParsedMedicationDetails => {
  const normalizedRaw = normalizeText(inputText);
  const lines = normalizedRaw
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const englishLine = matchEnglishDrugLine(lines);
  const thaiLine = matchThaiDrugLine(lines);

  const medicineNameEn = extractMedicineFromEnglishLine(englishLine);
  const medicineNameTh = extractMedicineFromThaiLine(thaiLine);

  const doseLines = extractDoseTextLines(lines);
  const dosageText = doseLines.join(" ") || lines.slice(0, 6).join(" ");

  const quantityPerDose = extractQuantityPerDose(dosageText);
  const frequencyPerDay = extractFrequencyPerDay(dosageText);
  const mealTiming = extractMealTiming(dosageText);

  const extractedPeriods = extractPeriods(dosageText);
  const periods = extractedPeriods.length
    ? extractedPeriods
    : fallbackPeriodsFromFrequency(frequencyPerDay);

  const customTimes = extractCustomTimes(dosageText);

  const medicineQuery =
    medicineNameEn ??
    medicineNameTh ??
    lines
      .join(" ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(" ")
      .filter((token) => token.length >= 3)
      .slice(0, 4)
      .join(" ")
      .trim();

  const withoutConfidence: Omit<ParsedMedicationDetails, "confidence"> = {
    medicineQuery,
    medicineNameEn,
    medicineNameTh,
    dosageText,
    quantityPerDose,
    frequencyPerDay,
    mealTiming,
    periods,
    customTimes,
    rawText: normalizedRaw,
  };

  return {
    ...withoutConfidence,
    confidence: computeConfidence(withoutConfidence),
  };
};

export const extractLikelyMedicineQuery = (inputText: string) => {
  const parsed = parseMedicationDetailsFromText(inputText);
  return parsed.medicineQuery;
};

export const extractTextFromImageFallback = async (
  providedText: string | null | undefined,
) => {
  if (providedText && providedText.trim()) {
    return providedText.trim();
  }

  return "";
};
