import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  eventId: z.uuid(),
});

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
  const { error: updateError } = await supabase
    .from("reminder_events")
    .update({
      status: "cancelled",
      cancelled_at: cancelledAt,
      provider: "user-cancelled",
      provider_response: {
        source: "patient-dashboard",
        cancelledBy: auth.userId,
        cancelledAt,
      },
    })
    .eq("id", eventId);

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

