import { NextResponse, type NextRequest } from "next/server";

import { ROLE_GUARDED_ROUTES, ROLE_HOME } from "@/lib/constants";
import {
  isSchemaCacheMissingError,
  readOnboardingProfileFromMetadata,
} from "@/lib/onboarding-storage";
import { canAccessAnyRole, isRole } from "@/lib/rbac";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";

const findRequiredRoles = (pathname: string) => {
  const entries = Object.entries(ROLE_GUARDED_ROUTES);
  for (const [path, roles] of entries) {
    if (pathname.startsWith(path)) {
      return roles;
    }
  }
  return null;
};

export async function proxy(request: NextRequest) {
  const { supabase, getResponse, withResponseState } = createSupabaseMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return withResponseState(NextResponse.redirect(loginUrl));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !isRole(profile.role)) {
    return withResponseState(NextResponse.redirect(new URL("/login", request.url)));
  }

  const isOnboardingRoute = request.nextUrl.pathname.startsWith("/app/onboarding");
  const { data: onboardingProfile, error: onboardingError } = await supabase
    .from("user_onboarding_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let hasCompletedOnboarding = !onboardingError && Boolean(onboardingProfile);
  if (onboardingError && isSchemaCacheMissingError(onboardingError)) {
    hasCompletedOnboarding = Boolean(readOnboardingProfileFromMetadata(user));
  }

  if (!hasCompletedOnboarding && !isOnboardingRoute) {
    return withResponseState(NextResponse.redirect(new URL("/app/onboarding", request.url)));
  }

  if (hasCompletedOnboarding && isOnboardingRoute) {
    return withResponseState(NextResponse.redirect(new URL(ROLE_HOME[profile.role], request.url)));
  }

  const requiredRoles = findRequiredRoles(request.nextUrl.pathname);
  if (requiredRoles && !canAccessAnyRole(profile.role, requiredRoles)) {
    return withResponseState(NextResponse.redirect(new URL(ROLE_HOME[profile.role], request.url)));
  }

  return getResponse();
}

export const config = {
  matcher: ["/app/:path*"],
};
