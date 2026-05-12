import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/types/domain";

const toSafeNextPath = (nextPath: string | null) => {
  if (!nextPath) return "/app";
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/app";
  }
  return nextPath;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const errorMessage =
    requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  const nextPath = toSafeNextPath(requestUrl.searchParams.get("next"));

  if (errorMessage) {
    const failedUrl = new URL("/login", requestUrl.origin);
    failedUrl.searchParams.set("error", errorMessage);
    return NextResponse.redirect(failedUrl);
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failedUrl = new URL("/login", requestUrl.origin);
      failedUrl.searchParams.set("error", error.message);
      return NextResponse.redirect(failedUrl);
    }

    // Ensure OAuth users always have a profile row so role routing + onboarding can continue.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const metadata = user.user_metadata ?? {};
      const fullName =
        (metadata.full_name as string | undefined)?.trim() ||
        (metadata.name as string | undefined)?.trim() ||
        (user.email ? user.email.split("@")[0] : "ผู้ใช้ใหม่");
      const phone = (metadata.phone as string | undefined)?.trim() || null;
      const roleFromMetadata = (metadata.role as string | undefined)?.trim();
      const role: Role =
        roleFromMetadata === "admin" ||
        roleFromMetadata === "doctor" ||
        roleFromMetadata === "caregiver" ||
        roleFromMetadata === "patient"
          ? roleFromMetadata
          : "patient";

      if (env.SUPABASE_SERVICE_ROLE_KEY) {
        const admin = createSupabaseAdminClient();
        await admin.from("profiles").upsert(
          {
            id: user.id,
            full_name: fullName,
            phone,
            role,
          },
          {
            onConflict: "id",
            ignoreDuplicates: true,
          },
        );
      } else {
        // Fallback without service role: best effort, may depend on RLS policy.
        await supabase.from("profiles").upsert(
          {
            id: user.id,
            full_name: fullName,
            phone,
            role,
          },
          {
            onConflict: "id",
            ignoreDuplicates: true,
          },
        );
      }
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
