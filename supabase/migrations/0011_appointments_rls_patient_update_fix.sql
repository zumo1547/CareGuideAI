-- Fix appointments RLS so patients can respond/cancel doctor-created appointments.
-- Root cause:
--   Existing WITH CHECK policy only allowed requested_by/doctor/admin.
--   For doctor-created appointments, requested_by = doctor, so patient updates were blocked.

drop policy if exists appointments_scope on public.appointments;

create policy appointments_scope
on public.appointments
for all
using (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or doctor_id = auth.uid()
)
with check (
  public.current_user_role() = 'admin'
  or patient_id = auth.uid()
  or requested_by = auth.uid()
  or doctor_id = auth.uid()
);

notify pgrst, 'reload schema';
