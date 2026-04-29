import { z } from "zod";

export const DISABILITY_TYPES = [
  "normal",
  "visual",
  "hearing",
  "mobility",
  "intellectual",
  "other",
] as const;

export const DISABILITY_TYPE_LABELS: Record<(typeof DISABILITY_TYPES)[number], string> = {
  normal: "ผู้ใช้ปกติ (ไม่มีความพิการ)",
  visual: "ทางการมองเห็น (ตาบอด / สายตาเลือนลาง)",
  hearing: "ทางการได้ยิน (หูหนวก / หูตึง)",
  mobility: "ทางการเคลื่อนไหว",
  intellectual: "ทางสติปัญญา",
  other: "อื่น ๆ (ระบุ)",
};

export const DISABILITY_SEVERITY = ["none", "mild", "moderate", "severe"] as const;

export const DISABILITY_SEVERITY_LABELS: Record<(typeof DISABILITY_SEVERITY)[number], string> = {
  none: "ไม่ระบุ (ผู้ใช้ปกติ)",
  mild: "เล็กน้อย",
  moderate: "ปานกลาง",
  severe: "รุนแรง",
};

export const BIOLOGICAL_SEXES = ["female", "male"] as const;

export const BIOLOGICAL_SEX_LABELS: Record<(typeof BIOLOGICAL_SEXES)[number], string> = {
  female: "หญิง",
  male: "ชาย",
};

export type BiologicalSex = (typeof BIOLOGICAL_SEXES)[number];

export type BmiBand =
  | "underweight"
  | "normal"
  | "overweight_level_1"
  | "obesity_level_2"
  | "obesity_level_3";

export interface BmiTrend {
  sex: BiologicalSex;
  sexLabel: string;
  band: BmiBand;
  bmi: number;
  rangeLabel: string;
  statusLabel: string;
  diseaseRiskLabel: string;
  bloodPressureTrendLabel: string;
  recommendationLabel: string;
}

const getSexLabel = (sex: BiologicalSex) => BIOLOGICAL_SEX_LABELS[sex];

export const getBmiTrend = (bmi: number, sex: BiologicalSex): BmiTrend => {
  const normalizedBmi = Number.isFinite(bmi) ? Number(bmi.toFixed(2)) : 0;
  const sexLabel = getSexLabel(sex);

  if (normalizedBmi < 18.5) {
    return {
      sex,
      sexLabel,
      band: "underweight",
      bmi: normalizedBmi,
      rangeLabel: "น้อยกว่า 18.50",
      statusLabel: "น้ำหนักน้อย / ผอม",
      diseaseRiskLabel: "มากกว่าปกติ",
      bloodPressureTrendLabel: `แนวโน้มของ${sexLabel}: ความดันอาจต่ำหรือแปรปรวน`,
      recommendationLabel: "ควรติดตามโภชนาการและค่าวัดสุขภาพต่อเนื่อง",
    };
  }

  if (normalizedBmi <= 22.9) {
    return {
      sex,
      sexLabel,
      band: "normal",
      bmi: normalizedBmi,
      rangeLabel: "18.50 - 22.90",
      statusLabel: "ปกติ (สุขภาพดี)",
      diseaseRiskLabel: "เท่าคนปกติ",
      bloodPressureTrendLabel: `แนวโน้มของ${sexLabel}: ความดันอยู่ใกล้เกณฑ์ปกติ`,
      recommendationLabel: "รักษาพฤติกรรมการกินยา อาหาร และการนอนให้สม่ำเสมอ",
    };
  }

  if (normalizedBmi <= 24.9) {
    return {
      sex,
      sexLabel,
      band: "overweight_level_1",
      bmi: normalizedBmi,
      rangeLabel: "23.00 - 24.90",
      statusLabel: "ท้วม / โรคอ้วนระดับ 1",
      diseaseRiskLabel: "อันตรายระดับ 1",
      bloodPressureTrendLabel: `แนวโน้มของ${sexLabel}: ความดันเริ่มสูงขึ้นได้`,
      recommendationLabel: "ควรเริ่มควบคุมน้ำหนักและติดตามค่าความดันถี่ขึ้น",
    };
  }

  if (normalizedBmi <= 29.9) {
    return {
      sex,
      sexLabel,
      band: "obesity_level_2",
      bmi: normalizedBmi,
      rangeLabel: "25.00 - 29.90",
      statusLabel: "อ้วน / โรคอ้วนระดับ 2",
      diseaseRiskLabel: "อันตรายระดับ 2",
      bloodPressureTrendLabel: `แนวโน้มของ${sexLabel}: ความดันสูงมีโอกาสเกิดได้มากขึ้น`,
      recommendationLabel: "ควรติดตามแพทย์และวางแผนคุมปัจจัยเสี่ยงร่วม",
    };
  }

  return {
    sex,
    sexLabel,
    band: "obesity_level_3",
    bmi: normalizedBmi,
    rangeLabel: "มากกว่า 30.00",
    statusLabel: "อ้วนมาก / โรคอ้วนระดับ 3",
    diseaseRiskLabel: "อันตรายระดับ 3",
    bloodPressureTrendLabel: `แนวโน้มของ${sexLabel}: ความดันสูงและภาวะแทรกซ้อนมีความเสี่ยงสูง`,
    recommendationLabel: "ควรติดตามแพทย์อย่างใกล้ชิดและประเมินความเสี่ยงสม่ำเสมอ",
  };
};

export const onboardingSchema = z
  .object({
    biologicalSex: z.enum(BIOLOGICAL_SEXES),
    disabilityType: z.enum(DISABILITY_TYPES),
    disabilityOther: z.string().trim().max(120),
    disabilitySeverity: z.enum(DISABILITY_SEVERITY),
    chronicConditions: z.string().trim().min(1, "กรอกข้อมูลโรคประจำตัว"),
    regularMedications: z.string().trim().min(1, "กรอกยาที่ใช้ประจำ"),
    drugAllergies: z.string().trim().min(1, "กรอกประวัติการแพ้ยา"),
    baselineBloodPressure: z.string().trim().min(1, "กรอกค่าความดันพื้นฐาน"),
    baselineBloodSugar: z.string().trim().min(1, "กรอกค่าน้ำตาลพื้นฐาน"),
    weightKg: z
      .number()
      .min(20, "น้ำหนักต้องมากกว่า 20 กก.")
      .max(300, "น้ำหนักเกินช่วงที่รองรับ"),
    heightCm: z
      .number()
      .min(100, "ส่วนสูงต้องมากกว่า 100 ซม.")
      .max(250, "ส่วนสูงเกินช่วงที่รองรับ"),
    needTts: z.boolean(),
    needLargeText: z.boolean(),
    needLargeButtons: z.boolean(),
    needNavigationGuidance: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.disabilityType === "other" && !value.disabilityOther.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "โปรดระบุประเภทความพิการ",
        path: ["disabilityOther"],
      });
    }

    if (value.disabilityType === "normal" && value.disabilitySeverity !== "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ผู้ใช้ปกติต้องเลือกระดับเป็น ไม่ระบุ (ผู้ใช้ปกติ)",
        path: ["disabilitySeverity"],
      });
    }

    if (value.disabilityType !== "normal" && value.disabilitySeverity === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "โปรดเลือกระดับความรุนแรง",
        path: ["disabilitySeverity"],
      });
    }
  });

export type OnboardingFormValues = z.infer<typeof onboardingSchema>;

export interface OnboardingProfile {
  user_id: string;
  biological_sex: BiologicalSex | null;
  disability_type: (typeof DISABILITY_TYPES)[number];
  disability_other: string | null;
  disability_severity: (typeof DISABILITY_SEVERITY)[number];
  chronic_conditions: string;
  regular_medications: string;
  drug_allergies: string;
  baseline_blood_pressure: string;
  baseline_blood_sugar: string;
  weight_kg: number | string;
  height_cm: number | string;
  bmi: number | string;
  need_tts: boolean;
  need_large_text: boolean;
  need_large_buttons: boolean;
  need_navigation_guidance: boolean;
  completed_at: string;
  created_at: string;
  updated_at: string;
}

export const calculateBmi = (weightKg: number, heightCm: number) => {
  const heightMeters = heightCm / 100;
  if (!heightMeters) return 0;
  const bmi = weightKg / (heightMeters * heightMeters);
  return Number(bmi.toFixed(2));
};
