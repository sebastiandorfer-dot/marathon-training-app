-- Add actual race finish time to goals (for recording real race results)
ALTER TABLE goals ADD COLUMN IF NOT EXISTS actual_time_sec int;

-- Add personal records to profiles (JSON: {pr_5k, pr_10k, pr_half, pr_marathon})
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS personal_records jsonb DEFAULT '{}';
