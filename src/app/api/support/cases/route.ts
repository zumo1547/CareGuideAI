import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import {
  getSupabaseProjectRefFromEnv,
  isSupportCaseSchemaCacheError,
  SUPPORT_CASE_SCHEMA_CACHE_MESSAGE,
} from "@/lib/support-case-errors";
import { fetchSupportCaseList } from "@/lib/support-case-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const createCaseSchema = z.object({
  requestedDoctorId: z.uuid(),
  requestMessage: z.string().trim().min(3).max(3000),
});

const buildSchemaCacheErrorPayload = (rawErrorMessage?: string) => ({
  error: SUPPORT_CASE_SCHEMA_CACHE_MESSAGE,
  code: "SUPPORT_SCHEMA_CACHE_NOT_READY" as const,
  schemaReloadSql: "NOTIFY pgrst, 'reload schema';",
  projectRefHint: getSupabaseProjectRefFromEnv(),
  rawErrorMessage: rawErrorMessage ?? null,
});

export async function GET() {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const supabase = createSupabaseAdminClient();
  try {
    const cases = await fetchSupportCaseList({
      supabase,
      userId: auth.userId,
      role: auth.role,
      limit: 100,
    });

    return NextResponse.json({
      success: true,
      cases,
    });
  } catch (error) {
    if (isSupportCaseSchemaCacheError(error instanceof Error ? { message: error.message } : null)) {
      return NextResponse.json(
        buildSchemaCacheErrorPayload(error instanceof Error ? error.message : undefined),
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load cases" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = createCaseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  if (auth.role !== "patient" && auth.role !== "admin") {
    return forbidden("Only patient or admin can create support case");
  }

  const supabase = createSupabaseAdminClient();
  const { requestedDoctorId, requestMessage } = parsed.data;
  const patientId = auth.userId;

  const { data: doctorProfile, error: doctorError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", requestedDoctorId)
    .maybeSingle();

  if (doctorError) {
    return NextResponse.json({ error: doctorError.message }, { status: 400 });
  }

  if (!doctorProfile || doctorProfile.role !== "doctor") {
    return badRequest("Requested doctor not found");
  }

  const { data: existingCase, error: existingError } = await supabase
    .from("support_cases")
    .select("id, status")
    .eq("patient_id", patientId)
    .eq("requested_doctor_id", requestedDoctorId)
    .in("status", ["pending", "active"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    if (isSupportCaseSchemaCacheError(existingError)) {
      return NextResponse.json(
        buildSchemaCacheErrorPayload(existingError.message),
        { status: 503 },
      );
    }
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  if (existingCase) {
    return NextResponse.json(
      {
        error: "You already have an open case with this doctor",
        caseId: existingCase.id,
        status: existingCase.status,
      },
      { status: 409 },
    );
  }

  const { data: insertedCase, error: insertError } = await supabase
    .from("support_cases")
    .insert({
      patient_id: patientId,
      requested_doctor_id: requestedDoctorId,
      request_message: requestMessage,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !insertedCase) {
    if (isSupportCaseSchemaCacheError(insertError)) {
      return NextResponse.json(
        buildSchemaCacheErrorPayload(insertError?.message),
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: insertError?.message ?? "Unable to create support case" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    caseId: insertedCase.id,
    message: "Support case created",
  });
}
