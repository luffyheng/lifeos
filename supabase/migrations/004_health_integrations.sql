create table if not exists public.health_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('strava','huawei_health','chat')),
  external_id text,
  sport_type text,
  name text,
  started_at timestamptz not null,
  duration_minutes numeric,
  moving_minutes numeric,
  distance_km numeric,
  calories numeric,
  average_heart_rate numeric,
  max_heart_rate numeric,
  elevation_gain numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source, external_id)
);

create table if not exists public.health_sleep (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('huawei_health','chat')),
  sleep_date date not null,
  duration_hours numeric,
  deep_sleep_minutes numeric,
  light_sleep_minutes numeric,
  rem_sleep_minutes numeric,
  awake_minutes numeric,
  sleep_score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source, sleep_date)
);

create index if not exists health_activities_user_time_idx on public.health_activities(user_id, started_at desc);
create index if not exists health_sleep_user_date_idx on public.health_sleep(user_id, sleep_date desc);

alter table public.health_activities enable row level security;
alter table public.health_sleep enable row level security;
create policy "own health activities" on public.health_activities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own health sleep" on public.health_sleep for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.health_activities, public.health_sleep to authenticated;
