import { isAfter } from "date-fns";
import { NextResponse } from "next/server";
import { z } from "zod";

import { badRequest } from "@/lib/api/auth-helpers";
import { ensureCaregiverSchema } from "@/lib/caregiver-schema-bootstrap";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  phone: z.string().min(9),
  password: z.string().min(8),
  role: z.enum(["patient", "caregiver"]).default("patient"),
  inviteToken: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid register payload", parsed.error.flatten());
  }

  const { fullName, email, phone, password, role: requestedRole, inviteToken } = parsed.data;
  const admin = createSupabaseAdminClient();

  let role: "patient" | "caregiver" | "doctor" = requestedRole;
  let inviteId: string | null = null;

  if (inviteToken?.trim()) {
    const { data: invite, error: inviteError } = await admin
      .from("doctor_invites")
      .select("id, email, status, expires_at")
      .eq("token", inviteToken.trim())
      .single();

    if (inviteError || !invite) {
      return NextResponse.json({ error: "Invite token ไม่ถูกต้อง" }, { status: 400 });
    }

    if (invite.status !== "pending") {
      return NextResponse.json({ error: "Invite token ถูกใช้งานแล้วหรือยกเลิกแล้ว" }, { status: 400 });
    }

    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: "อีเมลที่สมัครไม่ตรงกับอีเมลในคำเชิญ" },
        { status: 400 },
      );
    }

    if (invite.expires_at && isAfter(new Date(), new Date(invite.expires_at))) {
      return NextResponse.json({ error: "Invite token หมดอายุแล้ว" }, { status: 400 });
    }

    role = "doctor";
    inviteId = invite.id;
  }

  if (role === "caregiver") {
    try {
      await ensureCaregiverSchema();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Caregiver schema bootstrap failed.";
      return NextResponse.json(
        {
          error:
            "ระบบ Caregiver ยังไม่พร้อมในฐานข้อมูล กรุณารัน migration `0012_caregiver_mode.sql` และลองใหม่",
          details: message,
        },
        { status: 500 },
      );
    }
  }

  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      phone,
      role,
    },
  });

  if (createUserError || !createdUser.user) {
    return NextResponse.json(
      { error: createUserError?.message ?? "สร้างผู้ใช้ไม่สำเร็จ" },
      { status: 400 },
    );
  }

  const userId = createdUser.user.id;

  let { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    full_name: fullName,
    phone,
    role,
  });

  if (
    profileError &&
    role === "caregiver" &&
    profileError.message.includes("invalid input value for enum user_role")
  ) {
    await ensureCaregiverSchema().catch(() => undefined);
    const retry = await admin.from("profiles").upsert({
      id: userId,
      full_name: fullName,
      phone,
      role,
    });
    profileError = retry.error;
  }

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (inviteId) {
    await admin
      .from("doctor_invites")
      .update({
        status: "accepted",
        accepted_by: userId,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", inviteId);
  }

  return NextResponse.json({
    success: true,
    userId,
    role,
  });
}
