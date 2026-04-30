create table if not exists public.blood_pressure_readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  measured_at timestamptz not null default now(),
  systolic smallint not null check (systolic between 70 and 260),
  diastolic smallint not null check (diastolic between 40 and 160),
  pulse smallint check (pulse is null or pulse between 35 and 220),
  source text not null default 'ocr_camera' check (source in ('ocr_camera', 'ocr_upload', 'manual')),
  ocr_confidence numeric(4,3),
  ocr_text text,
  category text not null check (category in ('normal', 'elevated', 'high_stage_1', 'high_stage_2', 'hypertensive_crisis')),
  category_label_th text not null,
  trend_summary_th text not null,
  bmi_at_measurement numeric(5,2),
  bmi_trend_label text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_blood_pressure_readings_patient_measured
on public.blood_pressure_readings(patient_id, measured_at desc);

create index if not exists idx_blood_pressure_readings_created
on public.blood_pressure_readings(created_at desc);

alter table public.blood_pressure_readings enable row level security;

drop policy if exists "blood_pressure_readings_select_scope" on public.blood_pressure_readings;
create policy "blood_pressure_readings_select_scope"
on public.blood_pressure_readings
for select
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

drop policy if exists "blood_pressure_readings_insert_scope" on public.blood_pressure_readings;
create policy "blood_pressure_readings_insert_scope"
on public.blood_pressure_readings
for insert
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or (public.current_user_role() = 'doctor' and public.is_linked_patient(patient_id))
);

