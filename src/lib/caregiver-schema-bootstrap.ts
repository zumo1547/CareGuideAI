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

const CAREGIVER_SCHEMA_RELOAD_SQL = "notify pgrst, 'reload schema';";

const getConnectionString = () =>
  env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;

let hasBootstrappedCaregiverSchema = false;
let caregiverBootstrapPromise: Promise<void> | null = null;

const runCaregiverBootstrap = async () => {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL_NON_POOLING/POSTGRES_URL is required for caregiver schema bootstrap.",
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
    await client.query(CAREGIVER_ENUM_SQL);
    await client.query(CAREGIVER_HANDLE_NEW_USER_SQL);
    await client.query(CAREGIVER_SCHEMA_RELOAD_SQL);
    hasBootstrappedCaregiverSchema = true;
  } finally {
    await client.end().catch(() => undefined);
  }
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

