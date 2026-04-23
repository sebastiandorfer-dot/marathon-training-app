// ============================================================
// Build Phase Scheduling Utilities
// Shared between BuildPhasePlan and BuildPhaseToday
// ============================================================
import { getMondayOf } from './planUtils'
export { getMondayOf }

/** Workout hardness: 0=rest/recovery, 1=easy, 2=tempo, 3=long/interval */
export const HARDNESS = {
  interval: 3, long: 3, tempo: 2,
  easy: 1, cross: 1, swim: 1, strength: 1, hike: 1, yoga: 1,
  recovery: 0, rest: 0, blocked: 0, missed: 0,
}
export const isHard = t => (HARDNESS[t] || 0) >= 2

/**
 * Personalized weekly workout type templates based on session count AND level.
 *
 * Beginner:    Mostly easy runs, no intervals. Build aerobic base first.
 * Intermediate: Add tempo when count ≥ 3. Intervals only at 5+ sessions.
 * Advanced:    Tempo + intervals earlier, more variety.
 *
 * @param {number} count - sessions per week (1–7)
 * @param {string} level - 'beginner' | 'intermediate' | 'advanced'
 * @param {number} recentFatigue - avg RPE of last 4 logs (1–3), null if unknown
 */
export function getWeeklyTypes(count, level = 'intermediate', recentFatigue = null) {
  const n = Math.min(Math.max(count, 1), 7)

  // If athlete is fatigued (avg RPE ≥ 2.5), swap hardest session for recovery
  const fatigued = recentFatigue !== null && recentFatigue >= 2.5

  const templates = {
    beginner: {
      1: ['long'],
      2: ['easy', 'long'],
      3: ['easy', 'easy', 'long'],
      4: ['easy', 'easy', 'easy', 'long'],
      5: ['easy', 'easy', 'easy', 'recovery', 'long'],
      6: ['easy', 'easy', 'easy', 'tempo', 'recovery', 'long'],
      7: ['easy', 'easy', 'easy', 'tempo', 'recovery', 'easy', 'long'],
    },
    intermediate: {
      1: ['long'],
      2: ['easy', 'long'],
      3: ['easy', 'tempo', 'long'],
      4: ['easy', 'easy', 'tempo', 'long'],
      5: ['easy', 'easy', 'tempo', 'recovery', 'long'],
      6: ['easy', 'easy', 'tempo', 'interval', 'recovery', 'long'],
      7: ['easy', 'easy', 'tempo', 'interval', 'recovery', 'easy', 'long'],
    },
    advanced: {
      1: ['long'],
      2: ['tempo', 'long'],
      3: ['easy', 'tempo', 'long'],
      4: ['easy', 'tempo', 'interval', 'long'],
      5: ['easy', 'easy', 'tempo', 'interval', 'long'],
      6: ['easy', 'easy', 'tempo', 'interval', 'recovery', 'long'],
      7: ['easy', 'easy', 'tempo', 'interval', 'easy', 'recovery', 'long'],
    },
  }

  const levelKey = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate'
  let types = templates[levelKey][n] || templates.intermediate[n]

  // Fatigue override: replace hardest non-long session with recovery
  if (fatigued) {
    const hardIdx = [...types].map((t, i) => ({ t, i }))
      .filter(({ t }) => t !== 'long' && t !== 'recovery' && t !== 'easy')
      .sort((a, b) => (HARDNESS[b.t] || 0) - (HARDNESS[a.t] || 0))[0]
    if (hardIdx) {
      types = [...types]
      types[hardIdx.i] = 'recovery'
    }
  }

  return types
}

/**
 * Check if placing `type` on `day` conflicts with adjacent hard workouts.
 * Cross-week aware: prevWeekLastType = last Sunday's workout type.
 */
export function hasConflict(day, type, schedule, prevWeekLastType = null) {
  if (!isHard(type)) return false
  if (day === 0 && prevWeekLastType && isHard(prevWeekLastType)) return true
  if (day > 0 && isHard(schedule[day - 1])) return true
  if (day < 6 && isHard(schedule[day + 1])) return true
  return false
}

/**
 * Distribute workout types onto available days:
 * - Easy runs first (most flexible), tempo next, long run always last
 * - No back-to-back hard sessions (cross-week aware)
 * - Long run: chronologically latest available day (Math.max)
 */
export function smartPlace(types, days, existingSchedule = {}, prevWeekLastType = null) {
  const result = { ...existingSchedule }
  const sorted = [...types].sort((a, b) => {
    if (a === 'long') return 1
    if (b === 'long') return -1
    return (HARDNESS[a] || 0) - (HARDNESS[b] || 0)
  })
  for (const type of sorted) {
    const free = days.filter(d => result[d] === undefined)
    if (free.length === 0) break
    const noConflict = free.filter(d => !hasConflict(d, type, result, prevWeekLastType))
    const pool = noConflict.length > 0 ? noConflict : free
    // Long run → latest possible day (chronological), others → earliest
    const chosen = type === 'long' ? Math.max(...pool) : pool[0]
    result[chosen] = type
  }
  return result
}

/** Build base weekly schedule from profile preferences (running only) */
/**
 * Build base weekly schedule — personalized by level and recent fatigue.
 * @param {object} profile
 * @param {Array}  workoutLogs - recent logs used to compute fatigue
 */
export function buildBaseSchedule(profile, workoutLogs = []) {
  const preferred  = [...(profile.training_days || [])].sort()
  const blocked    = profile.blocked_days || []
  const activeDays = preferred.filter(d => !blocked.includes(d))

  const desiredSessions = profile.sessions_per_week && profile.sessions_per_week > 0
    ? profile.sessions_per_week
    : activeDays.length
  const sessionCount = Math.min(desiredSessions, activeDays.length)

  // Compute recent fatigue from last 4 logs with RPE.
  // Sort explicitly by date desc so the result doesn't depend on
  // the caller's array order (which can change after in-place RPE updates).
  const recentRpeLogs = [...workoutLogs]
    .filter(l => l.rpe != null)
    .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
    .slice(0, 4)
  const recentFatigue = recentRpeLogs.length >= 2
    ? recentRpeLogs.reduce((s, l) => s + l.rpe, 0) / recentRpeLogs.length
    : null

  const level = profile.level || 'intermediate'
  const types = getWeeklyTypes(Math.max(1, sessionCount), level, recentFatigue)

  const base = {}
  for (let i = 0; i < 7; i++) base[i] = 'rest'
  const placed = smartPlace(types, activeDays, {})
  Object.assign(base, placed)
  return base
}

/** Auto-schedulable types — running only, never cross/swim/etc */
export const AUTO_TYPES = new Set(['easy', 'tempo', 'long', 'recovery', 'rest'])

/** Load schedule from profile or rebuild if stale. Pass workoutLogs for personalization. */
export function initSchedule(profile, workoutLogs = []) {
  if (
    profile.build_phase_schedule &&
    typeof profile.build_phase_schedule === 'object' &&
    Object.keys(profile.build_phase_schedule).length > 0
  ) {
    const stored = profile.build_phase_schedule

    // 1. All types must be valid running types
    const isClean = Object.values(stored).every(t => AUTO_TYPES.has(t))
    if (!isClean) return buildBaseSchedule(profile, workoutLogs)

    const preferred = profile.training_days || []
    const blocked   = profile.blocked_days  || []
    const activeDays = preferred.filter(d => !blocked.includes(d))
    const desiredSessions = Math.min(
      profile.sessions_per_week ?? activeDays.length,
      activeDays.length
    )

    // 2. Count planned (non-rest) days in stored schedule
    const storedWorkoutDays = Object.entries(stored)
      .filter(([, t]) => t !== 'rest')
      .map(([d]) => parseInt(d))

    // 3. All planned days must be in training_days and not blocked
    const allOnValidDays = storedWorkoutDays.every(
      d => preferred.includes(d) && !blocked.includes(d)
    )

    // 4. Session count must match desired
    const countMatches = storedWorkoutDays.length === desiredSessions

    if (allOnValidDays && countMatches) return stored
  }
  return buildBaseSchedule(profile, workoutLogs)
}

/**
 * Compute the display schedule for a given week.
 *
 * Future weeks  → base schedule as-is (no redistribution).
 *                 Cross-week conflict fix: if last Sunday was hard,
 *                 Monday is moved to avoid back-to-back.
 * Current week  → redistribute remaining workouts around actual logs.
 *                 A spontaneous log (e.g. long run on Friday) covers
 *                 that type and adapts the rest of the week.
 * Past weeks    → logs where available, missed markers for skipped sessions.
 */
export function computeWeekDisplay(baseSchedule, weekLogs, profile, monday, prevWeekLastType = null) {
  // Guard: if monday is missing, return empty rest schedule to avoid Invalid Date cascades
  if (!monday || !(monday instanceof Date) || isNaN(monday.getTime())) {
    const fallback = {}
    for (let i = 0; i < 7; i++) fallback[i] = { type: 'rest', logged: false, isToday: false, isPast: false }
    return fallback
  }

  const blocked   = profile.blocked_days || []
  const preferred = profile.training_days || []
  const today     = new Date(); today.setHours(0, 0, 0, 0)

  const dayDate = i => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d }

  // Map logs to Mon=0 index
  const logsByDay = {}
  weekLogs.forEach(log => {
    const d   = new Date(log.workout_date + 'T12:00:00')
    const js  = d.getDay()
    const idx = js === 0 ? 6 : js - 1
    if (!logsByDay[idx]) logsByDay[idx] = []
    logsByDay[idx].push(log)
  })

  const isFutureWeek = monday > today

  // ── Future weeks ────────────────────────────────────────────────
  if (isFutureWeek) {
    // If last Sunday was hard, redistribute to fix cross-week conflict
    if (prevWeekLastType && isHard(prevWeekLastType)) {
      const activeDays = []
      const types = []
      for (let i = 0; i < 7; i++) {
        const t = baseSchedule[i]
        if (t && t !== 'rest' && !blocked.includes(i)) { activeDays.push(i); types.push(t) }
      }
      const placed = smartPlace(types, activeDays, {}, prevWeekLastType)
      const display = {}
      for (let i = 0; i < 7; i++) {
        const isBlocked = blocked.includes(i)
        const type = isBlocked ? 'blocked' : (placed[i] || 'rest')
        display[i] = { type, logged: false, isToday: false, isPast: false, adjusted: !isBlocked && baseSchedule[i] !== type && type !== 'rest' }
      }
      return display
    }
    // No cross-week conflict — plain base schedule
    const display = {}
    for (let i = 0; i < 7; i++) {
      const isBlocked = blocked.includes(i)
      const type = isBlocked ? 'blocked' : (baseSchedule[i] || 'rest')
      display[i] = { type, logged: false, isToday: false, isPast: false }
    }
    return display
  }

  // ── Current / past weeks ────────────────────────────────────────

  // Planned training types (non-rest, non-blocked) from base
  const plannedTypes = []
  for (let i = 0; i < 7; i++) {
    const t = baseSchedule[i]
    if (t && t !== 'rest' && !blocked.includes(i)) plannedTypes.push(t)
  }

  // Count which types are already covered (by logs or missed past days)
  const coveredCount = {}
  for (let i = 0; i < 7; i++) {
    const d = dayDate(i)
    if (logsByDay[i]) {
      const logType = logsByDay[i][0].workout_type
      coveredCount[logType] = (coveredCount[logType] || 0) + 1
    } else if (d < today) {
      const planned = baseSchedule[i]
      if (planned && planned !== 'rest' && !blocked.includes(i)) {
        coveredCount[planned] = (coveredCount[planned] || 0) + 1
      }
    }
  }

  // What types still need to be placed on remaining days?
  const tempCount = { ...coveredCount }
  const stillNeeded = []
  for (const t of plannedTypes) {
    if (tempCount[t] > 0) tempCount[t]--
    else stillNeeded.push(t)
  }

  // Available future days: today+, not logged, not blocked
  const futureDays = []
  for (let i = 0; i < 7; i++) {
    const d = dayDate(i)
    if (d >= today && !logsByDay[i] && !blocked.includes(i)) futureDays.push(i)
  }
  // Preferred days first, then chronological
  futureDays.sort((a, b) => {
    const ap = preferred.includes(a) ? 0 : 1
    const bp = preferred.includes(b) ? 0 : 1
    return ap !== bp ? ap - bp : a - b
  })

  // Lock logged days into conflict schedule so placement avoids them
  const lockedSchedule = {}
  for (let i = 0; i < 7; i++) {
    if (logsByDay[i]) lockedSchedule[i] = logsByDay[i][0].workout_type
  }

  const redist = smartPlace(stillNeeded, futureDays, lockedSchedule, prevWeekLastType)

  // Build final display map
  const display = {}
  for (let i = 0; i < 7; i++) {
    const d       = dayDate(i)
    const isPast  = d < today
    const isToday = d.toDateString() === today.toDateString()

    if (logsByDay[i]) {
      display[i] = { type: logsByDay[i][0].workout_type, logged: true, logs: logsByDay[i], isToday, isPast: false }
    } else if (blocked.includes(i)) {
      display[i] = { type: 'blocked', logged: false, isToday, isPast }
    } else if (redist[i]) {
      const wasPreferred = preferred.includes(i)
      const wasBase      = baseSchedule[i] === redist[i]
      display[i] = { type: redist[i], logged: false, isToday, isPast, adjusted: !wasPreferred && !wasBase }
    } else if (isPast && baseSchedule[i] && baseSchedule[i] !== 'rest' && !blocked.includes(i)) {
      // Only mark as "missed" if the day is on or after the schedule was last set.
      // Days before schedule_since belong to an old schedule the user no longer wants.
      const scheduleSince = profile.schedule_since ? new Date(profile.schedule_since + 'T00:00:00') : null
      const afterReset = !scheduleSince || d >= scheduleSince
      display[i] = afterReset
        ? { type: 'missed', logged: false, isToday: false, isPast: true }
        : { type: 'rest',   logged: false, isToday: false, isPast: true }
    } else {
      display[i] = { type: 'rest', logged: false, isToday, isPast }
    }
  }
  return display
}

/**
 * Get today's planned build-phase workout entry.
 * Used by BuildPhaseToday to show the structured plan for today.
 */
export function getTodayBuildEntry(profile, workoutLogs) {
  const schedule = initSchedule(profile, workoutLogs)
  const today    = new Date(); today.setHours(0, 0, 0, 0)
  const monday   = getMondayOf(today)

  const mondayStr = monday.toISOString().split('T')[0]
  const sunday    = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const sundayStr = sunday.toISOString().split('T')[0]
  const weekLogs  = workoutLogs.filter(l => l.workout_date >= mondayStr && l.workout_date <= sundayStr)

  // Previous Sunday for cross-week conflict check
  const prevSunday    = new Date(monday); prevSunday.setDate(monday.getDate() - 1)
  const prevSundayStr = prevSunday.toISOString().split('T')[0]
  const prevLog       = workoutLogs.find(l => l.workout_date === prevSundayStr)
  const prevWeekLastType = prevLog ? prevLog.workout_type : (schedule[6] || 'rest')

  const display = computeWeekDisplay(schedule, weekLogs, profile, monday, prevWeekLastType)

  const js     = today.getDay()
  const dayIdx = js === 0 ? 6 : js - 1

  return { entry: display[dayIdx], dayIdx }
}

/**
 * Progressive weekly km target for the build phase.
 * Ramps from current mileage to ~30% above over the available weeks,
 * with a cutback every 4th week.
 */
export function getBuildPhaseKmTarget(currentAvgKm, weeksSoFar, totalBuildWeeks) {
  const base   = Math.max(currentAvgKm || 20, 15)
  const peak   = Math.min(base * 1.35, 75)
  const pct    = Math.min(weeksSoFar / Math.max(totalBuildWeeks, 1), 1)
  const cutback = weeksSoFar > 0 && weeksSoFar % 4 === 0 ? 0.85 : 1
  return Math.round((base + (peak - base) * pct * cutback) / 5) * 5
}
