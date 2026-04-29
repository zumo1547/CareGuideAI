alter table if exists public.reminder_events
  add column if not exists cancelled_at timestamptz;

alter table if exists public.reminder_events
  drop constraint if exists reminder_events_status_check;

alter table if exists public.reminder_events
  add constraint reminder_events_status_check
  check (status in ('pending', 'sent', 'failed', 'cancelled'));

create index if not exists idx_reminder_events_due_at
on public.reminder_events(due_at);

