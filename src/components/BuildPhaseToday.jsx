import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { daysUntilMarathon, daysUntilRacePlan } from '../utils/planUtils'
import {
  deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max,
  formatPaceSec, formatMarathonTime, vo2maxCategory, getVO2maxDisplay,
  getMarathonTimeRange,
} from '../utils/fitnessUtils'
import { getTodayBuildEntry } from '../utils/buildPhaseUtils'
import { getTodayAISession, detectPause, getPaceConfidence } from '../utils/aiPlanService'

const TYPE_META = {
  easy:     { label: 'Easy Lauf',    color: 'var(--c-easy)',     icon: '🏃', desc: 'Locker und entspannt, Herzfrequenz niedrig halten.' },
  tempo:    { label: 'Tempo Lauf',   color: 'var(--c-tempo)',    icon: '⚡', desc: 'Komfortabel anspruchsvoll — du könntest sprechen, aber lieber nicht.' },
  long:     { label: 'Langer Lauf',  color: 'var(--c-long)',     icon: '🛣️', desc: 'Dein wichtigstes Training. Langsam und konstant.' },
  recovery: { label: 'Erholung',     color: 'var(--c-recovery)', icon: '🌿', desc: 'Sehr locker — aktive Regeneration, kein Druck.' },
  rest:     { label: 'Ruhetag',      color: 'var(--c-text-3)',   icon: '💤', desc: 'Heute erholen. Erholung ist Training.' },
  cross:    { label: 'Radfahren',    color: 'var(--c-cross)',    icon: '🚴', desc: 'Anderer Sport statt Laufen.' },
  swim:     { label: 'Schwimmen',    color: '#4a9eff',           icon: '🏊', desc: 'Gelenkschonendes Ausdauertraining.' },
  strength: { label: 'Krafttraining',color: '#c77dff',           icon: '🏋️', desc: 'Stabilität und Verletzungsprävention.' },
  blocked:  { label: 'Gesperrt',     color: 'var(--c-text-3)',   icon: '🚫', desc: 'Kein Training geplant.' },
  missed:   { label: 'Verpasst',     color: 'var(--c-text-3)',   icon: '—',  desc: '' },
}

const RPE_OPTIONS = [
  { value: 1, emoji: '😌', label: 'Leicht', color: '#22c55e' },
  { value: 2, emoji: '💪', label: 'Gut',    color: '#4a9eff' },
  { value: 3, emoji: '🔥', label: 'Hart',   color: '#ef4444' },
]

const WORKOUT_TYPES = [
  { value: 'easy',     label: '🏃 Easy Lauf' },
  { value: 'tempo',    label: '⚡ Tempo Lauf' },
  { value: 'interval', label: '🔥 Intervalle' },
  { value: 'long',     label: '🛣️ Langer Lauf' },
  { value: 'recovery', label: '🌿 Regeneration' },
  { value: 'cross',    label: '🚴 Radfahren' },
  { value: 'swim',     label: '🏊 Schwimmen' },
  { value: 'hike',     label: '🥾 Wandern' },
  { value: 'strength', label: '🏋️ Krafttraining' },
  { value: 'yoga',     label: '🧘 Yoga' },
  { value: 'other',    label: '📝 Sonstiges' },
]

export default function BuildPhaseToday({
  user, profile, stravaRuns = [], workoutLogs = [], onLogAdded, onConfirmRacePlan,
  aiPlan = null, aiPlanGenerating = false,
}) {
  const trainingMode     = profile.training_mode || 'race'
  const hasMarathon      = !!profile.marathon_date
  const daysLeft         = hasMarathon ? daysUntilMarathon(profile.marathon_date) : null
  const daysToRacePlan   = hasMarathon ? daysUntilRacePlan(profile.marathon_date) : null
  const isTransitionWeek = hasMarathon && trainingMode === 'race' && daysToRacePlan !== null && daysToRacePlan <= 7 && daysToRacePlan > 0

  // Fitness data
  const maxHR            = deriveMaxHR(stravaRuns)
  const vo2max           = calculateVO2max(stravaRuns, maxHR)
  const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
  const category         = vo2max ? vo2maxCategory(vo2max) : null
  const vo2maxDisp       = vo2max ? getVO2maxDisplay(vo2max) : null
  const marathonRange    = useMemo(() => getMarathonTimeRange(vo2max, workoutLogs), [vo2max, workoutLogs])

  // Fatigue indicator: avg RPE of last 3–4 logged workouts (requires RPE data)
  const recentFatigue = useMemo(() => {
    const withRpe = [...workoutLogs]
      .filter(l => l.rpe != null)
      .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
      .slice(0, 4)
    if (withRpe.length < 2) return null
    return withRpe.reduce((s, l) => s + l.rpe, 0) / withRpe.length
  }, [workoutLogs])

  // Today's planned workout from build phase schedule
  const todayPlan = useMemo(() => getTodayBuildEntry(profile, workoutLogs), [profile, workoutLogs])
  const todayEntry = todayPlan.entry
  const isRestDay  = !todayEntry || todayEntry.type === 'rest' || todayEntry.type === 'blocked'
  const alreadyLogged = todayEntry?.logged

  // AI plan — today's session and confidence
  const aiSession    = useMemo(() => getTodayAISession(aiPlan), [aiPlan])
  const paceConf     = useMemo(() => getPaceConfidence(workoutLogs, stravaRuns), [workoutLogs, stravaRuns])
  const { hasPause, pauseDays } = useMemo(() => detectPause(workoutLogs, profile.sessions_per_week || 3), [workoutLogs, profile.sessions_per_week])

  // Log form — pre-fill with today's planned type
  const [logOpen, setLogOpen]     = useState(false)
  const [logForm, setLogForm]     = useState({
    workout_date: new Date().toISOString().split('T')[0],
    workout_type: (!isRestDay && todayEntry?.type) || 'easy',
    distance_km: '',
    duration_min: '',
    notes: '',
    rpe: null,
  })
  const [logging, setLogging]     = useState(false)
  const [rpeLogId, setRpeLogId]   = useState(null)
  const [rpeSaving, setRpeSaving] = useState(false)

  // Keep log form type in sync with plan (on first load)
  useEffect(() => {
    if (!isRestDay && todayEntry?.type && !alreadyLogged) {
      setLogForm(f => ({ ...f, workout_type: todayEntry.type }))
    }
  }, [todayEntry?.type])

  // AI coach recommendation (aware of today's plan)
  const [recommendation, setRecommendation] = useState(null)
  const [loadingRec, setLoadingRec]         = useState(false)
  const [recError, setRecError]             = useState('')

  useEffect(() => {
    generateRecommendation()
  }, [stravaRuns.length, workoutLogs.length])

  async function generateRecommendation() {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) return
    setLoadingRec(true)
    setRecError('')

    const RPE_LABELS = { 1: 'leicht', 2: 'moderat', 3: 'sehr hart' }
    const recentLogs = [...workoutLogs]
      .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
      .slice(0, 5)
      .map(l => `${l.workout_date}: ${l.workout_type}${l.distance_km ? ` ${l.distance_km}km` : ''}${l.duration_min ? ` ${l.duration_min}min` : ''}${l.rpe ? ` RPE:${RPE_LABELS[l.rpe]}` : ''}`)
      .join(', ')

    const recentStravaRuns = stravaRuns.slice(0, 5).map(r => {
      const km   = Math.round(r.distance / 100) / 10
      const paceS = r.average_speed ? Math.round(1000 / r.average_speed) : null
      const hr    = r.average_heartrate ? Math.round(r.average_heartrate) : null
      return `${new Date(r.start_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}: ${km}km${paceS ? ' @' + Math.floor(paceS/60) + ':' + String(paceS%60).padStart(2,'0') + '/km' : ''}${hr ? ' ♥' + hr : ''}`
    }).join(', ')

    const today      = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })
    const plannedStr = todayEntry && !isRestDay
      ? `Heute im Plan: ${TYPE_META[todayEntry.type]?.label || todayEntry.type}`
      : 'Heute: Ruhetag laut Plan'

    try {
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
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Du bist ein Marathontrainer. Gib eine kurze Trainingsempfehlung für heute.

Athlet: ${profile.level}, Ziel ${profile.target_pace_min}:${String(profile.target_pace_sec).padStart(2,'0')}/km
Marathon in: ${daysLeft} Tagen (noch ${daysToRacePlan} Tage bis zum 18-Wochen-Rennplan)
${vo2maxDisp ? `Fitness Level: ${vo2maxDisp.label} (${vo2maxDisp.range})` : 'Noch keine Fitness-Daten'}
${marathonRange ? `Marathonprognose: ${marathonRange.minTime}–${marathonRange.maxTime}` : ''}
Heute: ${today}
${plannedStr}
Letzte Einheiten: ${recentLogs || 'keine'}
Letzte Strava-Läufe: ${recentStravaRuns || 'keine'}

Deine Empfehlung soll zum geplanten Workout passen (außer es gibt guten Grund davon abzuweichen).
Antworte mit einem JSON-Objekt:
{
  "type": "easy|tempo|long|recovery|rest",
  "title": "kurzer Titel (max 5 Wörter)",
  "distance_km": Zahl oder null,
  "duration_min": Zahl oder null,
  "pace_hint": "z.B. 5:30-6:00/km" oder null,
  "reason": "1-2 Sätze warum genau das heute sinnvoll ist"
}`,
          }],
        }),
      })

      if (!response.ok) throw new Error('API Fehler')
      const data = await response.json()
      const text = data.content[0].text
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) setRecommendation(JSON.parse(jsonMatch[0]))
    } catch {
      setRecError('Empfehlung konnte nicht geladen werden.')
    } finally {
      setLoadingRec(false)
    }
  }

  async function submitLog() {
    if (!logForm.distance_km && !logForm.duration_min) return
    setLogging(true)
    try {
      const { data, error } = await supabase.from('workout_logs').insert({
        user_id: user.id,
        workout_date: logForm.workout_date,
        workout_type: logForm.workout_type,
        distance_km:  logForm.distance_km  ? parseFloat(logForm.distance_km)  : null,
        duration_min: logForm.duration_min ? parseFloat(logForm.duration_min) : null,
        notes: logForm.notes.trim() || null,
        rpe: logForm.rpe || null,
      }).select().single()
      if (error) throw error
      onLogAdded(data)
      setLogOpen(false)
      setLogForm({ workout_date: new Date().toISOString().split('T')[0], workout_type: 'easy', distance_km: '', duration_min: '', notes: '', rpe: null })
      if (!logForm.rpe) setRpeLogId(data.id)
    } catch { /* ignore */ } finally {
      setLogging(false)
    }
  }

  async function saveRpe(rpeValue) {
    setRpeSaving(true)
    try {
      const { data } = await supabase
        .from('workout_logs').update({ rpe: rpeValue })
        .eq('id', rpeLogId).select().single()
      if (data) onLogAdded(data)
    } finally {
      setRpeSaving(false)
      setRpeLogId(null)
    }
  }

  const planMeta    = todayEntry ? (TYPE_META[todayEntry.type] || TYPE_META.rest) : TYPE_META.rest
  const recMeta     = recommendation ? (TYPE_META[recommendation.type] || TYPE_META.easy) : null
  // Use AI session hint if available, fall back to static calculation
  const workoutHint = (!isRestDay && todayEntry)
    ? (aiSession
        ? getAIWorkoutHint(aiSession, paceConf)
        : getWorkoutHints(todayEntry.type, profile))
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Race plan transition alert */}
      {isTransitionWeek && (
        <div style={{ background: 'var(--c-primary-dim)', border: '2px solid var(--c-primary)', borderRadius: 16, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            🎯 Rennplan startet bald
          </div>
          <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--c-text)', marginBottom: 6 }}>
            In {daysToRacePlan} {daysToRacePlan === 1 ? 'Tag' : 'Tagen'} beginnt dein 18-Wochen-Marathonplan
          </div>
          <p style={{ fontSize: 13, color: 'var(--c-text-2)', marginBottom: 16 }}>
            Du hast die Aufbauphase abgeschlossen. Bereit für das gezielte Marathontraining?
          </p>
          <button onClick={onConfirmRacePlan}
            style={{ width: '100%', padding: '13px 0', borderRadius: 12, background: 'var(--c-primary)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            Rennplan jetzt starten →
          </button>
        </div>
      )}

      {/* AI plan generating indicator */}
      {aiPlanGenerating && (
        <div style={{
          background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
          borderRadius: 12, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          <span style={{ fontSize: 13, color: 'var(--c-primary)', fontWeight: 600 }}>
            Plan wird angepasst…
          </span>
        </div>
      )}

      {/* Pause detection card */}
      {hasPause && pauseDays >= 5 && !aiPlanGenerating && (
        <div style={{
          background: '#eff6ff', border: '1.5px solid #4a9eff',
          borderRadius: 12, padding: '12px 16px',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{ fontSize: 22, flexShrink: 0, marginTop: 2 }}>🔄</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1d4ed8' }}>
              Willkommen zurück! ({pauseDays} Tage Pause)
            </div>
            <div style={{ fontSize: 13, color: '#1e40af', marginTop: 3, lineHeight: 1.4 }}>
              Dein Plan wurde angepasst — sanfterer Wiedereinstieg. Überspringe keine Erholungseinheiten.
            </div>
          </div>
        </div>
      )}

      {/* Fatigue warning — show when avg RPE of recent sessions is high */}
      {recentFatigue !== null && recentFatigue >= 2.5 && (
        <div style={{
          background: '#fff7ed', border: '1.5px solid #f97316',
          borderRadius: 12, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>😮‍💨</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#c2410c' }}>
              Hohe Belastung zuletzt
            </div>
            <div style={{ fontSize: 13, color: '#9a3412', marginTop: 2, lineHeight: 1.4 }}>
              Deine letzten Einheiten waren intensiv. Achte heute auf genug Erholung — ein Easy-Lauf oder Ruhetag wäre jetzt klug.
            </div>
          </div>
        </div>
      )}

      {/* ── TODAY'S PLANNED WORKOUT ─────────────────────────────── */}
      <div style={{
        background: 'var(--c-card)',
        border: `1.5px solid ${isRestDay ? 'var(--c-border)' : (alreadyLogged ? 'var(--c-primary)' : planMeta.color)}`,
        borderRadius: 14, overflow: 'hidden',
      }}>
        {/* Label bar */}
        <div style={{
          background: isRestDay ? 'var(--c-card)' : (alreadyLogged ? 'var(--c-primary-dim)' : planMeta.color + '18'),
          padding: '8px 16px',
          borderBottom: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: isRestDay ? 'var(--c-text-3)' : (alreadyLogged ? 'var(--c-primary)' : planMeta.color), textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {alreadyLogged ? '✓ Heute erledigt' : 'Heute im Plan'}
          </div>
          {daysToRacePlan !== null && (
            <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
              {daysToRacePlan} Tage bis Rennplan
            </div>
          )}
        </div>

        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>{planMeta.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: isRestDay ? 'var(--c-text-3)' : (alreadyLogged ? 'var(--c-primary)' : planMeta.color), lineHeight: 1.1 }}>
                {planMeta.label}
              </div>
              {planMeta.desc && (
                <div style={{ fontSize: 13, color: 'var(--c-text-2)', marginTop: 4, lineHeight: 1.4 }}>
                  {planMeta.desc}
                </div>
              )}
              {alreadyLogged && todayEntry?.logs?.[0] && (
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 4 }}>
                  {todayEntry.logs[0].distance_km ? `${todayEntry.logs[0].distance_km} km` : ''}
                  {todayEntry.logs[0].distance_km && todayEntry.logs[0].duration_min ? ' · ' : ''}
                  {todayEntry.logs[0].duration_min ? `${todayEntry.logs[0].duration_min} min` : ''}
                </div>
              )}
              {/* Workout hints: pace, structure, tip */}
              {!alreadyLogged && workoutHint && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {workoutHint.pace && (
                    <div style={{ background: planMeta.color + '15', border: `1px solid ${planMeta.color}33`, borderRadius: 8, padding: '5px 10px' }}>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Pace</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: planMeta.color }}>{workoutHint.pace}</div>
                    </div>
                  )}
                  {workoutHint.duration && (
                    <div style={{ background: 'var(--c-card-hover)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '5px 10px' }}>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Dauer</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>{workoutHint.duration}</div>
                    </div>
                  )}
                  {workoutHint.structure && (
                    <div style={{ width: '100%', background: 'var(--c-card-hover)', border: '1px solid var(--c-border)', borderRadius: 8, padding: '6px 10px' }}>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 2 }}>Aufbau</div>
                      <div style={{ fontSize: 12, color: 'var(--c-text-2)' }}>{workoutHint.structure}</div>
                    </div>
                  )}
                  {workoutHint.tip && (
                    <div style={{ width: '100%', fontSize: 12, color: 'var(--c-text-3)', fontStyle: 'italic', paddingLeft: 2 }}>
                      💡 {workoutHint.tip}
                    </div>
                  )}
                  {workoutHint.confidenceNote && (
                    <div style={{ width: '100%', fontSize: 11, color: 'var(--c-text-3)', padding: '4px 8px', background: 'var(--c-card-hover)', borderRadius: 6 }}>
                      📊 {workoutHint.confidenceNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pace Gap Card — predicted vs target */}
      <PaceGapCard
        profile={profile}
        predictedPaceSec={predictedPaceSec}
        vo2max={vo2max}
        category={category}
        daysLeft={daysLeft}
      />

      {/* AI Coach recommendation */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ fontSize: '1rem' }}>Coach-Empfehlung</h3>
          {!loadingRec && (
            <button onClick={generateRecommendation}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 12, fontFamily: 'var(--font)', padding: '4px 8px' }}>
              ↻ Neu
            </button>
          )}
        </div>

        {loadingRec ? (
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
            <span style={{ color: 'var(--c-text-2)', fontSize: 14 }}>Coach denkt nach…</span>
          </div>
        ) : recommendation ? (
          <div style={{ background: 'var(--c-card)', border: `1px solid ${recMeta?.color || 'var(--c-border)'}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: recMeta?.color || 'var(--c-text)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {recMeta?.label || recommendation.type}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)', marginBottom: 10 }}>
                {recommendation.title}
              </div>
              {recommendation.type !== 'rest' && (
                <div style={{ display: 'flex', gap: 16 }}>
                  {recommendation.distance_km && (
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>{recommendation.distance_km}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>km</div>
                    </div>
                  )}
                  {recommendation.duration_min && (
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>{recommendation.duration_min}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>min</div>
                    </div>
                  )}
                  {recommendation.pace_hint && (
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)' }}>{recommendation.pace_hint}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Pace</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid var(--c-border)', padding: '10px 16px', background: 'var(--c-card-hover)' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.5, margin: 0 }}>💬 {recommendation.reason}</p>
            </div>
          </div>
        ) : recError ? (
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 16, color: 'var(--c-text-3)', fontSize: 14 }}>
            {recError}
          </div>
        ) : null}
      </div>

      {/* Log form */}
      <button onClick={() => setLogOpen(o => !o)}
        style={{
          width: '100%', padding: '14px 18px',
          background: logOpen ? 'var(--c-primary)' : 'var(--c-card)',
          border: `1.5px solid ${logOpen ? 'var(--c-primary)' : 'var(--c-border)'}`,
          borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font)',
          display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s',
        }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: logOpen ? 'rgba(255,255,255,0.2)' : 'var(--c-primary-dim)', border: `1px solid ${logOpen ? 'rgba(255,255,255,0.3)' : 'var(--c-primary)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>➕</div>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: logOpen ? '#fff' : 'var(--c-text)' }}>Sport eintragen</div>
          <div style={{ fontSize: 12, color: logOpen ? 'rgba(255,255,255,0.7)' : 'var(--c-text-3)' }}>Lauf, Radfahren, Schwimmen …</div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={logOpen ? '#fff' : 'var(--c-text-3)'} strokeWidth="2.5" strokeLinecap="round" style={{ transition: 'transform 0.2s', transform: logOpen ? 'rotate(180deg)' : 'none' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {logOpen && (
        <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Datum</label>
              <input type="date" className="form-input" value={logForm.workout_date}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setLogForm(f => ({ ...f, workout_date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 1.4 }}>
              <label className="form-label">Sportart</label>
              <select className="form-input" value={logForm.workout_type}
                onChange={e => setLogForm(f => ({ ...f, workout_type: e.target.value }))}>
                {WORKOUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Distanz (km)</label>
              <input type="number" className="form-input" placeholder="0.0" value={logForm.distance_km} min={0} step={0.1}
                onChange={e => setLogForm(f => ({ ...f, distance_km: e.target.value }))} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Dauer (min)</label>
              <input type="number" className="form-input" placeholder="60" value={logForm.duration_min} min={0} step={1}
                onChange={e => setLogForm(f => ({ ...f, duration_min: e.target.value }))} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notizen</label>
            <textarea className="form-input" placeholder="Wie war's?" value={logForm.notes} rows={2}
              onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {/* RPE selector */}
          <div className="form-group">
            <label className="form-label">Anstrengung (optional)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {RPE_OPTIONS.map(r => (
                <button key={r.value} type="button"
                  onClick={() => setLogForm(f => ({ ...f, rpe: f.rpe === r.value ? null : r.value }))}
                  style={{
                    flex: 1, padding: '10px 6px', borderRadius: 10,
                    border: `2px solid ${logForm.rpe === r.value ? r.color : 'var(--c-border)'}`,
                    background: logForm.rpe === r.value ? r.color + '22' : 'var(--c-card)',
                    cursor: 'pointer', fontFamily: 'var(--font)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                    transition: 'all 0.15s',
                  }}>
                  <span style={{ fontSize: 20 }}>{r.emoji}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: logForm.rpe === r.value ? r.color : 'var(--c-text-3)' }}>{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={submitLog} disabled={logging}>
            {logging ? 'Speichern…' : 'Eintragen'}
          </button>
        </div>
      )}

      {/* RPE Post-Log Modal */}
      {rpeLogId && (
        <>
          <div onClick={() => setRpeLogId(null)} style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: 'rgba(0,0,0,0.45)',
          }} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
            background: 'var(--c-bg)', borderTop: '1.5px solid var(--c-border)',
            borderRadius: '20px 20px 0 0',
            padding: '20px 20px 44px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            boxShadow: '0 -8px 32px rgba(0,0,0,0.15)',
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--c-border)', marginBottom: 4 }} />
            <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--c-text)' }}>Wie war das Training? 💬</div>
            <p style={{ fontSize: 13, color: 'var(--c-text-3)', margin: '-8px 0 0', textAlign: 'center' }}>
              Das hilft mir, deinen nächsten Plan anzupassen.
            </p>
            <div style={{ display: 'flex', gap: 12, width: '100%' }}>
              {RPE_OPTIONS.map(r => (
                <button key={r.value} onClick={() => saveRpe(r.value)} disabled={rpeSaving}
                  style={{
                    flex: 1, padding: '18px 8px', borderRadius: 14,
                    border: `2px solid ${r.color}44`,
                    background: `${r.color}11`,
                    cursor: 'pointer', fontFamily: 'var(--font)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    transition: 'all 0.15s',
                    opacity: rpeSaving ? 0.6 : 1,
                  }}>
                  <span style={{ fontSize: 30 }}>{r.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: r.color }}>{r.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setRpeLogId(null)}
              style={{ background: 'none', border: 'none', color: 'var(--c-text-3)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)', padding: '4px 12px' }}>
              Überspringen
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── AI Workout Hint — built from AI plan session ───────────────────────────────
function getAIWorkoutHint(aiSession, paceConf) {
  if (!aiSession) return null
  return {
    pace: aiSession.pace || null,
    duration: aiSession.duration_min ? `${aiSession.duration_min} min` : null,
    structure: aiSession.structure || null,
    tip: aiSession.tip || null,
    // Show data confidence notice when pace is a rough estimate
    confidenceNote: paceConf.level === 'none' || paceConf.level === 'low'
      ? `Pace-Schätzung (${paceConf.dataPoints} Datenpunkte — logge mehr Einheiten für präzisere Vorgaben)`
      : paceConf.level === 'medium'
        ? `Basierend auf ${paceConf.dataPoints} Trainings`
        : null,
  }
}

// ── Static Workout Hints (fallback when no AI plan) ───────────────────────────
function getWorkoutHints(type, profile) {
  const targetMin = parseInt(profile.target_pace_min) || 5
  const targetSec = parseInt(profile.target_pace_sec) || 0
  const targetTotal = targetMin * 60 + targetSec

  const fmt = (sec) => {
    const s = Math.round(sec)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  switch (type) {
    case 'easy':
      return {
        pace: `${fmt(targetTotal + 75)}–${fmt(targetTotal + 90)} /km`,
        duration: '40–60 min',
        tip: 'Locker genug um sich zu unterhalten.',
      }
    case 'tempo':
      return {
        pace: `${fmt(targetTotal + 15)}–${fmt(targetTotal + 25)} /km`,
        structure: '10 min einlaufen → 20–25 min Tempo → 10 min auslaufen',
        tip: 'Komfortabel unangenehm — du könntest sprechen, aber lieber nicht.',
      }
    case 'long':
      return {
        pace: `${fmt(targetTotal + 60)}–${fmt(targetTotal + 75)} /km`,
        duration: '75–120 min',
        tip: 'Langsam genug um die ganze Zeit zu reden.',
      }
    case 'interval':
      return {
        pace: `${fmt(targetTotal - 10)}–${fmt(targetTotal + 5)} /km`,
        structure: '10 min einlaufen → 5–6 × 1 km (90 sek Pause) → 10 min auslaufen',
        tip: 'Jedes Intervall kontrolliert — gleichmäßiges Tempo ist wichtiger als schnell.',
      }
    case 'recovery':
      return {
        pace: `${fmt(targetTotal + 90)}–${fmt(targetTotal + 120)} /km`,
        duration: '20–35 min',
        tip: 'Aktive Erholung. Kein Druck — Beine lockermachen.',
      }
    default:
      return null
  }
}

// ── Pace Gap Card ──────────────────────────────────────────────────────────────
function PaceGapCard({ profile, predictedPaceSec, vo2max, category, daysLeft }) {
  // Use 0 as fallback so arithmetic never produces NaN; check combined total > 0
  const targetPaceMin = parseInt(profile.target_pace_min) || 0
  const targetPaceSec = parseInt(profile.target_pace_sec) || 0
  const targetTotal   = targetPaceMin * 60 + targetPaceSec

  // No target set (both fields missing/zero) — nothing to show
  if (!targetTotal) return null

  const hasStrava = !!predictedPaceSec

  // Gap: positive = user is slower than goal (needs improvement)
  //       negative = user is ahead of goal
  const gapSec = hasStrava ? Math.round(predictedPaceSec - targetTotal) : null

  // Color coding: within 10 sec = green, 10-30 = yellow, 30-60 = orange, >60 = red
  const gapColor = !hasStrava ? 'var(--c-text-3)'
    : gapSec <= 0   ? '#22c55e'   // at/ahead of goal
    : gapSec <= 10  ? '#22c55e'
    : gapSec <= 30  ? '#f59e0b'
    : gapSec <= 60  ? '#f97316'
    : '#ef4444'

  // Progress bar: how close to goal. Treat 90 sec gap as "starting point" (0%)
  const MAX_GAP = 90
  const pct = hasStrava
    ? Math.round(Math.min(100, Math.max(0, ((MAX_GAP - gapSec) / MAX_GAP) * 100)))
    : 0

  return (
    <div style={{
      background: 'var(--c-card)',
      border: `1px solid ${hasStrava ? gapColor + '55' : 'var(--c-border)'}`,
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px 8px',
        borderBottom: '1px solid var(--c-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          🎯 Marathonprognose
        </div>
        {daysLeft !== null && (
          <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>
            {daysLeft} Tage bis Marathon
          </div>
        )}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Pace comparison row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {/* Predicted / current */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {hasStrava ? 'Aktuelle Pace' : 'Keine Daten'}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: hasStrava ? gapColor : 'var(--c-text-3)', lineHeight: 1 }}>
              {hasStrava ? formatPaceSec(predictedPaceSec) : '—:——'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 3 }}>/km</div>
          </div>

          {/* Arrow */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>

          {/* Target pace */}
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ziel
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
              {String(targetPaceMin).padStart(2, '0')}:{String(targetPaceSec).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 3 }}>/km</div>
          </div>
        </div>

        {/* Progress bar */}
        {hasStrava && (
          <>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{
                height: '100%', borderRadius: 999,
                background: gapColor,
                width: `${pct}%`,
                transition: 'width 0.6s ease',
              }} />
            </div>

            {/* Gap label */}
            <div style={{ textAlign: 'center', fontSize: 13, color: gapSec <= 0 ? '#22c55e' : 'var(--c-text-2)', fontWeight: 600 }}>
              {gapSec <= 0
                ? `🎉 Ziel übertroffen — ${Math.abs(gapSec)} sek schneller als nötig!`
                : `Noch ${gapSec} sek/km bis zum Ziel`}
            </div>

            {/* Fitness footnote — category only, no raw VO2max number */}
            {vo2maxDisp && (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-text-3)', marginTop: 6 }}>
                {vo2maxDisp.label} ({vo2maxDisp.range}) · Wenn Marathon morgen wäre: {formatMarathonTime(predictedPaceSec)}
              </div>
            )}
          </>
        )}

        {/* No Strava data prompt */}
        {!hasStrava && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--c-text-3)', padding: '4px 0' }}>
            Verbinde Strava im Fitness-Tab für deine persönliche Prognose
          </div>
        )}
      </div>
    </div>
  )
}
