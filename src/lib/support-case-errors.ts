import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";

const SUPPORT_CASE_TABLE_NAMES = ["support_cases", "support_case_messages"] as const;

export const isSupportCaseSchemaCacheError = (
  error: { message?: string; code?: string | null } | null | undefined,
) => {
  if (!error) return false;
  if (!isSchemaCacheMissingError({ message: error.message ?? "", code: error.code ?? null })) return false;
  const message = (error.message ?? "").toLowerCase();
  return SUPPORT_CASE_TABLE_NAMES.some((table) => message.includes(table));
};

export const SUPPORT_CASE_SCHEMA_CACHE_MESSAGE =
  "Supabase schema cache not ready for support chat tables. Run: NOTIFY pgrst, 'reload schema'; then wait 5-15 seconds and retry.";
