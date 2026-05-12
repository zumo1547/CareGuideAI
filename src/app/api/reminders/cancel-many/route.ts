import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z
  .object({
    eventIds: z.array(z.uuid()).max(500).optional().default([]),
    patientId: z.uuid().optional(),
    cancelAllPending: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.cancelAllPending && value.eventIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "eventIds is required when cancelAllPending is false",
        path: ["eventIds"],
      });
    }
  });

const isMissingCancelledAtColumnError = (message: string | undefined) =>
  (message ?? "").toLowerCase().includes("cancelled_at");

const isStatusConstraintError = (
  message: string | undefined,
  code: string | null | undefined,
) =>
  code === "23514" || (message ?? "").toLowerCase().includes("reminder_events_status_check");

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const uniqueEventIds = [...new Set(parsed.data.eventIds)];
  const cancelAllPending = parsed.data.cancelAllPending;
  const patientId = parsed.data.patientId ?? auth.userId;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : null;
  const writer = adminSupabase ?? supabase;

  if (auth.role === "patient" && patientId !== auth.userId) {
    return forbidden("Cannot cancel reminders for other patients");
  }

  if (auth.role === "caregiver") {
    const canAccess = await canAccessPatientScope({
      supabase,
      role: auth.role,
      actorId: auth.userId,
      patientId,
    });
    if (!canAccess) {
      return forbidden("Cannot cancel reminders for this patient");
    }
  }

  const eventQuery = writer
    .from("reminder_events")
    .select("id, patient_id, status")
    .eq("patient_id", patientId);

  const { data: events, error: eventsError } = cancelAllPending
    ? await eventQuery.eq("status", "pending").limit(2000)
    : await eventQuery.in("id", uniqueEventIds);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 400 });
  }

  if (!events?.length) {
    if (cancelAllPending) {
      return badRequest("No pending reminders to cancel");
    }
    return NextResponse.json({ error: "Reminder events not found" }, { status: 404 });
  }

  if (events.some((event) => event.patient_id !== patientId)) {
    return badRequest("Some reminder events do not belong to target patient");
  }

  const pendingEventIds = events
    .filter((event) => event.status === "pending")
    .map((event) => event.id);

  if (!pendingEventIds.length) {
    return badRequest("No pending reminders to cancel");
  }

  const cancelledAt = new Date().toISOString();
  const baseUpdatePayload = {
    status: "cancelled",
    sent_at: cancelledAt,
    provider: "user-cancelled",
    provider_response: {
      source: "patient-dashboard",
      cancelledBy: auth.userId,
      cancelledAt,
      batch: true,
      cancelledIds: pendingEventIds,
    },
  };

  const withCancelledAtPayload = {
    ...baseUpdatePayload,
    cancelled_at: cancelledAt,
  };

  let { error: updateError } = await writer
    .from("reminder_events")
    .update(withCancelledAtPayload)
    .eq("patient_id", patientId)
    .in("id", pendingEventIds)
    .eq("status", "pending");

  if (isMissingCancelledAtColumnError(updateError?.message)) {
    const fallback = await writer
      .from("reminder_events")
      .update(baseUpdatePayload)
      .eq("patient_id", patientId)
      .in("id", pendingEventIds)
      .eq("status", "pending");
    updateError = fallback.error;
  }

  if (isStatusConstraintError(updateError?.message, updateError?.code)) {
    const legacyPayload = {
      status: "failed",
      sent_at: cancelledAt,
      provider: "user-cancelled",
      provider_response: {
        source: "patient-dashboard",
        cancelledBy: auth.userId,
        cancelledAt,
        batch: true,
        legacyCancelled: true,
        cancelledIds: pendingEventIds,
      },
    };
    const legacyFallback = await writer
      .from("reminder_events")
      .update(legacyPayload)
      .eq("patient_id", patientId)
      .in("id", pendingEventIds)
      .eq("status", "pending");
    updateError = legacyFallback.error;
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    cancelledAt,
    cancelledCount: pendingEventIds.length,
    cancelledIds: pendingEventIds,
    skippedCount: events.length - pendingEventIds.length,
  });
}
