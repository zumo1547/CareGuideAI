import { NextResponse } from "next/server";
import { z } from "zod";

import { logAdminAction } from "@/lib/api/admin-audit";
import { badRequest, getApiAuthContext } from "@/lib/api/auth-helpers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Role } from "@/types/domain";

const schema = z.object({
  userId: z.uuid(),
});

const isForeignKeyError = (message: string | undefined) =>
  Boolean(message && message.includes("violates foreign key constraint"));

export async function DELETE(request: Request) {
  const auth = await getApiAuthContext(["admin"]);
  if (auth instanceof NextResponse) {
    return auth;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid payload");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid payload", parsed.error.flatten());
  }

  const { userId } = parsed.data;
  if (userId === auth.userId) {
    return NextResponse.json({ error: "ไม่สามารถลบบัญชีแอดมินที่กำลังใช้งานอยู่ได้" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: targetProfile, error: targetProfileError } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .single();

  if (targetProfileError || !targetProfile) {
    return NextResponse.json({ error: "ไม่พบบัญชีผู้ใช้ที่ต้องการลบ" }, { status: 404 });
  }

  const targetRole = targetProfile.role as Role;

  if (targetRole === "doctor") {
    const { error: supportCasesError } = await admin
      .from("support_cases")
      .delete()
      .eq("requested_doctor_id", userId);
    if (supportCasesError) {
      return NextResponse.json(
        { error: `ลบข้อมูลเคสช่วยเหลือของแพทย์ไม่สำเร็จ: ${supportCasesError.message}` },
        { status: 400 },
      );
    }
  }

  const { error: invitesReassignError } = await admin
    .from("doctor_invites")
    .update({ invited_by: auth.userId })
    .eq("invited_by", userId)
    .neq("invited_by", auth.userId);
  if (invitesReassignError) {
    return NextResponse.json(
      { error: `ย้ายเจ้าของรายการเชิญแพทย์ไม่สำเร็จ: ${invitesReassignError.message}` },
      { status: 400 },
    );
  }

  const { error: linksReassignError } = await admin
    .from("patient_doctor_links")
    .update({ assigned_by: auth.userId })
    .eq("assigned_by", userId)
    .neq("assigned_by", auth.userId);
  if (linksReassignError) {
    return NextResponse.json(
      { error: `ย้ายเจ้าของรายการจับคู่ผู้ป่วย-แพทย์ไม่สำเร็จ: ${linksReassignError.message}` },
      { status: 400 },
    );
  }

  const { error: auditDeleteError } = await admin
    .from("admin_audit_logs")
    .delete()
    .eq("admin_id", userId);
  if (auditDeleteError) {
    return NextResponse.json(
      { error: `ลบประวัติ admin audit เดิมไม่สำเร็จ: ${auditDeleteError.message}` },
      { status: 400 },
    );
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    if (isForeignKeyError(deleteError.message)) {
      return NextResponse.json(
        {
          error:
            "ลบผู้ใช้ไม่สำเร็จ เพราะยังมีข้อมูลอ้างอิงอยู่ในระบบ กรุณาลบ/ปิดงานที่เกี่ยวข้องก่อนแล้วลองใหม่",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  await logAdminAction({
    adminId: auth.userId,
    action: "delete_user",
    targetType: "profile",
    targetId: userId,
    payload: {
      targetRole,
      targetName: targetProfile.full_name,
    },
  });

  return NextResponse.json({ success: true });
}
