alter table if exists public.medication_plans
  add column if not exists medication_type text;

update public.medication_plans
set medication_type = coalesce(medication_type, 'prescription');

alter table if exists public.medication_plans
  alter column medication_type set default 'prescription';

alter table if exists public.medication_plans
  drop constraint if exists medication_plans_medication_type_check;

alter table if exists public.medication_plans
  add constraint medication_plans_medication_type_check
  check (medication_type in ('prescription', 'otc'));

alter table if exists public.medication_plans
  alter column medication_type set not null;

alter table if exists public.medication_plans
  add column if not exists doctor_ordered_detected boolean,
  add column if not exists total_pills integer,
  add column if not exists remaining_pills numeric(10,2),
  add column if not exists pills_per_dose numeric(8,2),
  add column if not exists reminder_mode text,
  add column if not exists reminder_until_date date,
  add column if not exists exhausted_at timestamptz;

update public.medication_plans
set pills_per_dose = coalesce(pills_per_dose, 1),
    reminder_mode = coalesce(reminder_mode, 'until_date');

alter table if exists public.medication_plans
  alter column pills_per_dose set default 1,
  alter column pills_per_dose set not null,
  alter column reminder_mode set default 'until_date',
  alter column reminder_mode set not null;

alter table if exists public.medication_plans
  drop constraint if exists medication_plans_pills_per_dose_check;

alter table if exists public.medication_plans
  add constraint medication_plans_pills_per_dose_check
  check (pills_per_dose > 0);

alter table if exists public.medication_plans
  drop constraint if exists medication_plans_reminder_mode_check;

alter table if exists public.medication_plans
  add constraint medication_plans_reminder_mode_check
  check (reminder_mode in ('until_exhausted', 'until_date'));

update public.medication_plans
set remaining_pills = total_pills
where remaining_pills is null
  and total_pills is not null;

create index if not exists idx_medication_plans_reminder_mode
on public.medication_plans(reminder_mode, is_active);

create index if not exists idx_medication_plans_remaining_pills
on public.medication_plans(remaining_pills)
where remaining_pills is not null;
