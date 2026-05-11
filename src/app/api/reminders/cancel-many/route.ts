import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  eventIds: z.array(z.uuid()).min(1).max(100),
  patientId: z.uuid().optional(),
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
  const patientId = parsed.data.patientId;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : null;
  const writer = adminSupabase ?? supabase;

  const { data: events, error: eventsError } = await writer
    .from("reminder_events")
    .select("id, patient_id, status")
    .in("id", uniqueEventIds);

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 400 });
  }

  if (!events?.length) {
    return NextResponse.json({ error: "Reminder events not found" }, { status: 404 });
  }

  if (patientId && events.some((event) => event.patient_id !== patientId)) {
    return badRequest("Some reminder events do not belong to target patient");
  }

  if (auth.role === "patient" && events.some((event) => event.patient_id !== auth.userId)) {
    return forbidden("Cannot cancel reminders for other patients");
  }

  if (auth.role === "caregiver") {
    const uniquePatientIds = [...new Set(events.map((event) => event.patient_id).filter(Boolean))];
    for (const targetPatientId of uniquePatientIds) {
      const canAccess = await canAccessPatientScope({
        supabase,
        role: auth.role,
        actorId: auth.userId,
        patientId: targetPatientId,
      });
      if (!canAccess) {
        return forbidden("Cannot cancel reminders for this patient");
      }
    }
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
    .in("id", pendingEventIds)
    .eq("status", "pending");

  if (isMissingCancelledAtColumnError(updateError?.message)) {
    const fallback = await writer
      .from("reminder_events")
      .update(baseUpdatePayload)
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
