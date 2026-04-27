import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  eventIds: z.array(z.uuid()).min(1),
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
  const { eventIds } = parsed.data;

  const { error } = await supabase
    .from("reminder_events")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      provider: "web-tts",
    })
    .eq("patient_id", auth.userId)
    .eq("channel", "voice")
    .in("id", eventIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, acknowledged: eventIds.length });
}
