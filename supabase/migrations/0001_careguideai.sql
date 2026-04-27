create extension if not exists pgcrypto;

create type public.user_role as enum ('patient', 'doctor', 'admin');
create type public.reminder_channel as enum ('sms', 'voice');
create type public.appointment_status as enum ('pending', 'confirmed', 'completed');
create type public.adherence_status as enum ('scheduled', 'taken', 'missed');

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role public.user_role not null default 'patient',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.doctor_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email, status)
);

create table if not exists public.patient_doctor_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (patient_id, doctor_id)
);

create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  external_source text,
  external_id text,
  name text not null,
  generic_name text,
  dosage_form text,
  strength text,
  barcode text,
  instructions text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (external_source, external_id)
);

create table if not exists public.medication_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  medicine_id uuid not null references public.medicines(id) on delete restrict,
  prescribed_by uuid references public.profiles(id) on delete set null,
  dosage text not null,
  notes text,
  start_date date not null default current_date,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medication_schedule_times (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.medication_plans(id) on delete cascade,
  label text not null,
  time_of_day time not null,
  source text not null check (source in ('preset', 'custom')),
  created_at timestamptz not null default now(),
  unique (plan_id, label, time_of_day)
);

create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  medicine_id uuid references public.medicines(id) on delete set null,
  guidance_state text not null,
  matched_via text not null check (matched_via in ('barcode', 'ocr')),
  confidence numeric(4, 3),
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.adherence_logs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.medication_plans(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_for timestamptz not null,
  taken_at timestamptz,
  status public.adherence_status not null default 'scheduled',
  channel public.reminder_channel,
  notes text,
  created_at timestamptz not null default now(),
  unique (plan_id, scheduled_for)
);

create table if not exists public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.medication_plans(id) on delete cascade,
  channel public.reminder_channel not null,
  due_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider text not null default 'mock',
  provider_response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.doctor_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  subject text,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete set null,
  request_note text,
  scheduled_at timestamptz,
  status public.appointment_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_links_doctor on public.patient_doctor_links(doctor_id);
create index if not exists idx_links_patient on public.patient_doctor_links(patient_id);
create index if not exists idx_medicines_name on public.medicines(name);
create index if not exists idx_medicines_barcode on public.medicines(barcode);
create index if not exists idx_plans_patient on public.medication_plans(patient_id, is_active);
create index if not exists idx_schedule_plan on public.medication_schedule_times(plan_id);
create index if not exists idx_scan_patient on public.scan_sessions(patient_id, created_at desc);
create index if not exists idx_adherence_patient on public.adherence_logs(patient_id, scheduled_for desc);
create index if not exists idx_reminder_due on public.reminder_events(patient_id, due_at, status);
create index if not exists idx_messages_doctor on public.doctor_messages(doctor_id, created_at desc);
create index if not exists idx_appointments_doctor on public.appointments(doctor_id, created_at desc);

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() limit 1;
$$;

create or replace function public.is_linked_patient(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.patient_doctor_links pdl
    where pdl.patient_id = target_patient_id
      and pdl.doctor_id = auth.uid()
  );
$$;

create or replace function public.handle_profile_update_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_role public.user_role;
begin
  desired_role := case
    when coalesce(new.raw_user_meta_data ->> 'role', 'patient') = 'doctor' then 'doctor'::public.user_role
    when coalesce(new.raw_user_meta_data ->> 'role', 'patient') = 'admin' then 'admin'::public.user_role
    else 'patient'::public.user_role
  end;

  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    desired_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.handle_profile_update_timestamp();

drop trigger if exists plans_set_updated_at on public.medication_plans;
create trigger plans_set_updated_at
before update on public.medication_plans
for each row execute procedure public.handle_profile_update_timestamp();

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
before update on public.appointments
for each row execute procedure public.handle_profile_update_timestamp();

alter table public.profiles enable row level security;
alter table public.doctor_invites enable row level security;
alter table public.patient_doctor_links enable row level security;
alter table public.medicines enable row level security;
alter table public.medication_plans enable row level security;
alter table public.medication_schedule_times enable row level security;
alter table public.scan_sessions enable row level security;
alter table public.adherence_logs enable row level security;
alter table public.reminder_events enable row level security;
alter table public.doctor_messages enable row level security;
alter table public.appointments enable row level security;
alter table public.admin_audit_logs enable row level security;

create policy "profiles_select_self_or_admin_or_linked"
on public.profiles
for select
using (
  id = auth.uid()
  or public.current_user_role() = 'admin'
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(id))
);

create policy "profiles_insert_self"
on public.profiles
for insert
with check (id = auth.uid());

create policy "profiles_update_admin_only"
on public.profiles
for update
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "doctor_invites_admin_all"
on public.doctor_invites
for all
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "links_select_participants_or_admin"
on public.patient_doctor_links
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or doctor_id = auth.uid()
);

create policy "links_manage_admin_only"
on public.patient_doctor_links
for all
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "medicines_select_authenticated"
on public.medicines
for select
using (auth.uid() is not null);

create policy "medicines_insert_authenticated"
on public.medicines
for insert
with check (auth.uid() is not null);

create policy "medicines_update_admin_or_doctor"
on public.medicines
for update
using (public.current_user_role() in ('admin', 'doctor'))
with check (public.current_user_role() in ('admin', 'doctor'));

create policy "plans_select_scope"
on public.medication_plans
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "plans_insert_scope"
on public.medication_plans
for insert
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "plans_update_scope"
on public.medication_plans
for update
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
)
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "schedule_select_scope"
on public.medication_schedule_times
for select
using (
  exists (
    select 1 from public.medication_plans mp
    where mp.id = plan_id
      and (
        public.current_user_role() = 'admin'
        or mp.patient_id = auth.uid()
        or (public.current_user_role() = 'doctor' and public.is_linked_patient(mp.patient_id))
      )
  )
);

create policy "schedule_insert_scope"
on public.medication_schedule_times
for insert
with check (
  exists (
    select 1 from public.medication_plans mp
    where mp.id = plan_id
      and (
        public.current_user_role() = 'admin'
        or mp.patient_id = auth.uid()
        or (public.current_user_role() = 'doctor' and public.is_linked_patient(mp.patient_id))
      )
  )
);

create policy "scan_sessions_select_scope"
on public.scan_sessions
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "scan_sessions_insert_scope"
on public.scan_sessions
for insert
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "adherence_select_scope"
on public.adherence_logs
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "adherence_upsert_scope"
on public.adherence_logs
for all
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
)
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "reminder_select_scope"
on public.reminder_events
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
);

create policy "reminder_insert_scope"
on public.reminder_events
for insert
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

create policy "reminder_update_scope"
on public.reminder_events
for update
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
);

create policy "doctor_messages_scope"
on public.doctor_messages
for all
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or doctor_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or sender_id = auth.uid()
);

create policy "appointments_scope"
on public.appointments
for all
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or doctor_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or requested_by = auth.uid()
  or doctor_id = auth.uid()
);

create policy "admin_audit_logs_admin_only"
on public.admin_audit_logs
for all
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');
