do $$
begin
  alter type public.disability_type add value if not exists 'normal';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.disability_severity add value if not exists 'none';
exception
  when duplicate_object then null;
end
$$;

alter table public.user_onboarding_profiles
  drop constraint if exists disability_severity_consistency;

alter table public.user_onboarding_profiles
  add constraint disability_severity_consistency
  check (
    (disability_type = 'normal' and disability_severity = 'none')
    or (disability_type <> 'normal' and disability_severity <> 'none')
  );
