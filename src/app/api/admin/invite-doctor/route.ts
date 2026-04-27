import { addHours } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.email(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { email, expiresInHours } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { data: invite, error } = await supabase
    .from("doctor_invites")
    .insert({
      email: email.toLowerCase(),
      invited_by: auth.userId,
      status: "pending",
      expires_at: addHours(new Date(), expiresInHours).toISOString(),
    })
    .select("id, token")
    .single();

  if (error || !invite) {
    return NextResponse.json({ error: error?.message ?? "สร้างคำเชิญไม่สำเร็จ" }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.userId,
    action: "invite_doctor",
    targetType: "doctor_invite",
    targetId: invite.id,
    payload: { email },
  });

  const inviteLink = `${env.NEXT_PUBLIC_APP_URL}/register?invite=${invite.token}`;

  return NextResponse.json({
    success: true,
    inviteToken: invite.token,
    inviteLink,
  });
}
