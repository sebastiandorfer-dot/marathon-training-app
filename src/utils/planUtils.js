// ============================================================
// Plan Utility Functions
// ============================================================

export const DAYS_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
export const DAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

/** 18 weeks in days */
const RACE_PLAN_DAYS = 18 * 7

/**
 * Returns true if the marathon is more than 18 weeks away (= Aufbauphase)
 */
export function isInBuildPhase(marathonDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const race = new Date(marathonDate)
  race.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((race - today) / (1000 * 60 * 60 * 24))
  return daysLeft > RACE_PLAN_DAYS
}

/**
 * Days until the 18-week race plan should start
 */
export function daysUntilRacePlan(marathonDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const race = new Date(marathonDate)
  race.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((race - today) / (1000 * 60 * 60 * 24))
  return Math.max(0, daysLeft - RACE_PLAN_DAYS)
}

/**
 * Get the Monday of the week containing `date` (Mon=0 index convention)
 * Exported so buildPhaseUtils can import it instead of maintaining a duplicate.
 */
export function getMondayOf(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + diff)
  return d
}
// Internal alias for backward-compat within this file
const getMondayOfWeek = getMondayOf

/**
 * Calculate total plan weeks from today to marathon (min 4, max 52)
 */
export function getTotalPlanWeeks(marathonDate) {
  const todayMonday = getMondayOfWeek(new Date())
  const marathonMonday = getMondayOfWeek(new Date(marathonDate))
  const weeks = Math.round((marathonMonday - todayMonday) / (1000 * 60 * 60 * 24 * 7))
  return Math.max(4, Math.min(52, weeks))
}

/**
 * Calculate the plan start date (Monday of week 1) — always starts from today's week
 */
export function getPlanStartDate(marathonDate) {
  const totalWeeks = getTotalPlanWeeks(marathonDate)
  const marathonMonday = getMondayOfWeek(new Date(marathonDate))
  const planStart = new Date(marathonMonday)
  planStart.setDate(marathonMonday.getDate() - (totalWeeks - 1) * 7)
  return planStart
}

/**
 * Given today and the marathon date, return current week and day_of_week (0=Mon..6=Sun)
 */
export function getCurrentPlanPosition(marathonDate) {
  const planStart = getPlanStartDate(marathonDate)
  const totalWeeks = getTotalPlanWeeks(marathonDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const daysSinceStart = Math.floor((today - planStart) / (1000 * 60 * 60 * 24))

  if (daysSinceStart < 0) {
    return { status: 'not_started', daysUntilStart: -daysSinceStart, totalWeeks }
  }

  const week = Math.floor(daysSinceStart / 7) + 1
  const dayOfWeek = daysSinceStart % 7

  if (week > totalWeeks) {
    return { status: 'finished', week: totalWeeks + 1, totalWeeks }
  }

  return { status: 'active', week, dayOfWeek, totalWeeks }
}

/**
 * Find today's workout from the plan
 */
export function getTodayWorkout(plan, marathonDate) {
  if (!plan?.weeks) return null
  const pos = getCurrentPlanPosition(marathonDate)
  if (pos.status !== 'active') return null

  const weekData = plan.weeks.find(w => w.week === pos.week)
  if (!weekData) return null

  return weekData.workouts?.find(w => w.day_of_week === pos.dayOfWeek) || null
}

/**
 * Find the next upcoming workout (today or future) in the plan
 */
export function getNextWorkout(plan, marathonDate, completedWorkoutIds = []) {
  if (!plan?.weeks) return null
  const planStart = getPlanStartDate(marathonDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Find first incomplete workout from today onwards
  for (const week of plan.weeks) {
    for (const workout of (week.workouts || [])) {
      if (workout.type === 'rest') continue
      const workoutDate = new Date(planStart)
      workoutDate.setDate(planStart.getDate() + (week.week - 1) * 7 + workout.day_of_week)

      if (workoutDate >= today && !completedWorkoutIds.includes(workout.id)) {
        return { workout, week: week.week, workoutDate }
      }
    }
  }
  return null
}

/**
 * Get absolute date for a workout
 */
export function getWorkoutDate(marathonDate, weekNumber, dayOfWeek) {
  const planStart = getPlanStartDate(marathonDate)
  const date = new Date(planStart)
  date.setDate(planStart.getDate() + (weekNumber - 1) * 7 + dayOfWeek)
  return date
}

/**
 * Format workout type as readable label
 */
export function formatWorkoutType(type) {
  const map = {
    easy: 'Easy Run',
    tempo: 'Tempo Run',
    interval: 'Intervals',
    long: 'Long Run',
    recovery: 'Recovery',
    cross: 'Cross-Training',
    rest: 'Rest Day',
  }
  return map[type] || type
}

/**
 * Format pace min:sec
 */
export function formatPace(min, sec) {
  return `${min}:${String(sec).padStart(2, '0')}`
}

/**
 * Format duration in minutes to h:mm or mm min
 */
export function formatDuration(minutes) {
  if (!minutes) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

/**
 * Format distance
 */
export function formatDistance(km) {
  if (!km) return '—'
  return `${km} km`
}

/**
 * Days until marathon
 */
export function daysUntilMarathon(marathonDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const marathon = new Date(marathonDate)
  marathon.setHours(0, 0, 0, 0)
  return Math.ceil((marathon - today) / (1000 * 60 * 60 * 24))
}

/**
 * Calculate plan completion percentage
 */
export function planCompletionPct(plan, completedIds) {
  if (!plan?.weeks || !completedIds) return 0
  let total = 0, done = 0
  for (const week of plan.weeks) {
    for (const w of (week.workouts || [])) {
      if (w.type !== 'rest') {
        total++
        if (completedIds.includes(w.id)) done++
      }
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

/**
 * Generate the training plan via Claude API.
 *
 * @param {object} profile - User profile from Supabase
 * @param {object} [options]
 * @param {number|null} [options.overridePaceSec] - If provided (seconds/km), use this as target
 *   pace instead of the profile's stored pace. Used when calibrating the race plan with the
 *   user's actual fitness measured during the build phase.
 */
export async function generateTrainingPlan(profile, options = {}) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Anthropic API key not configured.')

  const availableDays   = profile.training_days || []
  const blockedDays     = profile.blocked_days  || []
  const activeDays      = availableDays.filter(d => !blockedDays.includes(d)).sort()

  // Respect sessions_per_week: pick the best N days from available days.
  // Always keep the last available day for the long run.
  // Distribute remaining sessions as evenly as possible across the week.
  const desiredSessions = Math.min(
    profile.sessions_per_week ?? activeDays.length,
    activeDays.length
  )

  let planDays = activeDays
  if (desiredSessions < activeDays.length) {
    // Always include the last day (long run anchor)
    const lastDay   = activeDays[activeDays.length - 1]
    const remaining = activeDays.slice(0, -1) // all except last

    // Pick (desiredSessions - 1) most evenly spaced days from remaining
    const needed = desiredSessions - 1
    const selected = []
    if (needed >= remaining.length) {
      selected.push(...remaining)
    } else {
      // Even spacing: pick indices at roughly equal intervals
      for (let i = 0; i < needed; i++) {
        const idx = Math.round(i * (remaining.length - 1) / Math.max(needed - 1, 1))
        selected.push(remaining[idx])
      }
    }
    planDays = [...new Set([...selected, lastDay])].sort()
  }

  const daysStr    = planDays.map(d => DAYS_FULL[d]).join(', ')
  const allDaysStr = activeDays.map(d => DAYS_FULL[d]).join(', ')

  // Use override pace if provided (calibrated from Strava/VO2max), otherwise stored goal
  let paceStr
  if (options.overridePaceSec) {
    const overrideMin = Math.floor(options.overridePaceSec / 60)
    const overrideSec = Math.round(options.overridePaceSec % 60)
    paceStr = `${overrideMin}:${String(overrideSec).padStart(2, '0')} min/km`
  } else {
    paceStr = `${profile.target_pace_min}:${String(profile.target_pace_sec).padStart(2, '0')} min/km`
  }
  const marathonDateStr = new Date(profile.marathon_date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const totalWeeks    = getTotalPlanWeeks(profile.marathon_date)
  const generatedWeeks = Math.min(totalWeeks, 26)
  const isLongPlan    = totalWeeks > 26

  const sessionsNote  = desiredSessions < activeDays.length
    ? `\n- Available days (not all used): ${allDaysStr} — athlete wants only ${desiredSessions} sessions/week`
    : ''

  let periodization
  if (generatedWeeks <= 18) {
    periodization = `Weeks 1-${Math.round(generatedWeeks*0.33)} base building, Weeks ${Math.round(generatedWeeks*0.33)+1}-${Math.round(generatedWeeks*0.67)} build/speed, Weeks ${Math.round(generatedWeeks*0.67)+1}-${generatedWeeks-2} peak, last 2 weeks taper with marathon in week ${generatedWeeks}`
  } else {
    periodization = `Weeks 1-${Math.round(generatedWeeks*0.3)} aerobic base, Weeks ${Math.round(generatedWeeks*0.3)+1}-${Math.round(generatedWeeks*0.55)} build, Weeks ${Math.round(generatedWeeks*0.55)+1}-${Math.round(generatedWeeks*0.75)} quality/speed, Weeks ${Math.round(generatedWeeks*0.75)+1}-${generatedWeeks-2} peak, last 2 weeks taper with marathon in week ${generatedWeeks}`
  }

  const prompt = `You are an expert marathon coach. Generate a complete ${generatedWeeks}-week marathon training plan as a JSON object.

Athlete Profile:
- Experience Level: ${profile.level}
- Target Marathon Pace: ${paceStr}
- Training days (EXACTLY these ${desiredSessions} days per week): ${daysStr} (day indices 0=Mon…6=Sun: ${planDays.join(', ')})${sessionsNote}
- Other Sports: ${profile.cross_training_sports?.length ? profile.cross_training_sports.join(', ') : 'none'} (context only — do NOT schedule these)
- Marathon: "${profile.marathon_name}" on ${marathonDateStr} (${totalWeeks} weeks away${isLongPlan ? `, this plan covers the first ${generatedWeeks} weeks` : ''})
- Athlete Context: ${profile.context || 'No additional context provided'}

Return ONLY a valid JSON object (no markdown, no code fences):

{
  "weeks": [
    {
      "week": 1,
      "theme": "Base Building",
      "total_km": 35,
      "workouts": [
        {
          "id": "w1-d0",
          "day_of_week": 0,
          "type": "easy",
          "title": "Easy Run",
          "distance_km": 8,
          "duration_min": 55,
          "description": "Zone 2 easy pace. RPE 4-5/10. Conversational effort.",
          "pace_target": "6:30-7:00 min/km"
        }
      ]
    }
  ]
}

RULES:
1. day_of_week: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
2. Workouts ONLY on EXACTLY these days: ${planDays.join(', ')} — NEVER on any other day. Exactly ${desiredSessions} workouts per week.
3. type must be one of: "easy", "tempo", "interval", "long", "recovery"
4. Unique IDs: "w{week}-d{dayOfWeek}" e.g. "w1-d0"
5. Generate ALL ${generatedWeeks} weeks
6. Periodization: ${periodization}
7. Progressive mileage with cutback every 4th week. For ${profile.level}: ${profile.level === 'beginner' ? 'start 25-35 km/week, peak 45-55 km/week' : profile.level === 'intermediate' ? 'start 35-45 km/week, peak 60-75 km/week' : 'start 50-60 km/week, peak 80-95 km/week'}
8. One long run per week (day ${planDays[planDays.length - 1]}). Tempo/intervals from week 3+
9. Week ${generatedWeeks} = race week with marathon on marathon day
10. Keep descriptions concise (1 sentence with RPE/pace)

Output ONLY the raw JSON. Start with { end with }.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API error ${response.status}`)
  }

  const result = await response.json()
  const text = result.content?.[0]?.text || ''

  // Try to parse JSON — handle markdown code fences if present
  let planJson
  try {
    planJson = JSON.parse(text)
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (match) {
      try { planJson = JSON.parse(match[1]) } catch { /* fall through */ }
    }
    // Try to extract raw JSON object
    if (!planJson) {
      const objMatch = text.match(/\{[\s\S]*\}/)
      if (objMatch) {
        try { planJson = JSON.parse(objMatch[0]) } catch { /* fall through */ }
      }
    }
    if (!planJson) throw new Error('Failed to parse training plan JSON from API response.')
  }

  if (!planJson?.weeks || !Array.isArray(planJson.weeks)) {
    throw new Error('Invalid training plan structure returned by API.')
  }

  return planJson
}
