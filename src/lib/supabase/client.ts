"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "@/lib/supabase/shared";

export const createSupabaseBrowserClient = () => {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey, {
    db: {
      schema: "public",
    },
  });
};
