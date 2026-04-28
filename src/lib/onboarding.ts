import { z } from "zod";

export const DISABILITY_TYPES = [
  "visual",
  "hearing",
  "mobility",
  "intellectual",
  "other",
] as const;

export const DISABILITY_TYPE_LABELS: Record<(typeof DISABILITY_TYPES)[number], string> = {
  visual: "ทางการมองเห็น (ตาบอด / สายตาเลือนลาง)",
  hearing: "ทางการได้ยิน (หูหนวก / หูตึง)",
  mobility: "ทางการเคลื่อนไหว",
  intellectual: "ทางสติปัญญา",
  other: "อื่น ๆ (ระบุ)",
};

export const DISABILITY_SEVERITY = ["mild", "moderate", "severe"] as const;

export const DISABILITY_SEVERITY_LABELS: Record<(typeof DISABILITY_SEVERITY)[number], string> = {
  mild: "เล็กน้อย",
  moderate: "ปานกลาง",
  severe: "รุนแรง",
};

export const onboardingSchema = z
  .object({
    disabilityType: z.enum(DISABILITY_TYPES),
    disabilityOther: z.string().trim().max(120),
    disabilitySeverity: z.enum(DISABILITY_SEVERITY),
    chronicConditions: z.string().trim().min(1, "กรอกข้อมูลโรคประจำตัว"),
    regularMedications: z.string().trim().min(1, "กรอกยาที่ใช้ประจำ"),
    drugAllergies: z.string().trim().min(1, "กรอกประวัติการแพ้ยา"),
    baselineBloodPressure: z.string().trim().min(1, "กรอกค่าความดันพื้นฐาน"),
    baselineBloodSugar: z.string().trim().min(1, "กรอกค่าน้ำตาลพื้นฐาน"),
    weightKg: z.number().min(20, "น้ำหนักต้องมากกว่า 20 กก.").max(300, "น้ำหนักเกินช่วงที่รองรับ"),
    heightCm: z.number().min(100, "ส่วนสูงต้องมากกว่า 100 ซม.").max(250, "ส่วนสูงเกินช่วงที่รองรับ"),
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
  });

export type OnboardingFormValues = z.infer<typeof onboardingSchema>;

export interface OnboardingProfile {
  user_id: string;
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
