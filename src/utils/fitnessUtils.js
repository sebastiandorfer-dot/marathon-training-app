// ============================================================
// Fitness Calculations — VO2max & Race Prediction
// Scientific approach based on heart rate / pace relationship
// ============================================================

/**
 * Calculate VO2 at a given pace (ml/kg/min)
 * Based on ACSM running equation: VO2 = 0.2 × speed(m/min) + 0.9 × grade + 3.5
 */
function vo2FromPace(paceSecPerKm) {
  const speedMperMin = (1000 / paceSecPerKm) * 60
  return 0.2 * speedMperMin + 3.5
}

/**
 * Estimate VO2max from a single run using HR-pace relationship
 * Formula: VO2max = VO2_at_effort / (%HRmax)
 */
function estimateVO2maxFromRun(run, maxHR) {
  if (!run.average_heartrate || !run.average_speed || !maxHR) return null
  if (run.average_heartrate < 110 || run.average_heartrate > maxHR) return null

  const paceSecPerKm = 1000 / run.average_speed // speed in m/s → sec/km
  const vo2AtEffort = vo2FromPace(paceSecPerKm)
  const hrFraction = run.average_heartrate / maxHR

  // Only use efforts where HR > 65% of max (aerobic zone)
  if (hrFraction < 0.65) return null

  return vo2AtEffort / hrFraction
}

/**
 * Find max HR from all runs (most reliable data-driven approach)
 */
export function deriveMaxHR(runs) {
  let maxHR = 0
  for (const run of runs) {
    if (run.max_heartrate && run.max_heartrate > maxHR) {
      maxHR = run.max_heartrate
    }
  }
  return maxHR > 140 ? maxHR : null
}

/**
 * Calculate VO2max from a set of runs
 * Uses the top 20% of estimates (removes outliers)
 */
export function calculateVO2max(runs, maxHR) {
  if (!maxHR || runs.length < 3) return null

  const estimates = runs
    .map(run => estimateVO2maxFromRun(run, maxHR))
    .filter(v => v !== null && v > 20 && v < 90)
    .sort((a, b) => b - a)

  if (estimates.length < 2) return null

  // Take top 20% but at least 3 values
  const topN = Math.max(3, Math.ceil(estimates.length * 0.2))
  const top = estimates.slice(0, Math.min(topN, estimates.length))
  return top.reduce((a, b) => a + b, 0) / top.length
}

/**
 * Predict marathon pace from VO2max (Jack Daniels VDOT method)
 * Marathon is run at ~78-80% VO2max for trained runners
 */
export function predictMarathonPaceFromVO2max(vo2max) {
  if (!vo2max) return null
  // At marathon intensity (~79% VO2max):
  const vo2marathon = vo2max * 0.79
  // Invert ACSM equation: speed = (VO2 - 3.5) / 0.2
  const speedMperMin = (vo2marathon - 3.5) / 0.2
  const paceSecPerKm = (1000 / speedMperMin) * 60
  return paceSecPerKm // seconds per km
}

/**
 * Format seconds per km as MM:SS
 */
export function formatPaceSec(secPerKm) {
  if (!secPerKm) return '—'
  const min = Math.floor(secPerKm / 60)
  const sec = Math.round(secPerKm % 60)
  return `${min}:${String(sec).padStart(2, '0')}`
}

/**
 * Format marathon finish time from pace
 */
export function formatMarathonTime(secPerKm) {
  if (!secPerKm) return '—'
  const totalSec = secPerKm * 42.195
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.round(totalSec % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Calculate aerobic efficiency trend (are you getting fitter?)
 * Compares pace/HR ratio of recent runs vs older runs
 */
export function calculateFitnessTrend(runs) {
  if (runs.length < 6) return null

  const sorted = [...runs]
    .filter(r => r.average_heartrate > 120 && r.average_speed)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))

  if (sorted.length < 6) return null

  // Aerobic efficiency = speed / HR (higher = more fit)
  const recent = sorted.slice(0, Math.floor(sorted.length / 2))
  const older = sorted.slice(Math.floor(sorted.length / 2))

  const avgEfficiency = arr =>
    arr.reduce((s, r) => s + r.average_speed / r.average_heartrate, 0) / arr.length

  const recentEff = avgEfficiency(recent)
  const olderEff = avgEfficiency(older)

  const changePct = ((recentEff - olderEff) / olderEff) * 100
  return Math.round(changePct * 10) / 10 // e.g. +3.2 or -1.5
}

/**
 * Get fitness level description from VO2max
 */
export function vo2maxCategory(vo2max, age = 25) {
  // Simplified for male runners ~25 years
  if (vo2max >= 60) return { label: 'Elite', color: '#c77dff' }
  if (vo2max >= 52) return { label: 'Advanced', color: '#1D9E75' }
  if (vo2max >= 44) return { label: 'Intermediate', color: '#4a9eff' }
  if (vo2max >= 36) return { label: 'Beginner', color: '#ff8c42' }
  return { label: 'Starter', color: '#78909c' }
}

/**
 * Weekly average pace trend from Strava runs (last 8 weeks).
 * Returns array of { week: 'YYYY-MM-DD', pace: secPerKm|null }
 * Useful for drawing a pace-over-time chart.
 */
export function computePaceTrend(runs) {
  const byWeek = {}
  for (const run of runs) {
    if (!run.average_speed) continue
    const d = new Date(run.start_date)
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay())
    const key = sun.toISOString().split('T')[0]
    if (!byWeek[key]) byWeek[key] = []
    byWeek[key].push(Math.round(1000 / run.average_speed)) // sec/km
  }
  const result = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i * 7)
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay())
    const key = sun.toISOString().split('T')[0]
    const paces = byWeek[key]
    result.push({
      week: key,
      pace: paces ? Math.round(paces.reduce((s, p) => s + p, 0) / paces.length) : null,
    })
  }
  return result
}

/**
 * Calculate weekly mileage stats from runs
 */
export function weeklyMileageStats(runs) {
  if (!runs.length) return { avg: 0, peak: 0, last4avg: 0, weeklyBreakdown: [] }

  // Group runs by week (Sunday-based)
  const byWeek = {}
  for (const run of runs) {
    const d = new Date(run.start_date)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    const key = weekStart.toISOString().split('T')[0]
    byWeek[key] = (byWeek[key] || 0) + run.distance / 1000
  }

  // All weeks with data, sorted oldest → newest
  const allWeeksSorted = Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
  const allKm = allWeeksSorted.map(([, v]) => Math.round(v * 10) / 10)
  const peak = Math.max(...allKm)
  const avg = allKm.reduce((a, b) => a + b, 0) / allKm.length

  // Last 4 CALENDAR weeks from today (including weeks with 0 km)
  const getWeekKey = (date) => {
    const d = new Date(date)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    return weekStart.toISOString().split('T')[0]
  }
  const todayKey = getWeekKey(new Date())
  const last4Keys = []
  for (let i = 3; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    last4Keys.push(getWeekKey(d))
  }
  const last4km = last4Keys.map(k => byWeek[k] ? Math.round(byWeek[k] * 10) / 10 : 0)
  const last4avg = last4km.reduce((a, b) => a + b, 0) / 4

  // Chart: last 8 calendar weeks from today (include 0-km weeks)
  const weeklyBreakdown = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    const key = getWeekKey(d)
    weeklyBreakdown.push({
      week: key,
      km: byWeek[key] ? Math.round(byWeek[key] * 10) / 10 : 0,
    })
  }

  return {
    avg: Math.round(avg * 10) / 10,
    peak: Math.round(peak * 10) / 10,
    last4avg: Math.round(last4avg * 10) / 10,
    weeklyBreakdown,
  }
}
