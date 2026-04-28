import { addMinutes, subMinutes } from "date-fns";
import { NextResponse } from "next/server";

import { getApiAuthContext } from "@/lib/api/auth-helpers";
import { env } from "@/lib/env";
import { makeReminderMessage, shouldDispatchNow } from "@/lib/reminders/engine";
import { getSmsProvider } from "@/lib/reminders/sms-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const isCronAuthorized = (request: Request) => {
  if (!env.CRON_SECRET) return true;
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${env.CRON_SECRET}`;
};

const dispatch = async (request: Request) => {
  if (!isCronAuthorized(request)) {
    const auth = await getApiAuthContext(["admin"]);
    if (auth instanceof NextResponse) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }
  }

  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const windowStart = subMinutes(now, 5).toISOString();
  const windowEnd = addMinutes(now, 10).toISOString();

  const { data: events, error } = await supabase
    .from("reminder_events")
    .select(
      "id, patient_id, plan_id, channel, due_at, status, medication_plans(dosage, medicine_id), profiles(phone)",
    )
    .eq("status", "pending")
    .gte("due_at", windowStart)
    .lte("due_at", windowEnd)
    .order("due_at", { ascending: true })
    .limit(150);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!events?.length) {
    return NextResponse.json({
      success: true,
      scanned: 0,
      sent: 0,
      provider: getSmsProvider().providerName,
      message: "No pending reminders in dispatch window",
    });
  }

  const medicineIds = events
    .map((event) => {
      const plan = Array.isArray(event.medication_plans)
        ? event.medication_plans[0]
        : event.medication_plans;
      return plan?.medicine_id;
    })
    .filter((id): id is string => Boolean(id));

  const { data: medicines } = medicineIds.length
    ? await supabase.from("medicines").select("id, name").in("id", medicineIds)
    : { data: [] as { id: string; name: string }[] };

  const medicineMap = new Map((medicines ?? []).map((item) => [item.id, item.name]));
  const smsProvider = getSmsProvider();
  let sent = 0;
  let failed = 0;

  for (const event of events) {
    const plan = Array.isArray(event.medication_plans)
      ? event.medication_plans[0]
      : event.medication_plans;
    const profile = Array.isArray(event.profiles) ? event.profiles[0] : event.profiles;
    const dueAt = new Date(event.due_at);
    if (!shouldDispatchNow(dueAt, now)) {
      continue;
    }

    const medicineName = plan?.medicine_id
      ? medicineMap.get(plan.medicine_id) ?? "ยา"
      : "ยา";

    if (event.channel === "voice") {
      continue;
    }

    const message = makeReminderMessage({
      eventId: event.id,
      patientId: event.patient_id,
      patientPhone: profile?.phone ?? null,
      dueAt,
      medicineName,
      dosage: plan?.dosage ?? "-",
    });

    const result = await smsProvider.sendReminder({
      eventId: event.id,
      patientId: event.patient_id,
      patientPhone: profile?.phone ?? null,
      dueAt: event.due_at,
      channel: "sms",
      message,
    });

    const update = {
      sent_at: new Date().toISOString(),
      status: result.success ? "sent" : "failed",
      provider: result.provider,
      provider_response: result,
    };

    await supabase.from("reminder_events").update(update).eq("id", event.id);

    if (result.success) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({
    success: true,
    scanned: events.length,
    sent,
    failed,
    provider: smsProvider.providerName,
    timestamp: now.toISOString(),
  });
};

export async function POST(request: Request) {
  return dispatch(request);
}

export async function GET(request: Request) {
  return dispatch(request);
}
