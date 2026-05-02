import { ensureSupportCaseSchema } from "@/lib/support-case-bootstrap";
import { isSupportCaseSchemaCacheError } from "@/lib/support-case-errors";

type MaybeSupabaseError = {
  message?: string;
  code?: string | null;
} | null;

const toMaybeError = (error: unknown): MaybeSupabaseError => {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { message?: unknown; code?: unknown };
  return {
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    code: typeof candidate.code === "string" ? candidate.code : null,
  };
};

export const withSupportCaseSchemaRetry = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation();
  } catch (error) {
    const normalizedError = toMaybeError(error);
    if (!isSupportCaseSchemaCacheError(normalizedError)) {
      throw error;
    }

    await ensureSupportCaseSchema();
    return operation();
  }
};
