import { Client } from "pg";

import { env } from "@/lib/env";

const CAREGIVER_ENUM_SQL = `
do $$
begin
  begin
    alter type public.user_role add value if not exists 'caregiver';
  exception
    when duplicate_object then null;
  end;
end
$$;
`;

const CAREGIVER_HANDLE_NEW_USER_SQL = `
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role_text text;
  desired_role public.user_role;
begin
  desired_role_text := lower(coalesce(new.raw_user_meta_data ->> 'role', 'patient'));
  if desired_role_text not in ('patient', 'caregiver', 'doctor', 'admin') then
    desired_role_text := 'patient';
  end if;

  desired_role := desired_role_text::public.user_role;

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    desired_role
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        role = excluded.role;

  return new;
end;
$$;
`;

const CAREGIVER_SCHEMA_RELOAD_SQL = "notify pgrst, 'reload schema';";

const parseProjectRefFromSupabaseUrl = (url: string) => {
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co$/i);
  return match?.[1] ?? "";
};

const parseProjectRefFromPgConnection = (connectionString: string) => {
  const match = connectionString.match(/postgres\.([a-z0-9-]+):/i);
  if (match?.[1]) return match[1];
  const hostMatch = connectionString.match(/@([^:/?]+)/);
  const host = hostMatch?.[1] ?? "";
  const refMatch = host.match(/(?:db|aws-[^.]*)\.([a-z0-9-]+)\.supabase\.com/i);
  return refMatch?.[1] ?? "";
};

const withNoVerifySslMode = (connectionString: string) =>
  connectionString.includes("?")
    ? `${connectionString}&sslmode=no-verify`
    : `${connectionString}?sslmode=no-verify`;

const buildConnectionCandidates = () => {
  const candidates = [
    env.POSTGRES_URL_NON_POOLING,
    env.POSTGRES_URL,
    env.POSTGRES_PRISMA_URL,
  ].filter(Boolean);

  if (env.POSTGRES_HOST && env.POSTGRES_USER && env.POSTGRES_PASSWORD) {
    const hostConn = `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(
      env.POSTGRES_PASSWORD,
    )}@${env.POSTGRES_HOST}:5432/${encodeURIComponent(env.POSTGRES_DATABASE || "postgres")}`;
    candidates.push(hostConn);
  }

  const supabaseRef = parseProjectRefFromSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const prioritized = candidates
    .map((value) => withNoVerifySslMode(value))
    .sort((a, b) => {
      const aRef = parseProjectRefFromPgConnection(a);
      const bRef = parseProjectRefFromPgConnection(b);
      const aScore = aRef && aRef === supabaseRef ? 1 : 0;
      const bScore = bRef && bRef === supabaseRef ? 1 : 0;
      return bScore - aScore;
    });

  return { candidates: prioritized, supabaseRef };
};

let hasBootstrappedCaregiverSchema = false;
let caregiverBootstrapPromise: Promise<void> | null = null;

const runCaregiverBootstrap = async () => {
  const { candidates, supabaseRef } = buildConnectionCandidates();
  if (candidates.length === 0) {
    throw new Error("Missing Postgres connection env for caregiver schema bootstrap.");
  }

  let lastError: Error | null = null;
  for (const connectionString of candidates) {
    const client = new Client({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    try {
      await client.connect();
      await client.query(CAREGIVER_ENUM_SQL);
      await client.query(CAREGIVER_HANDLE_NEW_USER_SQL);
      await client.query(CAREGIVER_SCHEMA_RELOAD_SQL);
      hasBootstrappedCaregiverSchema = true;
      await client.end().catch(() => undefined);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown bootstrap error");
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  const hints: string[] = [];
  if (supabaseRef) {
    hints.push(`supabase_ref=${supabaseRef}`);
  }
  if (env.POSTGRES_URL || env.POSTGRES_URL_NON_POOLING || env.POSTGRES_PRISMA_URL) {
    const pgRefs = [env.POSTGRES_URL_NON_POOLING, env.POSTGRES_URL, env.POSTGRES_PRISMA_URL]
      .filter(Boolean)
      .map((value) => parseProjectRefFromPgConnection(value))
      .filter(Boolean);
    if (pgRefs.length > 0) {
      hints.push(`postgres_ref=${pgRefs.join(",")}`);
    }
  }

  const hintText = hints.length ? ` (${hints.join(" | ")})` : "";
  throw new Error(`Caregiver schema bootstrap failed${hintText}: ${lastError?.message ?? "unknown error"}`);
};

export const getCaregiverSchemaDiagnostics = () => {
  const { candidates, supabaseRef } = buildConnectionCandidates();
  const pgRefs = candidates.map((value) => parseProjectRefFromPgConnection(value)).filter(Boolean);
  return {
    supabaseRef,
    postgresRefs: pgRefs,
    hasConnectionCandidates: candidates.length > 0,
    hasRefMismatch:
      Boolean(supabaseRef) &&
      pgRefs.length > 0 &&
      pgRefs.every((ref) => ref !== supabaseRef),
  }
};

export const ensureCaregiverSchema = async () => {
  if (hasBootstrappedCaregiverSchema) {
    return;
  }

  if (!caregiverBootstrapPromise) {
    caregiverBootstrapPromise = runCaregiverBootstrap().finally(() => {
      caregiverBootstrapPromise = null;
    });
  }

  await caregiverBootstrapPromise;
};
