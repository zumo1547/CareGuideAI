import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import {
  getSupabaseProjectRefFromEnv,
  isSupportCaseSchemaCacheError,
  SUPPORT_CASE_SCHEMA_CACHE_MESSAGE,
} from "@/lib/support-case-errors";
import { fetchSupportCaseById, isSupportCaseStatus } from "@/lib/support-case-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const caseIdSchema = z.object({
  caseId: z.uuid(),
});

const buildSchemaCacheErrorPayload = (rawErrorMessage?: string) => ({
  error: SUPPORT_CASE_SCHEMA_CACHE_MESSAGE,
  code: "SUPPORT_SCHEMA_CACHE_NOT_READY" as const,
  schemaReloadSql: "NOTIFY pgrst, 'reload schema';",
  projectRefHint: getSupabaseProjectRefFromEnv(),
  rawErrorMessage: rawErrorMessage ?? null,
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const auth = await getApiAuthContext(["doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const params = caseIdSchema.safeParse(await context.params);
  if (!params.success) {
    return badRequest("Invalid case id");
  }

  const supabase = createSupabaseAdminClient();
  let supportCase: Awaited<ReturnType<typeof fetchSupportCaseById>>;
  try {
    supportCase = await fetchSupportCaseById({
      supabase,
      caseId: params.data.caseId,
    });
  } catch (error) {
    if (isSupportCaseSchemaCacheError(error instanceof Error ? { message: error.message } : null)) {
      return NextResponse.json(
        buildSchemaCacheErrorPayload(error instanceof Error ? error.message : undefined),
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load case" },
      { status: 400 },
    );
  }

  if (!supportCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  if (!isSupportCaseStatus(supportCase.status)) {
    return badRequest("Invalid case status");
  }

  if (
    auth.role !== "admin" &&
    supportCase.requested_doctor_id !== auth.userId &&
    supportCase.assigned_doctor_id !== auth.userId
  ) {
    return forbidden("Doctor cannot accept this case");
  }

  if (supportCase.status === "closed") {
    return badRequest("Case already closed");
  }

  if (supportCase.status === "active") {
    return NextResponse.json({
      success: true,
      caseId: supportCase.id,
      status: supportCase.status,
    });
  }

  const acceptedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("support_cases")
    .update({
      status: "active",
      assigned_doctor_id: auth.userId,
      accepted_at: acceptedAt,
      updated_at: acceptedAt,
    })
    .eq("id", supportCase.id)
    .eq("status", "pending");

  if (updateError) {
    if (isSupportCaseSchemaCacheError(updateError)) {
      return NextResponse.json(
        buildSchemaCacheErrorPayload(updateError.message),
        { status: 503 },
      );
    }
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    caseId: supportCase.id,
    status: "active",
    acceptedAt,
  });
}
