import { Client } from "pg";

import { env } from "@/lib/env";

const APPOINTMENT_BOOTSTRAP_SQL = `
begin;

alter table public.appointments
  add column if not exists patient_preferred_at timestamptz,
  add column if not exists doctor_confirmation_link text,
  add column if not exists doctor_confirmation_token text,
  add column if not exists doctor_proposed_note text,
  add column if not exists doctor_proposed_at timestamptz,
  add column if not exists patient_response text not null default 'pending',
  add column if not exists patient_response_note text,
  add column if not exists patient_responded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_patient_response_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_patient_response_check
      check (patient_response in ('pending', 'accepted', 'declined', 'reschedule_requested'));
  end if;
end
$$;

update public.appointments
set patient_preferred_at = coalesce(patient_preferred_at, scheduled_at),
    patient_response = case
      when status in ('confirmed', 'completed') then 'accepted'
      else patient_response
    end
where patient_preferred_at is null
   or (status in ('confirmed', 'completed') and patient_response = 'pending');

create unique index if not exists idx_appointments_confirmation_token
  on public.appointments(doctor_confirmation_token)
  where doctor_confirmation_token is not null;

create index if not exists idx_appointments_patient_status_response
  on public.appointments(patient_id, status, patient_response, updated_at desc);

create index if not exists idx_appointments_doctor_status_response
  on public.appointments(doctor_id, status, patient_response, updated_at desc);

notify pgrst, 'reload schema';

commit;
`;

const getAppointmentConnectionString = () =>
  env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;

let hasBootstrappedAppointmentSchema = false;
let appointmentBootstrapPromise: Promise<void> | null = null;

const runAppointmentBootstrap = async () => {
  const connectionString = getAppointmentConnectionString();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING/POSTGRES_URL is required for appointment schema bootstrap.",
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
    await client.query(APPOINTMENT_BOOTSTRAP_SQL);
    hasBootstrappedAppointmentSchema = true;
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const ensureAppointmentSchema = async () => {
  if (hasBootstrappedAppointmentSchema) {
    return;
  }

  if (!appointmentBootstrapPromise) {
    appointmentBootstrapPromise = runAppointmentBootstrap().finally(() => {
      appointmentBootstrapPromise = null;
    });
  }

  await appointmentBootstrapPromise;
};

