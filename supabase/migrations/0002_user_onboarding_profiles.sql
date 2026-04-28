do $$
begin
  create type public.disability_type as enum ('visual', 'hearing', 'mobility', 'intellectual', 'other');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.disability_severity as enum ('mild', 'moderate', 'severe');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.user_onboarding_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  disability_type public.disability_type not null,
  disability_other text,
  disability_severity public.disability_severity not null,
  chronic_conditions text not null,
  regular_medications text not null,
  drug_allergies text not null,
  baseline_blood_pressure text not null,
  baseline_blood_sugar text not null,
  weight_kg numeric(6,2) not null check (weight_kg >= 20 and weight_kg <= 300),
  height_cm numeric(6,2) not null check (height_cm >= 100 and height_cm <= 250),
  bmi numeric(5,2) not null check (bmi >= 8 and bmi <= 100),
  need_tts boolean not null default true,
  need_large_text boolean not null default true,
  need_large_buttons boolean not null default true,
  need_navigation_guidance boolean not null default true,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disability_other_required
    check (
      disability_type <> 'other'
      or (disability_other is not null and btrim(disability_other) <> '')
    )
);

create index if not exists idx_user_onboarding_profiles_severity
  on public.user_onboarding_profiles(disability_severity);
create index if not exists idx_user_onboarding_profiles_completed_at
  on public.user_onboarding_profiles(completed_at desc);

drop trigger if exists user_onboarding_profiles_set_updated_at on public.user_onboarding_profiles;
create trigger user_onboarding_profiles_set_updated_at
before update on public.user_onboarding_profiles
for each row execute procedure public.handle_profile_update_timestamp();

alter table public.user_onboarding_profiles enable row level security;

drop policy if exists "user_onboarding_profiles_select_scope" on public.user_onboarding_profiles;
create policy "user_onboarding_profiles_select_scope"
on public.user_onboarding_profiles
for select
using (
  user_id = auth.uid()
  or public.current_user_role() = 'admin'
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(user_id))
);

drop policy if exists "user_onboarding_profiles_insert_scope" on public.user_onboarding_profiles;
create policy "user_onboarding_profiles_insert_scope"
on public.user_onboarding_profiles
for insert
with check (
  user_id = auth.uid()
  or public.current_user_role() = 'admin'
);

drop policy if exists "user_onboarding_profiles_update_scope" on public.user_onboarding_profiles;
create policy "user_onboarding_profiles_update_scope"
on public.user_onboarding_profiles
for update
using (
  user_id = auth.uid()
  or public.current_user_role() = 'admin'
)
with check (
  user_id = auth.uid()
  or public.current_user_role() = 'admin'
);
