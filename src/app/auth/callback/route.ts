import type { EmailOtpType } from "@supabase/supabase-js";
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

const isEmailOtpType = (value: string | null): value is EmailOtpType =>
  value === "recovery" ||
  value === "signup" ||
  value === "invite" ||
  value === "magiclink" ||
  value === "email_change" ||
  value === "email" ||
  value === "phone_change";

const getSafeRole = (rawRole: string | undefined): Role =>
  rawRole === "admin" || rawRole === "doctor" || rawRole === "caregiver" || rawRole === "patient"
    ? rawRole
    : "patient";

const ensureProfileRow = async (
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
) => {
  const metadata = user.user_metadata ?? {};
  const fullName =
    (metadata.full_name as string | undefined)?.trim() ||
    (metadata.name as string | undefined)?.trim() ||
    (user.email ? user.email.split("@")[0] : "ผู้ใช้ใหม่");
  const phone = (metadata.phone as string | undefined)?.trim() || null;
  const role = getSafeRole((metadata.role as string | undefined)?.trim());

  const payload = {
    id: user.id,
    full_name: fullName,
    phone,
    role,
  };

  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createSupabaseAdminClient();
    await admin.from("profiles").upsert(payload, {
      onConflict: "id",
      ignoreDuplicates: true,
    });
    return;
  }

  const supabase = await createSupabaseServerClient();
  await supabase.from("profiles").upsert(payload, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const errorMessage =
    requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  const nextPath = toSafeNextPath(requestUrl.searchParams.get("next"));

  if (errorMessage) {
    const failedUrl = new URL(nextPath === "/reset-password" ? "/reset-password" : "/login", requestUrl.origin);
    failedUrl.searchParams.set("error", errorMessage);
    return NextResponse.redirect(failedUrl);
  }

  if (code || (tokenHash && isEmailOtpType(otpType))) {
    const supabase = await createSupabaseServerClient();
    const authResult = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash as string,
          type: otpType as EmailOtpType,
        });

    if (authResult.error) {
      const failedUrl = new URL(nextPath === "/reset-password" ? "/reset-password" : "/login", requestUrl.origin);
      failedUrl.searchParams.set("error", authResult.error.message);
      return NextResponse.redirect(failedUrl);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await ensureProfileRow(user);
    }
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
