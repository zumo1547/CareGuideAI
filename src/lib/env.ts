export const env = {
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME ?? "CareGuideAI",
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    "",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "",
  OPENFDA_API_BASE_URL:
    process.env.OPENFDA_API_BASE_URL ?? "https://api.fda.gov/drug/label.json",
  OPENFDA_API_KEY: process.env.OPENFDA_API_KEY ?? "",
  APP_TIMEZONE: process.env.APP_TIMEZONE ?? "Asia/Bangkok",
  CRON_SECRET: process.env.CRON_SECRET ?? "",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? "",
  TWILIO_FROM_PHONE: process.env.TWILIO_FROM_PHONE ?? "",
  POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING ?? "",
  POSTGRES_URL: process.env.POSTGRES_URL ?? "",
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL ?? "",
  POSTGRES_HOST: process.env.POSTGRES_HOST ?? "",
  POSTGRES_USER: process.env.POSTGRES_USER ?? "",
  POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "",
  POSTGRES_DATABASE: process.env.POSTGRES_DATABASE ?? "postgres",
};

export const hasSupabasePublicConfig = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export const hasSupabaseServiceRole = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
