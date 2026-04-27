import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/types/domain";

const schema = z.object({
  userId: z.uuid(),
  role: z.enum(["patient", "doctor", "admin"]),
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

  const { userId, role } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role: role as Role })
    .eq("id", userId);

  if (profileError) {
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
