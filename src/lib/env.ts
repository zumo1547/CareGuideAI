const optional = (name: string) => process.env[name];

const requiredPublic = (name: string) => process.env[name] ?? "";

export const env = {
  NEXT_PUBLIC_APP_NAME: optional("NEXT_PUBLIC_APP_NAME") ?? "CareGuideAI",
  NEXT_PUBLIC_APP_URL: optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: requiredPublic("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: optional("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  OPENFDA_API_BASE_URL:
    optional("OPENFDA_API_BASE_URL") ?? "https://api.fda.gov/drug/label.json",
  OPENFDA_API_KEY: optional("OPENFDA_API_KEY") ?? "",
  APP_TIMEZONE: optional("APP_TIMEZONE") ?? "Asia/Bangkok",
  CRON_SECRET: optional("CRON_SECRET") ?? "",
  TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID") ?? "",
  TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN") ?? "",
  TWILIO_FROM_PHONE: optional("TWILIO_FROM_PHONE") ?? "",
};

export const hasSupabasePublicConfig = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export const hasSupabaseServiceRole = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
