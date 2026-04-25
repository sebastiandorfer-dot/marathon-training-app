-- Migration: Add coach onboarding fields to profiles table
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS current_weekly_km    integer,
  ADD COLUMN IF NOT EXISTS longest_recent_run_km integer,
  ADD COLUMN IF NOT EXISTS training_goal         text;

-- training_goal values: 'finish' | 'pb' | 'improve'
