import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { ensureCaregiverSchema } from "@/lib/caregiver-schema-bootstrap";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/types/domain";

const schema = z.object({
  userId: z.uuid(),
  role: z.enum(["patient", "caregiver", "doctor", "admin"]),
});

const isRoleEnumError = (message: string | undefined) =>
  Boolean(
    message &&
      (message.includes("invalid input value for enum user_role") ||
        message.includes("invalid input value for enum public.user_role")),
  );

export async function POST(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { userId, role } = parsed.data;
  const supabase = await createSupabaseServerClient();

  let { error: profileError } = await supabase
    .from("profiles")
    .update({ role: role as Role })
    .eq("id", userId);

  if (profileError && role === "caregiver" && isRoleEnumError(profileError.message)) {
    await ensureCaregiverSchema().catch(() => undefined);
    const retry = await supabase
      .from("profiles")
      .update({ role: role as Role })
      .eq("id", userId);
    profileError = retry.error;
  }

  if (profileError) {
    if (role === "caregiver" && isRoleEnumError(profileError.message)) {
      return NextResponse.json(
        {
          error:
            "ระบบ Caregiver ของฐานข้อมูลที่เว็บกำลังเชื่อมต่อยังไม่พร้อม กรุณารัน 0012_caregiver_mode.sql ใน Supabase โปรเจกต์เดียวกับเว็บนี้ แล้วรัน NOTIFY pgrst, 'reload schema'; จากนั้นลองใหม่",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const adminClient = createSupabaseAdminClient();
  const { data: userData } = await adminClient.auth.admin.getUserById(userId);
  const currentMeta = userData.user?.user_metadata ?? {};

  const { error: userError } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMeta,
      role,
    },
  });

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.userId,
    action: "assign_role",
    targetType: "profile",
    targetId: userId,
    payload: { role },
  });

  return NextResponse.json({ success: true });
}
