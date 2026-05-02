begin;

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

commit;
