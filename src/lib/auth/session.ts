import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAnyRole, isRole } from "@/lib/rbac";
import type { Profile, Role } from "@/types/domain";

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: Profile;
}

export const getSessionContext = async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, created_at, updated_at")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !isRole(profile.role)) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
  };
};

export const requireSession = async () => {
  const context = await getSessionContext();
  if (!context) {
    redirect("/login");
  }
  return context;
};

export const requireRole = async (allowed: Role[]) => {
  const context = await requireSession();
  if (!canAccessAnyRole(context.profile.role, allowed)) {
    redirect("/app");
  }
  return context;
};
