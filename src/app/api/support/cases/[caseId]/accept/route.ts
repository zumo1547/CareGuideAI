import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { fetchSupportCaseById, isSupportCaseStatus } from "@/lib/support-case-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const caseIdSchema = z.object({
  caseId: z.uuid(),
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

  const supabase = await createSupabaseServerClient();
  const supportCase = await fetchSupportCaseById({
    supabase,
    caseId: params.data.caseId,
  });

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
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    caseId: supportCase.id,
    status: "active",
    acceptedAt,
  });
}
