-- ============================================================
-- Marathon Training App — Supabase Database Setup
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. PROFILES
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  level text check (level in ('beginner', 'intermediate', 'advanced')),
  target_pace_min integer,      -- minutes part of pace (e.g. 5 for 5:30)
  target_pace_sec integer,      -- seconds part of pace (e.g. 30 for 5:30)
  cross_training_sports text[], -- e.g. ['cycling', 'swimming']
  training_days integer[],      -- 0=Monday ... 6=Sunday
  marathon_date date,
  marathon_name text,
  context text,                 -- free-text athlete context
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);


-- 2. TRAINING PLANS
create table if not exists public.training_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  plan_data jsonb not null,     -- full 18-week plan as JSON
  created_at timestamptz default now(),
  unique(user_id)               -- one plan per user
);

alter table public.training_plans enable row level security;

create policy "Users can view own plan"
  on public.training_plans for select
  using (auth.uid() = user_id);

create policy "Users can insert own plan"
  on public.training_plans for insert
  with check (auth.uid() = user_id);

create policy "Users can update own plan"
  on public.training_plans for update
  using (auth.uid() = user_id);


-- 3. COMPLETED WORKOUTS (which plan workouts are checked off)
create table if not exists public.completed_workouts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_id text not null,     -- format: "w{week}-d{day_of_week}" e.g. "w3-d1"
  completed_at timestamptz default now(),
  unique(user_id, workout_id)
);

alter table public.completed_workouts enable row level security;

create policy "Users can view own completions"
  on public.completed_workouts for select
  using (auth.uid() = user_id);

create policy "Users can insert own completions"
  on public.completed_workouts for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own completions"
  on public.completed_workouts for delete
  using (auth.uid() = user_id);


-- 4. WORKOUT LOGS (athlete's actual training log)
create table if not exists public.workout_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  workout_date date not null,
  workout_type text not null,   -- easy, tempo, interval, long, recovery, cross, other
  distance_km numeric(6,2),
  duration_min numeric(6,1),
  avg_pace_min integer,         -- optional computed pace
  avg_pace_sec integer,
  notes text,
  plan_workout_id text,         -- optional reference to plan workout id
  logged_at timestamptz default now()
);

alter table public.workout_logs enable row level security;

create policy "Users can view own logs"
  on public.workout_logs for select
  using (auth.uid() = user_id);

create policy "Users can insert own logs"
  on public.workout_logs for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own logs"
  on public.workout_logs for delete
  using (auth.uid() = user_id);


-- 5. CHAT MESSAGES (AI Coach conversation history)
create table if not exists public.chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

alter table public.chat_messages enable row level security;

create policy "Users can view own messages"
  on public.chat_messages for select
  using (auth.uid() = user_id);

create policy "Users can insert own messages"
  on public.chat_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own messages"
  on public.chat_messages for delete
  using (auth.uid() = user_id);


-- 6. AUTO-UPDATE updated_at for profiles
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- ============================================================
-- MIGRATION: Training Mode + new profile columns
-- Run this if the tables already exist from a previous setup
-- ============================================================
alter table public.profiles
  add column if not exists training_mode text default 'race'
    check (training_mode in ('race', 'fitness', 'tracking')),
  add column if not exists target_weekly_km integer,
  add column if not exists sessions_per_week integer,
  add column if not exists schedule_since date,
  add column if not exists flexibility_mode text,
  add column if not exists blocked_days integer[],
  add column if not exists build_phase_schedule jsonb,
  add column if not exists selected_milestones text[];

-- MIGRATION: RPE (Rate of Perceived Exertion) für workout_logs
-- 1 = Leicht (easy), 2 = Gut (moderate), 3 = Hart (hard)
alter table public.workout_logs
  add column if not exists rpe integer check (rpe between 1 and 3);
