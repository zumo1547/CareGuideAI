import { env } from "@/lib/env";
import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";

const CAREGIVER_TABLE_NAMES = [
  "caregiver_patient_links",
  "caregiver_daily_routines",
] as const;

export const CAREGIVER_SCHEMA_CACHE_MESSAGE =
  "ระบบ Caregiver ของฐานข้อมูลยังไม่พร้อมชั่วคราว ระบบกำลังพยายามซ่อมอัตโนมัติ โปรดลองอีกครั้ง";

export const isCaregiverSchemaCacheError = (
  error: { message?: string; code?: string | null } | null | undefined,
) => {
  if (!error) return false;
  if (
    !isSchemaCacheMissingError({
      message: error.message ?? "",
      code: error.code ?? null,
    })
  ) {
    return false;
  }
  const message = (error.message ?? "").toLowerCase();
  return CAREGIVER_TABLE_NAMES.some((table) => message.includes(table));
};

export const getSupabaseProjectRefFromEnv = () => {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;

  try {
    const host = new URL(url).hostname;
    const [ref] = host.split(".");
    return ref || null;
  } catch {
    return null;
  }
};

