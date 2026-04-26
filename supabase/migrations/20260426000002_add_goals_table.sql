create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('race', 'distance', 'time')),
  title text not null,
  -- Race goal fields
  race_distance text,       -- '5km' | '10km' | 'half_marathon' | 'marathon'
  race_distance_km numeric,
  race_date date,
  -- Shared: target finish time in seconds (race & time goals)
  target_time_sec int,
  -- Distance goal: target distance in km
  target_distance_km numeric,
  -- Status
  status text default 'active' check (status in ('active', 'achieved', 'abandoned')),
  achieved_at timestamptz,
  notes text,
  created_at timestamptz default now()
);

alter table goals enable row level security;

create policy "Users can manage own goals"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
