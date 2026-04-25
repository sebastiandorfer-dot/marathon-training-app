// ============================================================
// Strava Integration
// ============================================================

const CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_STRAVA_CLIENT_SECRET
const REDIRECT_URI = window.location.origin

export function getStravaAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
  })
  return `https://www.strava.com/oauth/authorize?${params}`
}

export async function exchangeStravaCode(code) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error('Strava token exchange failed')
  return res.json()
}

export async function refreshStravaToken(refreshToken) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error('Strava token refresh failed')
  return res.json()
}

export async function fetchStravaActivities(accessToken, page = 1, perPage = 100) {
  const res = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) throw new Error('Failed to fetch Strava activities')
  return res.json()
}

// Fetch all run activities (handles pagination, max 500)
export async function fetchAllStravaRuns(accessToken) {
  const runs = []
  for (let page = 1; page <= 5; page++) {
    const activities = await fetchStravaActivities(accessToken, page, 100)
    if (!activities.length) break
    const pageRuns = activities.filter(a => a.type === 'Run' && a.moving_time > 600)
    runs.push(...pageRuns)
    if (activities.length < 100) break
  }
  return runs
}

// ── Bridge helpers — single source of truth for Strava→workout_logs ──

/** Returns the user's target marathon pace in seconds/km, or null if not set */
export function getTargetPaceSec(profile) {
  if (!profile?.target_pace_min) return null
  return (parseInt(profile.target_pace_min, 10) * 60) + (parseInt(profile.target_pace_sec, 10) || 0)
}

/** Round seconds to nearest 5 */
function roundTo5(sec) {
  return Math.round(sec / 5) * 5
}

/** Format total seconds as "M:SS" */
function fmtPace(totalSec) {
  const s = Math.round(totalSec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Classify a Strava run into a workout_type.
 * When profile is provided, thresholds are relative to target marathon pace (MP):
 *   interval  = faster than MP − 50 s/km  (≈ 5 K race pace)
 *   tempo     = MP − 50 s  to  MP − 5 s   (lactate threshold zone)
 *   long      = ≥ 18 km regardless of pace (checked first)
 *   easy      = everything else
 * Falls back to absolute thresholds when no target pace is set.
 */
export function classifyRunType(run, profile = null) {
  const distKm    = (run.distance || 0) / 1000
  const paceSecKm = distKm > 0 ? run.moving_time / distKm : null

  // Long run is always distance-based — check before pace
  if (distKm >= 18) return 'long'

  if (paceSecKm) {
    const mp = getTargetPaceSec(profile)
    if (mp) {
      if (paceSecKm < mp - 50) return 'interval'
      if (paceSecKm < mp + 20) return 'tempo'   // anything from near-MP down to interval threshold
    } else {
      // Absolute fallback when no target pace is configured
      if (paceSecKm < 270) return 'interval'
      if (paceSecKm < 310) return 'tempo'
    }
  }
  return 'easy'
}

/**
 * Generate a pace target range for a workout type, displayed in 5-second intervals.
 * Offsets from marathon pace (MP):
 *   interval → MP − 70 s (≈ 5 K pace)
 *   tempo    → MP − 27 s (midpoint of lactate threshold zone)
 *   long     → MP + 40 s (comfortable long run pace)
 *   easy     → MP + 75 s (easy aerobic pace)
 * Returns e.g. "5:00–5:10/km" or null if no target pace is set.
 */
export function getPaceTargetRange(profile, workoutType) {
  const mp = getTargetPaceSec(profile)
  if (!mp) return null

  const offsets = { interval: -70, tempo: -27, long: 40, easy: 75 }
  const offset  = offsets[workoutType]
  if (offset === undefined) return null

  const center = roundTo5(mp + offset)
  return `${fmtPace(center - 5)}–${fmtPace(center + 5)}/km`
}

/** Build a workout_logs DB row from a strava_runs row or raw Strava API object */
export function makeStravaLogRow(run, userId, profile = null) {
  const distKm   = (run.distance || 0) / 1000
  // DB rows use strava_id; raw API objects use id
  const stravaId = run.strava_id ?? run.id
  return {
    user_id:      userId,
    workout_date: (run.start_date || '').slice(0, 10),
    workout_type: classifyRunType(run, profile),
    distance_km:  parseFloat(distKm.toFixed(2)),
    duration_min: Math.round((run.moving_time || 0) / 60),
    notes:        `strava:${stravaId}`,
    rpe:          null,
  }
}

/**
 * Return Strava runs not yet represented in workoutLogs.
 * Works with both DB strava_runs rows (have strava_id) and raw API objects (have id).
 */
export function filterNewStravaRuns(stravaRuns, workoutLogs) {
  const bridgedIds = new Set(
    workoutLogs
      .map(l => l.notes?.match(/strava:(\d+)/)?.[1])
      .filter(Boolean)
  )
  return stravaRuns.filter(r => {
    const id = String(r.strava_id ?? r.id)
    return !bridgedIds.has(id)
  })
}

// Get a valid access token, refreshing if needed
export async function getValidToken(profile, supabase) {
  const now = Math.floor(Date.now() / 1000)
  if (!profile.strava_access_token) return null

  if (profile.strava_token_expires_at > now + 300) {
    return profile.strava_access_token
  }

  // Refresh
  const data = await refreshStravaToken(profile.strava_refresh_token)
  await supabase.from('profiles').update({
    strava_access_token: data.access_token,
    strava_refresh_token: data.refresh_token,
    strava_token_expires_at: data.expires_at,
  }).eq('id', profile.id)

  return data.access_token
}
