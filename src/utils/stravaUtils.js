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

/** Classify a Strava run into a workout_type based on pace and distance */
export function classifyRunType(run) {
  const distKm = (run.distance || 0) / 1000
  const paceSecKm = distKm > 0 ? run.moving_time / distKm : null
  if (paceSecKm && paceSecKm < 270) return 'interval'
  if (paceSecKm && paceSecKm < 310) return 'tempo'
  if (distKm >= 18) return 'long'
  return 'easy'
}

/** Build a workout_logs DB row from a strava_runs row or raw Strava API object */
export function makeStravaLogRow(run, userId) {
  const distKm = (run.distance || 0) / 1000
  // DB rows use strava_id; raw API objects use id
  const stravaId = run.strava_id ?? run.id
  return {
    user_id:      userId,
    workout_date: (run.start_date || '').slice(0, 10),
    workout_type: classifyRunType(run),
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
