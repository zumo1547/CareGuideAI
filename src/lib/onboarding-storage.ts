import type { User } from "@supabase/supabase-js";

import {
  BIOLOGICAL_SEXES,
  DISABILITY_SEVERITY,
  DISABILITY_TYPES,
  type BiologicalSex,
  type OnboardingFormValues,
  type OnboardingProfile,
} from "@/lib/onboarding";

type PostgrestLikeError = {
  message: string;
  code?: string | null;
};

type JsonMap = Record<string, unknown>;

const isObject = (value: unknown): value is JsonMap =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

const asNumberOrString = (value: unknown): number | string | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return null;
};

const isDisabilityType = (
  value: string,
): value is (typeof DISABILITY_TYPES)[number] =>
  (DISABILITY_TYPES as readonly string[]).includes(value);

const isDisabilitySeverity = (
  value: string,
): value is (typeof DISABILITY_SEVERITY)[number] =>
  (DISABILITY_SEVERITY as readonly string[]).includes(value);

const isBiologicalSex = (value: string): value is BiologicalSex =>
  (BIOLOGICAL_SEXES as readonly string[]).includes(value);

export const ONBOARDING_PROFILE_METADATA_KEY = "onboarding_profile_v1";

export const ONBOARDING_PROFILE_SELECT_COLUMNS = `
  user_id,
  biological_sex,
  disability_type,
  disability_other,
  disability_severity,
  chronic_conditions,
  regular_medications,
  drug_allergies,
  baseline_blood_pressure,
  baseline_blood_sugar,
  weight_kg,
  height_cm,
  bmi,
  need_tts,
  need_large_text,
  need_large_buttons,
  need_navigation_guidance,
  completed_at,
  created_at,
  updated_at
`;

export const isSchemaCacheMissingError = (
  error: PostgrestLikeError | null | undefined,
) => {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
};

export const buildPersistedOnboardingProfile = (
  userId: string,
  payload: OnboardingFormValues,
  bmi: number,
  existing?: Pick<OnboardingProfile, "created_at"> | null,
): OnboardingProfile => {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    biological_sex: payload.biologicalSex,
    disability_type: payload.disabilityType,
    disability_other:
      payload.disabilityType === "other" ? payload.disabilityOther.trim() : null,
    disability_severity: payload.disabilitySeverity,
    chronic_conditions: payload.chronicConditions,
    regular_medications: payload.regularMedications,
    drug_allergies: payload.drugAllergies,
    baseline_blood_pressure: payload.baselineBloodPressure,
    baseline_blood_sugar: payload.baselineBloodSugar,
    weight_kg: payload.weightKg,
    height_cm: payload.heightCm,
    bmi,
    need_tts: payload.needTts,
    need_large_text: payload.needLargeText,
    need_large_buttons: payload.needLargeButtons,
    need_navigation_guidance: payload.needNavigationGuidance,
    completed_at: now,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
};

export const readOnboardingProfileFromMetadata = (
  user: Pick<User, "id" | "user_metadata">,
): OnboardingProfile | null => {
  if (!isObject(user.user_metadata)) return null;

  const raw = user.user_metadata[ONBOARDING_PROFILE_METADATA_KEY];
  if (!isObject(raw)) return null;

  const biologicalSexRaw = asString(raw.biological_sex);
  const biologicalSex = biologicalSexRaw && isBiologicalSex(biologicalSexRaw) ? biologicalSexRaw : null;
  const disabilityTypeRaw = asString(raw.disability_type);
  const disabilitySeverityRaw = asString(raw.disability_severity);

  if (
    !disabilityTypeRaw ||
    !isDisabilityType(disabilityTypeRaw) ||
    !disabilitySeverityRaw ||
    !isDisabilitySeverity(disabilitySeverityRaw)
  ) {
    return null;
  }

  const chronicConditions = asString(raw.chronic_conditions);
  const regularMedications = asString(raw.regular_medications);
  const drugAllergies = asString(raw.drug_allergies);
  const baselineBloodPressure = asString(raw.baseline_blood_pressure);
  const baselineBloodSugar = asString(raw.baseline_blood_sugar);
  const completedAt = asString(raw.completed_at);
  const createdAt = asString(raw.created_at);
  const updatedAt = asString(raw.updated_at);
  const weightKg = asNumberOrString(raw.weight_kg);
  const heightCm = asNumberOrString(raw.height_cm);
  const bmi = asNumberOrString(raw.bmi);

  if (
    !chronicConditions ||
    !regularMedications ||
    !drugAllergies ||
    !baselineBloodPressure ||
    !baselineBloodSugar ||
    !completedAt ||
    !createdAt ||
    !updatedAt ||
    weightKg === null ||
    heightCm === null ||
    bmi === null
  ) {
    return null;
  }

  const disabilityOther = raw.disability_other;
  return {
    user_id: user.id,
    biological_sex: biologicalSex,
    disability_type: disabilityTypeRaw,
    disability_other: typeof disabilityOther === "string" ? disabilityOther : null,
    disability_severity: disabilitySeverityRaw,
    chronic_conditions: chronicConditions,
    regular_medications: regularMedications,
    drug_allergies: drugAllergies,
    baseline_blood_pressure: baselineBloodPressure,
    baseline_blood_sugar: baselineBloodSugar,
    weight_kg: weightKg,
    height_cm: heightCm,
    bmi,
    need_tts: asBoolean(raw.need_tts, true),
    need_large_text: asBoolean(raw.need_large_text, true),
    need_large_buttons: asBoolean(raw.need_large_buttons, true),
    need_navigation_guidance: asBoolean(raw.need_navigation_guidance, true),
    completed_at: completedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
};
