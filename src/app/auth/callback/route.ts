import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}

