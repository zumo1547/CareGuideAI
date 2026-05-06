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

const CAREGIVER_TABLES_AND_POLICIES_SQL = `
create extension if not exists pgcrypto;

create table if not exists public.caregiver_patient_links (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (caregiver_id, patient_id)
);

create index if not exists idx_caregiver_links_caregiver
  on public.caregiver_patient_links(caregiver_id, created_at desc);
create index if not exists idx_caregiver_links_patient
  on public.caregiver_patient_links(patient_id, created_at desc);

create table if not exists public.caregiver_daily_routines (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  routine_date date not null default current_date,
  time_slot text not null check (time_slot in ('morning', 'noon', 'evening', 'night', 'custom')),
  time_text text,
  task_text text not null check (char_length(btrim(task_text)) > 0),
  is_done boolean not null default false,
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_caregiver_routines_scope
  on public.caregiver_daily_routines(caregiver_id, patient_id, routine_date);
create index if not exists idx_caregiver_routines_patient_date
  on public.caregiver_daily_routines(patient_id, routine_date, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_profile_update_timestamp'
      and n.nspname = 'public'
  ) then
    drop trigger if exists caregiver_daily_routines_set_updated_at on public.caregiver_daily_routines;
    create trigger caregiver_daily_routines_set_updated_at
    before update on public.caregiver_daily_routines
    for each row execute procedure public.handle_profile_update_timestamp();
  end if;
end
$$;

create or replace function public.is_linked_caregiver(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.caregiver_patient_links cpl
    where cpl.patient_id = target_patient_id
      and cpl.caregiver_id = auth.uid()
  );
$$;

alter table public.caregiver_patient_links enable row level security;
alter table public.caregiver_daily_routines enable row level security;

drop policy if exists "caregiver_links_select_scope" on public.caregiver_patient_links;
create policy "caregiver_links_select_scope"
on public.caregiver_patient_links
for select
using (
  public.current_user_role()::text = 'admin'
  or caregiver_id = auth.uid()
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
);

drop policy if exists "caregiver_links_insert_scope" on public.caregiver_patient_links;
create policy "caregiver_links_insert_scope"
on public.caregiver_patient_links
for insert
with check (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
  )
);

drop policy if exists "caregiver_links_delete_scope" on public.caregiver_patient_links;
create policy "caregiver_links_delete_scope"
on public.caregiver_patient_links
for delete
using (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
  )
);

drop policy if exists "caregiver_routines_select_scope" on public.caregiver_daily_routines;
create policy "caregiver_routines_select_scope"
on public.caregiver_daily_routines
for select
using (
  public.current_user_role()::text = 'admin'
  or caregiver_id = auth.uid()
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
);

drop policy if exists "caregiver_routines_insert_scope" on public.caregiver_daily_routines;
create policy "caregiver_routines_insert_scope"
on public.caregiver_daily_routines
for insert
with check (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
    and public.is_linked_caregiver(patient_id)
  )
);

drop policy if exists "caregiver_routines_update_scope" on public.caregiver_daily_routines;
create policy "caregiver_routines_update_scope"
on public.caregiver_daily_routines
for update
using (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
    and public.is_linked_caregiver(patient_id)
  )
  or patient_id = auth.uid()
)
with check (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
    and public.is_linked_caregiver(patient_id)
  )
  or patient_id = auth.uid()
);

drop policy if exists "caregiver_routines_delete_scope" on public.caregiver_daily_routines;
create policy "caregiver_routines_delete_scope"
on public.caregiver_daily_routines
for delete
using (
  public.current_user_role()::text = 'admin'
  or (
    public.current_user_role()::text = 'caregiver'
    and caregiver_id = auth.uid()
    and public.is_linked_caregiver(patient_id)
  )
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on public.caregiver_patient_links to authenticated;
    grant select, insert, update, delete on public.caregiver_daily_routines to authenticated;
    grant execute on function public.is_linked_caregiver(uuid) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant select, insert, update, delete on public.caregiver_patient_links to service_role;
    grant select, insert, update, delete on public.caregiver_daily_routines to service_role;
    grant execute on function public.is_linked_caregiver(uuid) to service_role;
  end if;
end
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
      await client.query(CAREGIVER_TABLES_AND_POLICIES_SQL);
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
  };
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
