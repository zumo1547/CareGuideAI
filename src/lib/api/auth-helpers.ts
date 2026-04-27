import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessAnyRole, isRole } from "@/lib/rbac";
import type { Role } from "@/types/domain";

export interface ApiAuthContext {
  userId: string;
  role: Role;
  email: string | null;
}

export const unauthorized = (message = "Unauthorized") =>
  NextResponse.json({ error: message }, { status: 401 });

export const forbidden = (message = "Forbidden") =>
  NextResponse.json({ error: message }, { status: 403 });

export const badRequest = (message = "Bad request", details?: unknown) =>
  NextResponse.json({ error: message, details }, { status: 400 });

export const getApiAuthContext = async (
  allowedRoles?: Role[],
): Promise<ApiAuthContext | NextResponse> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return unauthorized();
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || !isRole(profile.role)) {
    return forbidden("Profile role not found");
  }

  if (allowedRoles && !canAccessAnyRole(profile.role, allowedRoles)) {
    return forbidden();
  }

  return {
    userId: user.id,
    role: profile.role,
    email: user.email ?? null,
  };
};
