import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/supabase/shared";

const copyCookiesAndHeaders = (from: NextResponse, to: NextResponse) => {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value, {
      domain: cookie.domain,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      maxAge: cookie.maxAge,
      path: cookie.path,
      priority: cookie.priority,
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      partitioned: cookie.partitioned,
    });
  });

  from.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    to.headers.set(key, value);
  });

  return to;
};

export const createSupabaseMiddlewareClient = (request: NextRequest) => {
  const { url, anonKey } = getSupabasePublicEnv();
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(url, anonKey, {
    db: {
      schema: "public",
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  return {
    supabase,
    getResponse() {
      return response;
    },
    withResponseState(targetResponse: NextResponse) {
      return copyCookiesAndHeaders(response, targetResponse);
    },
  };
};
