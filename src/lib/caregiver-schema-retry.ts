import { ensureCaregiverSchema } from "@/lib/caregiver-schema-bootstrap";
import { isCaregiverSchemaCacheError } from "@/lib/caregiver-schema-errors";

type MaybeSupabaseError = {
  message?: string;
  code?: string | null;
} | null;

type QueryResult<T> = {
  data: T | null;
  error: MaybeSupabaseError;
};

export const withCaregiverSchemaRecovery = async <T>(
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> => {
  const first = await operation();
  if (!first.error || !isCaregiverSchemaCacheError(first.error)) {
    return first;
  }

  await ensureCaregiverSchema().catch(() => undefined);
  return operation();
};

