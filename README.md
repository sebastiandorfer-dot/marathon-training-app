# Marathon AI Coach

A professional marathon training web app powered by Claude AI.

## Features
- 5-step onboarding (level, pace, cross-training, schedule, context)
- AI-generated 18-week training plan (Claude claude-sonnet-4-20250514)
- Plan tab with weekly view + workout completion tracking
- Today tab with daily workout display + workout logger
- AI Coach tab with streaming chat (full context-aware)
- Profile tab with editable context, stats, and activity log

## Setup

### 1. Environment Variables
Copy `.env.example` to `.env` and fill in your keys:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ANTHROPIC_API_KEY=sk-ant-your-key
```

### 2. Supabase Database
Run `supabase-setup.sql` in your Supabase SQL Editor.
This creates: `profiles`, `training_plans`, `completed_workouts`, `workout_logs`, `chat_messages`.

Also enable **Email auth** in Supabase → Authentication → Providers.

### 3. Install & Run
```bash
npm install
npm run dev
```

## Tech Stack
- React 18 + Vite
- @supabase/supabase-js v2
- Plain CSS (dark theme, CSS variables, no framework)
- Anthropic API direct from browser (`anthropic-dangerous-direct-browser-access: true`)
- Model: `claude-sonnet-4-20250514`
