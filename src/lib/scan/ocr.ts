export type MealTiming = "before_meal" | "after_meal" | "unspecified";
export type DayPeriod = "morning" | "noon" | "evening" | "night";

export interface ParsedMedicationDetails {
  medicineQuery: string;
  medicineNameEn: string | null;
  medicineNameTh: string | null;
  dosageText: string;
  quantityPerDose: string | null;
  quantityPerDoseValue: number | null;
  frequencyPerDay: number | null;
  mealTiming: MealTiming;
  periods: DayPeriod[];
  customTimes: string[];
  totalPillsInPackage: number | null;
  isDoctorPrescribed: boolean | null;
  confidence: number;
  rawText: string;
}

export type OcrValidationIssue =
  | "missing_name_en"
  | "missing_name_th"
  | "suspicious_name_en"
  | "suspicious_name_th"
  | "dosage_unclear"
  | "low_confidence";

export interface OcrValidationResult {
  canConfirm: boolean;
  score: number;
  issues: OcrValidationIssue[];
  messageTh: string;
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
  /patient|name|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\./i,
];

const PATIENT_CONTEXT_REGEX =
  /(hn|opd|patient|name|age|dob|โรงพยาบาล|ผู้ป่วย|แพทย์|คลินิก|นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)/i;

const DRUG_KEYWORD_REGEX =
  /\b(tablet|tab|capsule|cap|syrup|suspension|cream|ointment|mg|mcg|ml|g)\b/i;

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
const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/g;
const ENGLISH_CHAR_REGEX = /[A-Za-z]/g;
const OCR_NOISE_REGEX = /[\u201C\u201D"':;,_`~^|<>\[\]{}]+/g;
const LEADING_SYMBOL_REGEX = /^[^A-Za-z\u0E00-\u0E7F]+/;
const TRAILING_SYMBOL_REGEX = /[^A-Za-z\u0E00-\u0E7F0-9)]+$/;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const countMatches = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

const normalizeNameCandidate = (value: string) =>
  value
    .replace(OCR_NOISE_REGEX, " ")
    .replace(/\s+/g, " ")
    .replace(LEADING_SYMBOL_REGEX, "")
    .replace(TRAILING_SYMBOL_REGEX, "")
    .trim();

const isValidEnglishMedicineName = (value: string) => {
  const normalized = normalizeNameCandidate(value);
  const englishChars = countMatches(normalized, ENGLISH_CHAR_REGEX);
  if (englishChars < 5) return false;
  if (!/[aeiou]/i.test(normalized)) return false;
  if (!/[A-Za-z]{3,}/.test(normalized)) return false;
  return /[A-Za-z][A-Za-z0-9\- ]{3,}/.test(normalized);
};

const isValidThaiMedicineName = (value: string) => {
  const normalized = normalizeNameCandidate(value);
  const thaiChars = countMatches(normalized, THAI_CHAR_REGEX);
  if (thaiChars < 4) return false;
  if (normalized.length < 4) return false;
  return !/^[\u0E00-\u0E7F]\s*$/.test(normalized);
};

const isInstructionLine = (line: string) =>
  INSTRUCTION_SKIP_PATTERNS.some((pattern) => pattern.test(line)) || PATIENT_CONTEXT_REGEX.test(line);

const hasEnglishDrugShape = (line: string) => {
  if (!/[A-Za-z]/.test(line)) return false;
  if (isInstructionLine(line)) return false;

  const normalized = normalizeNameCandidate(line);
  const englishChars = countMatches(normalized, ENGLISH_CHAR_REGEX);
  if (englishChars < 5) return false;

  return (
    /(mg|mcg|g|ml|tab|cap)\b/i.test(normalized) ||
    /\([A-Za-z0-9\- ]{3,}\)/.test(normalized) ||
    /\b[A-Za-z][A-Za-z0-9\-]{3,}\b(?:\s+\b[A-Za-z][A-Za-z0-9\-]{2,}\b)?/.test(normalized)
  );
};

const hasThaiDrugShape = (line: string) => {
  if (!/[\u0E00-\u0E7F]/.test(line)) return false;
  if (isInstructionLine(line)) return false;

  const normalized = normalizeNameCandidate(line);
  const thaiChars = countMatches(normalized, THAI_CHAR_REGEX);
  if (thaiChars < 4) return false;

  const hasDrugKeyword = DRUG_KEYWORD_REGEX.test(normalized);
  const isLikelyTwoPartPersonName =
    /^[\u0E00-\u0E7F]{2,20}\s+[\u0E00-\u0E7F]{2,30}$/.test(normalized) && !hasDrugKeyword;
  return !isLikelyTwoPartPersonName;
};

const matchEnglishDrugLine = (lines: string[]) =>
  lines.find((line) => /[A-Za-z]/.test(line) && /(mg|mcg|g|ml|tab|cap)\b/i.test(line)) ??
  lines.find((line) => hasEnglishDrugShape(line));

const matchThaiDrugLine = (lines: string[]) => lines.find((line) => hasThaiDrugShape(line));

const extractMedicineFromEnglishLine = (line: string | undefined) => {
  if (!line) return null;

  const cleaned = cleanLine(line);
  const bracketed = cleaned.match(/([A-Za-z][A-Za-z0-9\- ]{2,40})\s*\(/);
  if (bracketed?.[1]) {
    const normalized = normalizeNameCandidate(bracketed[1]);
    return isValidEnglishMedicineName(normalized) ? normalized : null;
  }

  const strengthMarker = cleaned.match(/(.+?)\s+\d+(?:\.\d+)?\s*(mg|mcg|g|ml)\b/i);
  if (strengthMarker?.[1]) {
    const normalized = normalizeNameCandidate(strengthMarker[1]);
    return isValidEnglishMedicineName(normalized) ? normalized : null;
  }

  const words = cleaned.match(/[A-Za-z][A-Za-z0-9\- ]{2,50}/);
  const normalized = normalizeNameCandidate(words?.[0] ?? "");
  return normalized && isValidEnglishMedicineName(normalized) ? normalized : null;
};

const extractMedicineFromThaiLine = (line: string | undefined) => {
  if (!line) return null;
  const cleaned = normalizeNameCandidate(cleanLine(line));
  if (cleaned.length < 2) return null;
  if (INSTRUCTION_SKIP_PATTERNS.some((pattern) => pattern.test(cleaned))) return null;
  if (PATIENT_CONTEXT_REGEX.test(cleaned) && !DRUG_KEYWORD_REGEX.test(cleaned)) return null;
  return isValidThaiMedicineName(cleaned) ? cleaned : null;
};

const extractThaiNameFromEnglishLineParenthesis = (line: string | undefined) => {
  if (!line) return null;
  const match = line.match(/\(([^)]*[\u0E00-\u0E7F][^)]*)\)/);
  if (!match?.[1]) return null;
  const normalized = normalizeNameCandidate(cleanLine(match[1]));
  if (!normalized) return null;
  if (PATIENT_CONTEXT_REGEX.test(normalized) && !DRUG_KEYWORD_REGEX.test(normalized)) return null;
  return isValidThaiMedicineName(normalized) ? normalized : null;
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

const extractQuantityPerDoseValue = (quantityPerDose: string | null) => {
  if (!quantityPerDose) return null;
  const match = quantityPerDose.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
};

const TOTAL_PILLS_UNIT_REGEX = /(เม็ด|tablet|tablets|tab|capsule|capsules|caplet|caplets|caps?)/i;
const DOSE_INSTRUCTION_HINT_REGEX =
  /(ครั้งละ|วันละ|รับประทาน|ก่อนอาหาร|หลังอาหาร|take|dose|times?\s*(per|a)\s*day|before meal|after meal)/i;
const DOCTOR_PRESCRIBED_REGEX =
  /(ใช้ตามแพทย์สั่งเท่านั้น|ตามแพทย์สั่ง|แพทย์สั่ง|prescription\s*only|rx\s*only|doctor['\s-]*order)/i;
const OTC_HINT_REGEX = /(otc|over\s*the\s*counter|ยาสามัญประจำบ้าน|ยาสามัญ)/i;

const normalizeCandidatePillCount = (value: number) => {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded <= 0 || rounded > 5000) return null;
  return rounded;
};

const extractTotalPillsInPackage = (text: string) => {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const candidates: number[] = [];
  for (const line of lines) {
    const hasDoseHint = DOSE_INSTRUCTION_HINT_REGEX.test(line);
    const hasUnit = TOTAL_PILLS_UNIT_REGEX.test(line);
    const hasCountMarker = /#\s*\d{1,5}|(จำนวน|qty|quantity|จ่าย|dispense)/i.test(line);

    if (!hasUnit && !hasCountMarker) {
      continue;
    }

    const hashMatch = line.match(/#\s*([0-9]{1,5})\s*(?:เม็ด|tablet|tablets|tab|capsule|capsules|caplet|caplets|caps?)?/i);
    if (hashMatch?.[1]) {
      const parsed = normalizeCandidatePillCount(Number(hashMatch[1]));
      if (parsed) {
        candidates.push(parsed);
        continue;
      }
    }

    const quantityMatch = line.match(
      /(?:จำนวน|qty|quantity|จ่าย|dispense)\s*[:#]?\s*([0-9]{1,5})\s*(?:เม็ด|tablet|tablets|tab|capsule|capsules|caplet|caplets|caps?)?/i,
    );
    if (quantityMatch?.[1]) {
      const parsed = normalizeCandidatePillCount(Number(quantityMatch[1]));
      if (parsed) {
        candidates.push(parsed);
        continue;
      }
    }

    if (hasDoseHint) {
      continue;
    }

    const genericMatch = line.match(
      /([0-9]{1,5})\s*(?:เม็ด|tablet|tablets|tab|capsule|capsules|caplet|caplets|caps?)\b/i,
    );
    if (genericMatch?.[1]) {
      const parsed = normalizeCandidatePillCount(Number(genericMatch[1]));
      if (parsed) {
        candidates.push(parsed);
      }
    }
  }

  if (!candidates.length) return null;
  const uniqueSorted = unique(candidates).sort((a, b) => b - a);
  return uniqueSorted.find((value) => value >= 4) ?? uniqueSorted[0] ?? null;
};

const detectDoctorPrescription = (text: string): boolean | null => {
  if (!text.trim()) return null;
  if (DOCTOR_PRESCRIBED_REGEX.test(text)) return true;
  if (OTC_HINT_REGEX.test(text)) return false;
  return null;
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
  if (details.medicineNameEn) score += 0.12;
  if (details.medicineNameTh) score += 0.12;
  if (details.dosageText.length >= 8) score += 0.2;
  if (details.frequencyPerDay) score += 0.2;
  if (details.periods.length || details.customTimes.length) score += 0.1;
  if (details.mealTiming !== "unspecified") score += 0.1;
  if (details.totalPillsInPackage) score += 0.06;
  if (details.isDoctorPrescribed !== null) score += 0.03;
  return Math.min(0.98, Number(score.toFixed(2)));
};

const validationMessageFromIssues = (issues: OcrValidationIssue[]) => {
  if (!issues.length) return "OCR is clear. You can confirm this medicine.";
  const hasThIssue = issues.includes("missing_name_th") || issues.includes("suspicious_name_th");
  const hasEnIssue = issues.includes("missing_name_en") || issues.includes("suspicious_name_en");
  if (hasThIssue && hasEnIssue) return "Thai and English medicine names are unclear. Please rescan.";
  if (issues.includes("dosage_unclear")) return "Dosage instructions are unclear. Please rescan.";
  if (hasThIssue) return "Thai medicine name is unclear. Please center the label and rescan.";
  if (hasEnIssue) return "English medicine name is unclear. Please rescan with full line visible.";
  return "OCR confidence is low. Please rescan.";
};

export const validateParsedMedicationDetails = (
  details: ParsedMedicationDetails,
): OcrValidationResult => {
  const issues: OcrValidationIssue[] = [];
  const medicineNameEn = details.medicineNameEn?.trim() ?? "";
  const medicineNameTh = details.medicineNameTh?.trim() ?? "";
  const hasValidEn = Boolean(medicineNameEn) && isValidEnglishMedicineName(medicineNameEn);
  const hasValidTh = Boolean(medicineNameTh) && isValidThaiMedicineName(medicineNameTh);
  const hasAnyValidName = hasValidEn || hasValidTh;

  if (!medicineNameEn) {
    issues.push("missing_name_en");
  } else if (!hasValidEn) {
    issues.push("suspicious_name_en");
  }

  if (!medicineNameTh) {
    issues.push("missing_name_th");
  } else if (!hasValidTh) {
    issues.push("suspicious_name_th");
  }

  const hasDoseInfo =
    Boolean(details.quantityPerDose) ||
    Boolean(details.frequencyPerDay) ||
    details.periods.length > 0 ||
    details.customTimes.length > 0 ||
    details.mealTiming !== "unspecified";
  if (!hasDoseInfo) {
    issues.push("dosage_unclear");
  }

  if (details.confidence < 0.58) {
    issues.push("low_confidence");
  }

  let score = 1;
  if (issues.includes("missing_name_en")) score -= 0.08;
  if (issues.includes("suspicious_name_en")) score -= 0.16;
  if (issues.includes("missing_name_th")) score -= 0.08;
  if (issues.includes("suspicious_name_th")) score -= 0.16;
  if (issues.includes("dosage_unclear")) score -= 0.14;
  if (issues.includes("low_confidence")) score -= 0.12;
  if (!hasAnyValidName) score -= 0.24;
  score = Number(clamp01(score).toFixed(2));

  const canConfirm =
    hasAnyValidName &&
    score >= 0.45 &&
    (!issues.includes("dosage_unclear") || details.confidence >= 0.7);

  return {
    canConfirm,
    score,
    issues,
    messageTh: validationMessageFromIssues(issues),
  };
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
  const medicineNameTh =
    extractMedicineFromThaiLine(thaiLine) ?? extractThaiNameFromEnglishLineParenthesis(englishLine);

  const doseLines = extractDoseTextLines(lines);
  const dosageText = doseLines.join(" ") || lines.slice(0, 6).join(" ");

  const quantityPerDose = extractQuantityPerDose(dosageText);
  const quantityPerDoseValue = extractQuantityPerDoseValue(quantityPerDose);
  const frequencyPerDay = extractFrequencyPerDay(dosageText);
  const mealTiming = extractMealTiming(dosageText);

  const extractedPeriods = extractPeriods(dosageText);
  const periods = extractedPeriods.length
    ? extractedPeriods
    : fallbackPeriodsFromFrequency(frequencyPerDay);

  const customTimes = extractCustomTimes(dosageText);
  const totalPillsInPackage = extractTotalPillsInPackage(normalizedRaw);
  const isDoctorPrescribed = detectDoctorPrescription(normalizedRaw);

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
    quantityPerDoseValue,
    frequencyPerDay,
    mealTiming,
    periods,
    customTimes,
    totalPillsInPackage,
    isDoctorPrescribed,
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
