import { Client } from "pg";

import { env } from "@/lib/env";

const SUPPORT_CASE_BOOTSTRAP_SQL = `
begin;

create extension if not exists pgcrypto;

create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  requested_doctor_id uuid not null references public.profiles(id) on delete restrict,
  assigned_doctor_id uuid references public.profiles(id) on delete set null,
  request_message text not null,
  constraint support_cases_request_message_required
    check (char_length(btrim(request_message)) > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'closed')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  constraint support_case_messages_message_required
    check (char_length(btrim(message)) > 0)
);

create index if not exists idx_support_cases_patient_status
  on public.support_cases(patient_id, status, updated_at desc);
create index if not exists idx_support_cases_requested_doctor_status
  on public.support_cases(requested_doctor_id, status, updated_at desc);
create index if not exists idx_support_cases_assigned_doctor_status
  on public.support_cases(assigned_doctor_id, status, updated_at desc);
create index if not exists idx_support_cases_status_updated
  on public.support_cases(status, updated_at desc);
create index if not exists idx_support_case_messages_case_created
  on public.support_case_messages(case_id, created_at asc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'handle_profile_update_timestamp'
      and n.nspname = 'public'
  ) then
    drop trigger if exists support_cases_set_updated_at on public.support_cases;
    create trigger support_cases_set_updated_at
    before update on public.support_cases
    for each row execute procedure public.handle_profile_update_timestamp();
  end if;
end
$$;

alter table public.support_cases enable row level security;
alter table public.support_case_messages enable row level security;

drop policy if exists "profiles_select_self_or_admin_or_linked" on public.profiles;
create policy "profiles_select_self_or_admin_or_linked"
on public.profiles
for select
using (
  id = auth.uid()
  or public.current_user_role() = 'admin'
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(id))
  or (public.current_user_role() = 'patient' and role = 'doctor')
);

drop policy if exists "support_cases_select_scope" on public.support_cases;
create policy "support_cases_select_scope"
on public.support_cases
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or requested_doctor_id = auth.uid()
  or assigned_doctor_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

drop policy if exists "support_cases_insert_scope" on public.support_cases;
create policy "support_cases_insert_scope"
on public.support_cases
for insert
with check (
  public.current_user_role() = 'admin'
  or (
    public.current_user_role() = 'patient'
    and patient_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = requested_doctor_id
        and p.role = 'doctor'
    )
  )
);

drop policy if exists "support_cases_update_scope" on public.support_cases;
create policy "support_cases_update_scope"
on public.support_cases
for update
using (
  public.current_user_role() = 'admin'
  or requested_doctor_id = auth.uid()
  or assigned_doctor_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or requested_doctor_id = auth.uid()
  or assigned_doctor_id = auth.uid()
);

drop policy if exists "support_case_messages_select_scope" on public.support_case_messages;
create policy "support_case_messages_select_scope"
on public.support_case_messages
for select
using (
  exists (
    select 1
    from public.support_cases sc
    where sc.id = case_id
      and (
        public.current_user_role() = 'admin'
        or sc.patient_id = auth.uid()
        or sc.requested_doctor_id = auth.uid()
        or sc.assigned_doctor_id = auth.uid()
      )
  )
);

drop policy if exists "support_case_messages_insert_scope" on public.support_case_messages;
create policy "support_case_messages_insert_scope"
on public.support_case_messages
for insert
with check (
  sender_id = auth.uid()
  and exists (
    select 1
    from public.support_cases sc
    where sc.id = case_id
      and (
        public.current_user_role() = 'admin'
        or sc.patient_id = auth.uid()
        or sc.requested_doctor_id = auth.uid()
        or sc.assigned_doctor_id = auth.uid()
      )
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'support_cases'
    ) then
      alter publication supabase_realtime add table public.support_cases;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'support_case_messages'
    ) then
      alter publication supabase_realtime add table public.support_case_messages;
    end if;
  end if;
exception
  when insufficient_privilege then
    null;
  when undefined_object then
    null;
end
$$;

notify pgrst, 'reload schema';

commit;
`;

const getSupportChatConnectionString = () =>
  env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;

let hasBootstrappedSupportChatSchema = false;
let bootstrapPromise: Promise<void> | null = null;

const runSupportCaseBootstrap = async () => {
  const connectionString = getSupportChatConnectionString();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING/POSTGRES_URL is required for support chat schema bootstrap.",
    );
  }

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    await client.query(SUPPORT_CASE_BOOTSTRAP_SQL);
    hasBootstrappedSupportChatSchema = true;
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const ensureSupportCaseSchema = async () => {
  if (hasBootstrappedSupportChatSchema) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = runSupportCaseBootstrap().finally(() => {
      bootstrapPromise = null;
    });
  }

  await bootstrapPromise;
};
