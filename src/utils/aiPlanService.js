// ============================================================
// AI Plan Service — dynamic plan generation via Claude API
// ============================================================

// ── Intensity weights per workout type ──────────────────────
const INTENSITY = {
  easy:     1.0,
  recovery: 0.7,
  long:     1.2,
  tempo:    1.5,
  interval: 2.0,
  cross:    0.8,
  swim:     0.8,
  hike:     0.6,
  strength: 0.5,
  yoga:     0.3,
  other:    1.0,
}

/**
 * Calculate weighted training load for a set of logs.
 * Load = sum of (km × intensity) for each session.
 * If no km, use (duration_min / 10) as proxy.
 */
export function calculateTrainingLoad(logs) {
  return logs.reduce((total, log) => {
    const intensity = INTENSITY[log.workout_type] || 1.0
    const volume = log.distance_km
      ? log.distance_km
      : log.duration_min ? log.duration_min / 10 : 0
    return total + volume * intensity
  }, 0)
}

/**
 * Calculate weekly load breakdown (last 8 weeks).
 * Returns array of { week, rawKm, load } sorted oldest→newest.
 */
export function weeklyLoadStats(workoutLogs) {
  const byWeek = {}
  for (const log of workoutLogs) {
    const d = new Date(log.workout_date)
    const mon = new Date(d)
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday-based
    const key = mon.toISOString().split('T')[0]
    if (!byWeek[key]) byWeek[key] = { rawKm: 0, load: 0 }
    const intensity = INTENSITY[log.workout_type] || 1.0
    const volume = log.distance_km ? log.distance_km : log.duration_min ? log.duration_min / 10 : 0
    byWeek[key].rawKm += log.distance_km || 0
    byWeek[key].load  += volume * intensity
  }

  const result = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i * 7)
    const mon = new Date(d)
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const key = mon.toISOString().split('T')[0]
    result.push({
      week: key,
      rawKm: Math.round((byWeek[key]?.rawKm || 0) * 10) / 10,
      load:  Math.round((byWeek[key]?.load  || 0) * 10) / 10,
    })
  }
  return result
}

/**
 * Detect training gaps.
 * Returns { hasPause, pauseDays } — a gap of >3 days without a log
 * while the user normally trains suggests something happened.
 */
export function detectPause(workoutLogs, sessionsPerWeek = 3) {
  if (workoutLogs.length === 0) return { hasPause: false, pauseDays: 0 }

  const sorted = [...workoutLogs]
    .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))

  const lastLogDate = new Date(sorted[0].workout_date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const daysSinceLast = Math.floor((today - lastLogDate) / (1000 * 60 * 60 * 24))

  // Expected gap between sessions (rounded up)
  const expectedGap = Math.ceil(7 / sessionsPerWeek)
  const hasPause = daysSinceLast > expectedGap + 2 // 2-day buffer

  return { hasPause, pauseDays: daysSinceLast }
}

/**
 * Determine how confident we are in pace estimates.
 * Confidence grows with data (Strava runs + logged sessions).
 */
export function getPaceConfidence(workoutLogs = [], stravaRuns = []) {
  const qualifyingStrava = stravaRuns.filter(r => r.distance > 5000 && r.average_heartrate)
  const logsWithDistance = workoutLogs.filter(l => l.distance_km && l.distance_km >= 5)
  const dataPoints = qualifyingStrava.length + logsWithDistance.length

  if (dataPoints < 3)  return { level: 'none',   dataPoints, rangeWidth: null }
  if (dataPoints < 6)  return { level: 'low',    dataPoints, rangeWidth: 30 }
  if (dataPoints < 12) return { level: 'medium', dataPoints, rangeWidth: 15 }
  return                      { level: 'high',   dataPoints, rangeWidth: 0  }
}

/**
 * Determine if the AI plan should be regenerated.
 *
 * Triggers regeneration when:
 * - No plan exists yet
 * - RPE = 3 on latest log (very hard effort)
 * - Logged distance > 30% more than planned (pushed harder than expected)
 * - Training gap detected (came back after pause)
 * - Week changed since last generation
 * - Plan is older than 7 days
 */
export function shouldRegeneratePlan(newLog, workoutLogs, aiPlan, profile) {
  // Always generate if no plan
  if (!aiPlan) return { should: true, reason: 'Erstelle deinen personalisierten Plan' }

  const lastGen = aiPlan.generatedAt ? new Date(aiPlan.generatedAt) : null

  // Stale plan (>7 days)
  if (!lastGen || Date.now() - lastGen.getTime() > 7 * 24 * 60 * 60 * 1000) {
    return { should: true, reason: 'Wöchentliche Plan-Aktualisierung' }
  }

  // Week changed since last generation
  if (lastGen) {
    const lastGenWeek = getWeekKey(lastGen)
    const todayWeek   = getWeekKey(new Date())
    if (lastGenWeek !== todayWeek) {
      return { should: true, reason: 'Neue Woche — Plan wird angepasst' }
    }
  }

  if (!newLog) return { should: false, reason: null }

  // Very hard effort — needs recovery adjustment
  if (newLog.rpe === 3) {
    return { should: true, reason: 'Letztes Training war sehr intensiv — anpassen' }
  }

  // Came back after a long pause
  const prevLogs = workoutLogs.filter(l => l.id !== newLog.id)
  const { hasPause, pauseDays } = detectPause(prevLogs, profile?.sessions_per_week || 3)
  if (hasPause && pauseDays > 5) {
    return { should: true, reason: `${pauseDays} Tage Pause — sanfter Wiedereinstieg` }
  }

  // Logged much more than usual (pushed hard)
  if (newLog.distance_km) {
    const recentLogs = workoutLogs
      .filter(l => l.workout_type === newLog.workout_type && l.distance_km)
      .slice(0, 5)
    if (recentLogs.length >= 3) {
      const avgKm = recentLogs.reduce((s, l) => s + l.distance_km, 0) / recentLogs.length
      if (newLog.distance_km > avgKm * 1.3) {
        return { should: true, reason: 'Deutlich mehr als gewohnt gelaufen — Balance anpassen' }
      }
    }
  }

  return { should: false, reason: null }
}

function getWeekKey(date) {
  const d = new Date(date)
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return mon.toISOString().split('T')[0]
}

/**
 * Generate an AI training plan via Claude API.
 *
 * Returns a structured plan with:
 * - Current week's remaining sessions
 * - Next week preview
 * - Qualitative load assessment
 * - Pace targets scaled to confidence level
 * - Explanation of any adjustments
 */
export async function generateAIPlan(profile, workoutLogs, stravaRuns = [], apiKey) {
  if (!apiKey) throw new Error('Anthropic API Key fehlt')

  const confidence = getPaceConfidence(workoutLogs, stravaRuns)
  const { hasPause, pauseDays } = detectPause(workoutLogs, profile.sessions_per_week || 3)
  const loadStats = weeklyLoadStats(workoutLogs)

  // Current week load
  const currentWeekLoad = loadStats[loadStats.length - 1]?.load || 0
  const prev4AvgLoad = (() => {
    const prev4 = loadStats.slice(-5, -1).filter(w => w.load > 0)
    if (prev4.length === 0) return 0
    return prev4.reduce((s, w) => s + w.load, 0) / prev4.length
  })()

  // Recent logs context
  const recentLogs = [...workoutLogs]
    .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
    .slice(0, 8)

  const RPE_LABELS = { 1: 'leicht 😌', 2: 'gut 💪', 3: 'sehr hart 🔥' }
  const logsText = recentLogs.map(l =>
    `${l.workout_date}: ${l.workout_type}${l.distance_km ? ` ${l.distance_km}km` : ''}${l.duration_min ? ` ${l.duration_min}min` : ''}${l.rpe ? ` (${RPE_LABELS[l.rpe]})` : ''}${l.notes ? ` — "${l.notes}"` : ''}`
  ).join('\n')

  // Strava context
  const stravaText = stravaRuns.slice(0, 5).map(r => {
    const km = (r.distance / 1000).toFixed(1)
    const paceS = r.average_speed ? Math.round(1000 / r.average_speed) : null
    const hr = r.average_heartrate ? Math.round(r.average_heartrate) : null
    return `${new Date(r.start_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}: ${km}km${paceS ? ` @${Math.floor(paceS/60)}:${String(paceS%60).padStart(2,'0')}/km` : ''}${hr ? ` ♥${hr}bpm` : ''}`
  }).join(', ')

  // Training days
  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  const trainingDaysList = (profile.training_days || []).map(d => dayNames[d]).join(', ')

  // Pace confidence instructions
  const paceInstructions = {
    none:   'Keine Pace-Daten verfügbar — nutze allgemeine Richtwerte für das Level, zeige breite Bereiche (±45 Sek)',
    low:    `Wenig Daten (${confidence.dataPoints} Datenpunkte) — zeige Bereiche von ±25-30 Sek/km`,
    medium: `Moderate Daten (${confidence.dataPoints} Datenpunkte) — zeige Bereiche von ±10-15 Sek/km`,
    high:   `Viele Daten (${confidence.dataPoints} Datenpunkte) — zeige konkrete Zielpace mit nur ±5 Sek Toleranz`,
  }[confidence.level]

  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1 // 0=Mo ... 6=So
  const remainingDays = (profile.training_days || []).filter(d => d > dayOfWeek)

  const prompt = `Du bist ein erfahrener Marathontrainer. Erstelle einen dynamisch angepassten Trainingsplan.

ATHLETENPROFIL:
- Level: ${profile.level || 'Einsteiger'}
- Trainingstage: ${trainingDaysList || 'nicht angegeben'} (${profile.sessions_per_week || 3}x/Woche)
- Zieltempo Marathon: ${profile.target_pace_min || '?'}:${String(profile.target_pace_sec || 0).padStart(2, '0')} min/km
- Trainingsmodus: ${profile.training_mode || 'race'}
${profile.marathon_date ? `- Marathon: ${new Date(profile.marathon_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' })} (${Math.ceil((new Date(profile.marathon_date) - new Date()) / (1000*60*60*24))} Tage)` : ''}
${profile.context ? `- Persönliche Notizen: ${profile.context}` : ''}

TRAININGSBELASTUNG:
- Diese Woche (gewichtete Last): ${currentWeekLoad.toFixed(1)}
- Ø letzte 4 Wochen: ${prev4AvgLoad.toFixed(1)}
- Veränderung: ${prev4AvgLoad > 0 ? (((currentWeekLoad - prev4AvgLoad) / prev4AvgLoad) * 100).toFixed(0) + '%' : 'keine Vergleichsdaten'}
${hasPause ? `- ⚠️ PAUSE ERKANNT: ${pauseDays} Tage ohne Training — sanfterer Wiedereinstieg nötig` : ''}

LETZTE EINHEITEN:
${logsText || 'Noch keine Einheiten geloggt'}

${stravaRuns.length > 0 ? `STRAVA-LÄUFE (letzte 5):
${stravaText}` : ''}

HEUTIGE SITUATION:
- Heute: ${dayNames[dayOfWeek]}
- Verbleibende Trainingstage diese Woche: ${remainingDays.map(d => dayNames[d]).join(', ') || 'keine mehr diese Woche'}

PACE-VORGABEN: ${paceInstructions}

AUFGABE:
1. Analysiere die Trainingssituation (Belastung, Erschöpfung, Pause)
2. Erstelle Sessions für die restliche aktuelle Woche + Vorschau nächste Woche
3. Passe die Intensität an (bei RPE=3 oder hoher Last → leichter; nach Pause → vorsichtig aufbauen)
4. Gib konkrete Pace-Vorgaben entsprechend der Konfidenz

Antworte NUR mit validem JSON (kein Markdown, keine Erklärung davor/danach):
{
  "changeReason": "1-2 Sätze warum der Plan genau so aussieht (oder was angepasst wurde)",
  "weekTheme": "Thema der aktuellen Woche (z.B. Aerobe Basis, Erholungswoche, Tempowoche)",
  "currentWeekLoad": Zahl,
  "loadAssessment": "qualitative Einschätzung der Wochenbelastung in 1 Satz",
  "sessions": [
    {
      "dayOfWeek": 0-6 (0=Mo, 6=So),
      "type": "easy|tempo|long|interval|recovery|cross|strength|rest",
      "title": "Kurzer Titel",
      "distance_km": Zahl oder null,
      "duration_min": Zahl oder null,
      "pace": "z.B. 5:45-6:10 /km oder 5:30 /km (je nach Konfidenz)",
      "structure": "Aufbau der Einheit in 1 Satz oder null",
      "tip": "1 kurzer Tipp oder null",
      "isNextWeek": false oder true
    }
  ]
}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API Fehler ${response.status}`)
  }

  const data = await response.json()
  const text = data.content[0].text.trim()

  // Extract JSON (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Kein gültiges JSON in der Antwort')

  const plan = JSON.parse(jsonMatch[0])

  return {
    ...plan,
    generatedAt: new Date().toISOString(),
    confidence: confidence.level,
    pauseDetected: hasPause,
    pauseDays,
    dataPoints: confidence.dataPoints,
  }
}

/**
 * Get the AI plan's session for today.
 */
export function getTodayAISession(aiPlan) {
  if (!aiPlan?.sessions) return null
  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  return aiPlan.sessions.find(s => s.dayOfWeek === dayOfWeek && !s.isNextWeek) || null
}
