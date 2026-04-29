import { subDays } from "date-fns";
import { NextResponse } from "next/server";

import { getApiAuthContext } from "@/lib/api/auth-helpers";
import { env, hasSupabaseServiceRole } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const isCronAuthorized = (request: Request) => {
  if (!env.CRON_SECRET) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${env.CRON_SECRET}`;
};

const cleanupReminderEvents = async (request: Request) => {
  const cronAuthorized = isCronAuthorized(request);
  if (!cronAuthorized) {
    const auth = await getApiAuthContext(["admin"]);
    if (auth instanceof NextResponse) {
      return NextResponse.json({ error: "Unauthorized cleanup request" }, { status: 401 });
    }
  } else if (!hasSupabaseServiceRole) {
    return NextResponse.json(
      {
        error:
          "SUPABASE_SERVICE_ROLE_KEY is required for cron cleanup because the request has no user session.",
      },
      { status: 500 },
    );
  }

  const supabase = cronAuthorized
    ? createSupabaseAdminClient()
    : await createSupabaseServerClient();

  const threshold = subDays(new Date(), 7).toISOString();

  const { count, error: countError } = await supabase
    .from("reminder_events")
    .select("id", { count: "exact", head: true })
    .lt("due_at", threshold);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const { error: deleteError } = await supabase
    .from("reminder_events")
    .delete()
    .lt("due_at", threshold);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deleted: count ?? 0,
    threshold,
    mode: cronAuthorized ? "cron-service-role" : "admin-session",
  });
};

export async function POST(request: Request) {
  return cleanupReminderEvents(request);
}

export async function GET(request: Request) {
  return cleanupReminderEvents(request);
}

