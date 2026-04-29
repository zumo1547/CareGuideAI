import { subMinutes } from "date-fns";
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

const cleanupCancelledReminderEvents = async (request: Request) => {
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

  const threshold = subMinutes(new Date(), 30).toISOString();

  const { count: cancelledCount, error: cancelledCountError } = await supabase
    .from("reminder_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "cancelled")
    .lte("sent_at", threshold);

  if (cancelledCountError) {
    return NextResponse.json({ error: cancelledCountError.message }, { status: 500 });
  }

  const { error: cancelledDeleteError } = await supabase
    .from("reminder_events")
    .delete()
    .eq("status", "cancelled")
    .lte("sent_at", threshold);

  if (cancelledDeleteError) {
    return NextResponse.json({ error: cancelledDeleteError.message }, { status: 500 });
  }

  // Legacy fallback: old schema may store cancelled items as failed + provider user-cancelled.
  const { count: legacyCount, error: legacyCountError } = await supabase
    .from("reminder_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .eq("provider", "user-cancelled")
    .lte("sent_at", threshold);

  if (legacyCountError) {
    return NextResponse.json({ error: legacyCountError.message }, { status: 500 });
  }

  const { error: legacyDeleteError } = await supabase
    .from("reminder_events")
    .delete()
    .eq("status", "failed")
    .eq("provider", "user-cancelled")
    .lte("sent_at", threshold);

  if (legacyDeleteError) {
    return NextResponse.json({ error: legacyDeleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    deletedCancelled: cancelledCount ?? 0,
    deletedLegacyCancelled: legacyCount ?? 0,
    deletedTotal: (cancelledCount ?? 0) + (legacyCount ?? 0),
    threshold,
    mode: cronAuthorized ? "cron-service-role" : "admin-session",
  });
};

export async function POST(request: Request) {
  return cleanupCancelledReminderEvents(request);
}

export async function GET(request: Request) {
  return cleanupCancelledReminderEvents(request);
}

