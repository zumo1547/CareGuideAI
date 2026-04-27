import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { getSupabasePublicEnv } from "@/lib/supabase/shared";

export const createSupabaseAdminClient = () => {
  const { url } = getSupabasePublicEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin operations.");
  }

  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
