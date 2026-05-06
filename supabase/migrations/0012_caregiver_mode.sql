-- Caregiver mode:
-- - add new role: caregiver
-- - add caregiver<>patient link table
-- - add caregiver daily routines table
-- - extend RLS so caregiver can read/write patient care data only for linked patients

do $$
begin
  begin
    alter type public.user_role add value if not exists 'caregiver';
  exception
    when duplicate_object then null;
  end;
end
$$;

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

drop trigger if exists caregiver_daily_routines_set_updated_at on public.caregiver_daily_routines;
create trigger caregiver_daily_routines_set_updated_at
before update on public.caregiver_daily_routines
for each row execute procedure public.handle_profile_update_timestamp();

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
  on conflict (id) do nothing;

  return new;
end;
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

drop policy if exists "profiles_select_self_or_admin_or_linked" on public.profiles;
create policy "profiles_select_self_or_admin_or_linked"
on public.profiles
for select
using (
  id = auth.uid()
  or public.current_user_role()::text = 'admin'
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(id))
  or (public.current_user_role()::text = 'patient' and role::text in ('doctor', 'caregiver'))
);

drop policy if exists "plans_select_scope" on public.medication_plans;
create policy "plans_select_scope"
on public.medication_plans
for select
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "plans_insert_scope" on public.medication_plans;
create policy "plans_insert_scope"
on public.medication_plans
for insert
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "plans_update_scope" on public.medication_plans;
create policy "plans_update_scope"
on public.medication_plans
for update
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
)
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "schedule_select_scope" on public.medication_schedule_times;
create policy "schedule_select_scope"
on public.medication_schedule_times
for select
using (
  exists (
    select 1 from public.medication_plans mp
    where mp.id = plan_id
      and (
        public.current_user_role()::text = 'admin'
        or mp.patient_id = auth.uid()
        or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(mp.patient_id))
        or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(mp.patient_id))
      )
  )
);

drop policy if exists "schedule_insert_scope" on public.medication_schedule_times;
create policy "schedule_insert_scope"
on public.medication_schedule_times
for insert
with check (
  exists (
    select 1 from public.medication_plans mp
    where mp.id = plan_id
      and (
        public.current_user_role()::text = 'admin'
        or mp.patient_id = auth.uid()
        or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(mp.patient_id))
        or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(mp.patient_id))
      )
  )
);

drop policy if exists "scan_sessions_select_scope" on public.scan_sessions;
create policy "scan_sessions_select_scope"
on public.scan_sessions
for select
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "scan_sessions_insert_scope" on public.scan_sessions;
create policy "scan_sessions_insert_scope"
on public.scan_sessions
for insert
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "adherence_select_scope" on public.adherence_logs;
create policy "adherence_select_scope"
on public.adherence_logs
for select
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "adherence_upsert_scope" on public.adherence_logs;
create policy "adherence_upsert_scope"
on public.adherence_logs
for all
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
)
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "reminder_select_scope" on public.reminder_events;
create policy "reminder_select_scope"
on public.reminder_events
for select
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "reminder_insert_scope" on public.reminder_events;
create policy "reminder_insert_scope"
on public.reminder_events
for insert
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "reminder_update_scope" on public.reminder_events;
create policy "reminder_update_scope"
on public.reminder_events
for update
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
)
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "appointments_scope" on public.appointments;
create policy "appointments_scope"
on public.appointments
for all
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or doctor_id = auth.uid()
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
)
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or requested_by = auth.uid()
  or doctor_id = auth.uid()
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "user_onboarding_profiles_select_scope" on public.user_onboarding_profiles;
create policy "user_onboarding_profiles_select_scope"
on public.user_onboarding_profiles
for select
using (
  user_id = auth.uid()
  or public.current_user_role()::text = 'admin'
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(user_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(user_id))
);

drop policy if exists "blood_pressure_readings_select_scope" on public.blood_pressure_readings;
create policy "blood_pressure_readings_select_scope"
on public.blood_pressure_readings
for select
using (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

drop policy if exists "blood_pressure_readings_insert_scope" on public.blood_pressure_readings;
create policy "blood_pressure_readings_insert_scope"
on public.blood_pressure_readings
for insert
with check (
  public.current_user_role()::text = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role()::text = 'doctor' and public.is_linked_patient(patient_id))
  or (public.current_user_role()::text = 'caregiver' and public.is_linked_caregiver(patient_id))
);

notify pgrst, 'reload schema';

