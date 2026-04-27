import { createSupabaseServerClient } from "@/lib/supabase/server";

interface AdminAuditInput {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

export const logAdminAction = async ({
  adminId,
  action,
  targetType,
  targetId,
  payload,
}: AdminAuditInput) => {
  const supabase = await createSupabaseServerClient();
  await supabase.from("admin_audit_logs").insert({
    admin_id: adminId,
    action,
    target_type: targetType,
    target_id: targetId,
    payload: payload ?? {},
  });
};
