import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  eventId: z.uuid(),
});

const isMissingCancelledAtColumnError = (message: string | undefined) =>
  (message ?? "").toLowerCase().includes("cancelled_at");

const isStatusConstraintError = (
  message: string | undefined,
  code: string | null | undefined,
) =>
  code === "23514" || (message ?? "").toLowerCase().includes("reminder_events_status_check");

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["patient", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const supabase = await createSupabaseServerClient();
  const { eventId } = parsed.data;

  const { data: event, error: eventError } = await supabase
    .from("reminder_events")
    .select("id, patient_id, status")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 400 });
  }

  if (!event) {
    return NextResponse.json({ error: "Reminder event not found" }, { status: 404 });
  }

  if (auth.role === "patient" && event.patient_id !== auth.userId) {
    return forbidden("Cannot cancel this reminder");
  }

  if (event.status !== "pending") {
    return badRequest("Only pending reminders can be cancelled");
  }

  const cancelledAt = new Date().toISOString();
  const baseUpdatePayload = {
    status: "cancelled",
    provider: "user-cancelled",
    provider_response: {
      source: "patient-dashboard",
      cancelledBy: auth.userId,
      cancelledAt,
    },
  };

  const withCancelledAtPayload = {
    ...baseUpdatePayload,
    cancelled_at: cancelledAt,
  };

  let { error: updateError } = await supabase
    .from("reminder_events")
    .update(withCancelledAtPayload)
    .eq("id", eventId);

  // Fallback for projects where PostgREST schema cache has not picked up cancelled_at yet.
  if (isMissingCancelledAtColumnError(updateError?.message)) {
    const fallback = await supabase
      .from("reminder_events")
      .update(baseUpdatePayload)
      .eq("id", eventId);
    updateError = fallback.error;
  }

  // Fallback for older DB constraint that does not yet allow status='cancelled'.
  // We persist status='failed' but tag provider='user-cancelled' so UI can render as cancelled.
  if (isStatusConstraintError(updateError?.message, updateError?.code)) {
    const legacyPayload = {
      status: "failed",
      provider: "user-cancelled",
      provider_response: {
        source: "patient-dashboard",
        cancelledBy: auth.userId,
        cancelledAt,
        legacyCancelled: true,
      },
    };
    const legacyFallback = await supabase
      .from("reminder_events")
      .update(legacyPayload)
      .eq("id", eventId);
    updateError = legacyFallback.error;
  }

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    eventId,
    status: "cancelled",
    cancelledAt,
  });
}
