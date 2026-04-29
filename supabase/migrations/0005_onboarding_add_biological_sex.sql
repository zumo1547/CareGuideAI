do $$
begin
  create type public.biological_sex as enum ('female', 'male');
exception
  when duplicate_object then null;
end
$$;

alter table if exists public.user_onboarding_profiles
  add column if not exists biological_sex public.biological_sex;

update public.user_onboarding_profiles
set biological_sex = coalesce(biological_sex, 'female'::public.biological_sex)
where biological_sex is null;

alter table if exists public.user_onboarding_profiles
  alter column biological_sex set not null;

create index if not exists idx_user_onboarding_profiles_biological_sex
  on public.user_onboarding_profiles(biological_sex);
