import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import {
  fetchSupportCaseById,
  fetchSupportCaseMessages,
  isSupportCaseStatus,
} from "@/lib/support-case-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const caseIdSchema = z.object({
  caseId: z.uuid(),
});

const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const canReadCase = (
  userId: string,
  role: "patient" | "doctor" | "admin",
  supportCase: {
    patient_id: string;
    requested_doctor_id: string;
    assigned_doctor_id: string | null;
  },
) => {
  if (role === "admin") return true;
  if (supportCase.patient_id === userId) return true;
  if (supportCase.requested_doctor_id === userId) return true;
  if (supportCase.assigned_doctor_id === userId) return true;
  return false;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
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

  if (
    !canReadCase(auth.userId, auth.role, supportCase)
  ) {
    return forbidden("Cannot access this case");
  }

  if (!isSupportCaseStatus(supportCase.status)) {
    return badRequest("Invalid case status");
  }

  try {
    const messages = await fetchSupportCaseMessages({
      supabase,
      caseId: supportCase.id,
    });

    return NextResponse.json({
      success: true,
      case: {
        id: supportCase.id,
        patientId: supportCase.patient_id,
        requestedDoctorId: supportCase.requested_doctor_id,
        assignedDoctorId: supportCase.assigned_doctor_id,
        status: supportCase.status,
        requestMessage: supportCase.request_message,
        requestedAt: supportCase.requested_at,
        acceptedAt: supportCase.accepted_at,
        closedAt: supportCase.closed_at,
      },
      messages,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load messages" },
      { status: 400 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const auth = await getApiAuthContext(["patient", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const params = caseIdSchema.safeParse(await context.params);
  if (!params.success) {
    return badRequest("Invalid case id");
  }

  const parsed = createMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const supabase = await createSupabaseServerClient();
  const supportCase = await fetchSupportCaseById({
    supabase,
    caseId: params.data.caseId,
  });

  if (!supportCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  if (!canReadCase(auth.userId, auth.role, supportCase)) {
    return forbidden("Cannot send message to this case");
  }

  if (!isSupportCaseStatus(supportCase.status)) {
    return badRequest("Invalid case status");
  }

  if (supportCase.status !== "active" && auth.role !== "admin") {
    return badRequest("Case is not active yet");
  }

  const { error: insertError } = await supabase
    .from("support_case_messages")
    .insert({
      case_id: supportCase.id,
      sender_id: auth.userId,
      message: parsed.data.message,
    });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
  });
}
