alter table public.daily_checkins
  add column if not exists sleep_hours numeric check (sleep_hours between 0 and 24),
  add column if not exists exercise_minutes integer check (exercise_minutes between 0 and 1440);

create index if not exists daily_checkins_user_date_idx
  on public.daily_checkins(user_id, checkin_date desc);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
