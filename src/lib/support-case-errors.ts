import { isSchemaCacheMissingError } from "@/lib/onboarding-storage";
import { env } from "@/lib/env";

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
