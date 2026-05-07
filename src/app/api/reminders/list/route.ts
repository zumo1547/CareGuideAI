import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest, forbidden, getApiAuthContext } from "@/lib/api/auth-helpers";
import { canAccessPatientScope } from "@/lib/caregiver/access";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const querySchema = z.object({
  patientId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const isCancelledAtColumnMissing = (message: string | undefined) =>
  (message ?? "").toLowerCase().includes("cancelled_at");

const mapEvents = (
  rows: Array<{
    id: string;
    due_at: string;
    channel: string;
    status: string;
    provider: string | null;
    cancelled_at?: string | null;
  }>,
) =>
  rows.map((row) => ({
    id: row.id,
    dueAt: row.due_at,
    channel: row.channel,
    status: row.status,
    provider: row.provider,
    cancelledAt: row.cancelled_at ?? null,
  }));

export async function GET(request: Request) {
  const auth = await getApiAuthContext(["patient", "caregiver", "doctor", "admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    patientId: searchParams.get("patientId") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return badRequest("Invalid query", parsed.error.flatten());
  }

  const patientId = parsed.data.patientId ?? auth.userId;
  const limit = parsed.data.limit ?? 40;
  const supabase = await createSupabaseServerClient();
  const adminSupabase = env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdminClient() : null;
  const reader = adminSupabase ?? supabase;

  const canAccess = await canAccessPatientScope({
    supabase,
    role: auth.role,
    actorId: auth.userId,
    patientId,
  });
  if (!canAccess) {
    return forbidden("Cannot view reminder events for this patient");
  }

  const primary = await reader
    .from("reminder_events")
    .select("id, due_at, channel, status, provider, cancelled_at")
    .eq("patient_id", patientId)
    .order("due_at", { ascending: false })
    .limit(limit);
  let data = primary.data as
    | Array<{
        id: string;
        due_at: string;
        channel: string;
        status: string;
        provider: string | null;
        cancelled_at?: string | null;
      }>
    | null;
  let error = primary.error;

  if (isCancelledAtColumnMissing(error?.message)) {
    const fallback = await reader
      .from("reminder_events")
      .select("id, due_at, channel, status, provider")
      .eq("patient_id", patientId)
      .order("due_at", { ascending: false })
      .limit(limit);
    data = fallback.data as
      | Array<{
          id: string;
          due_at: string;
          channel: string;
          status: string;
          provider: string | null;
          cancelled_at?: string | null;
        }>
      | null;
    error = fallback.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    patientId,
    events: mapEvents(
      (data ?? []) as Array<{
        id: string;
        due_at: string;
        channel: string;
        status: string;
        provider: string | null;
        cancelled_at?: string | null;
      }>,
    ),
  });
}
