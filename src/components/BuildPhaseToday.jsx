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
  const [logging, setLogging]       = useState(false)
  const [logSaveError, setLogSaveError] = useState('')
  const [rpeLogId, setRpeLogId]   = useState(null)
  const [rpeSaving, setRpeSaving] = useState(false)

  // Keep log form type in sync with plan (on first load)
  useEffect(() => {
    if (!isRestDay && todayEntry?.type && !alreadyLogged) {
      setLogForm(f => ({ ...f, workout_type: todayEntry.type }))
    }
  }, [todayEntry?.type])

  async function submitLog() {
    if (!logForm.distance_km && !logForm.duration_min) {
      setLogSaveError('Gib zumindest Distanz oder Dauer ein.')
      return
    }
    setLogging(true)
    setLogSaveError('')
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
      setLogSaveError('')
      setLogForm({ workout_date: new Date().toISOString().split('T')[0], workout_type: 'easy', distance_km: '', duration_min: '', notes: '', rpe: null })
      if (!logForm.rpe) setRpeLogId(data.id)
    } catch (err) {
      setLogSaveError(err.message || 'Fehler beim Speichern. Bitte nochmal versuchen.')
    } finally {
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
              {/* AI type override badge — show when AI recommends a different workout than the schedule */}
              {!alreadyLogged && !isRestDay && aiSession && todayEntry && aiSession.type !== todayEntry.type && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
                  background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
                  borderRadius: 8, padding: '4px 10px', fontSize: 12,
                }}>
                  <span>🤖</span>
                  <span style={{ color: 'var(--c-primary)', fontWeight: 600 }}>
                    KI empfiehlt heute: {TYPE_META[aiSession.type]?.label || aiSession.type}
                  </span>
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
        vo2maxDisp={vo2maxDisp}
        category={category}
        daysLeft={daysLeft}
      />

      {/* Week plan overview — remaining sessions + next week preview */}
      <WeekPlanOverview aiPlan={aiPlan} />

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

          {logSaveError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠</span> {logSaveError}
            </div>
          )}

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

// ── Week Plan Overview — remaining sessions from AI plan ──────────────────────
function WeekPlanOverview({ aiPlan }) {
  const [showNextWeek, setShowNextWeek] = useState(false)

  if (!aiPlan?.sessions?.length) return null

  // Convert to app convention: 0=Mon ... 6=Sun (same as AI plan)
  const todayDow = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1

  // Remaining sessions this week (after today, not next week)
  const remainingThisWeek = aiPlan.sessions.filter(s =>
    !s.isNextWeek && s.dayOfWeek > todayDow
  )

  // Next week sessions
  const nextWeekSessions = aiPlan.sessions.filter(s => s.isNextWeek)

  if (remainingThisWeek.length === 0 && nextWeekSessions.length === 0) return null

  const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Diese Woche</h3>
        {aiPlan.weekTheme && (
          <span style={{ fontSize: 12, color: 'var(--c-text-3)', fontStyle: 'italic', maxWidth: '55%', textAlign: 'right', lineHeight: 1.3 }}>
            {aiPlan.weekTheme}
          </span>
        )}
      </div>

      {remainingThisWeek.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {remainingThisWeek.map((session, i) => (
            <SessionRow key={i} session={session} dayName={DAY_NAMES[session.dayOfWeek]} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--c-text-3)', padding: '6px 0' }}>
          Keine weiteren Einheiten diese Woche.
        </div>
      )}

      {nextWeekSessions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowNextWeek(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-2)' }}>
              Nächste Woche
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-3)" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: showNextWeek ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showNextWeek && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {nextWeekSessions.map((session, i) => (
                <SessionRow key={i} session={session} dayName={DAY_NAMES[session.dayOfWeek]} muted />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SessionRow({ session, dayName, muted = false }) {
  const [expanded, setExpanded] = useState(false)
  const meta = TYPE_META[session.type] || TYPE_META.easy
  const hasDetails = session.structure || session.tip || session.pace

  return (
    <div style={{
      background: 'var(--c-card)',
      border: `1px solid ${expanded ? meta.color + '55' : muted ? 'var(--c-border)' : meta.color + '33'}`,
      borderRadius: 10,
      overflow: 'hidden',
      opacity: muted ? 0.8 : 1,
      transition: 'border-color 0.15s',
    }}>
      {/* Summary row — always visible, tappable */}
      <button
        onClick={() => hasDetails && setExpanded(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: hasDetails ? 'pointer' : 'default',
          fontFamily: 'var(--font)', padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
        }}
      >
        {/* Day badge */}
        <div style={{
          width: 34, flexShrink: 0, textAlign: 'center',
          background: muted ? 'var(--c-card-hover)' : meta.color + '18',
          borderRadius: 8, padding: '5px 0',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: muted ? 'var(--c-text-3)' : meta.color, textTransform: 'uppercase' }}>
            {dayName}
          </div>
          <div style={{ fontSize: 18, lineHeight: 1.2 }}>{meta.icon}</div>
        </div>

        {/* Label + stats */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: muted ? 'var(--c-text-2)' : 'var(--c-text)' }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-text-3)', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            {session.distance_km && <span>{session.distance_km} km</span>}
            {session.duration_min && <span>{session.duration_min} min</span>}
            {session.pace && (
              <span style={{ color: muted ? 'var(--c-text-3)' : meta.color, fontWeight: 600 }}>
                @ {session.pace}
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        {hasDetails && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="var(--c-text-3)" strokeWidth="2.5" strokeLinecap="round"
            style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M6 9l6 6 6-6"/>
          </svg>
        )}
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${meta.color}22`,
          padding: '10px 14px 12px',
          background: meta.color + '08',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {session.structure && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                Aufbau
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.5 }}>
                {session.structure}
              </div>
            </div>
          )}
          {session.pace && (
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{
                background: 'var(--c-card)', border: `1px solid ${meta.color}33`,
                borderRadius: 8, padding: '6px 12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>Pace</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: meta.color }}>{session.pace}</div>
              </div>
              {session.duration_min && (
                <div style={{
                  background: 'var(--c-card)', border: '1px solid var(--c-border)',
                  borderRadius: 8, padding: '6px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>Dauer</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>{session.duration_min} min</div>
                </div>
              )}
              {session.distance_km && (
                <div style={{
                  background: 'var(--c-card)', border: '1px solid var(--c-border)',
                  borderRadius: 8, padding: '6px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>Distanz</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>{session.distance_km} km</div>
                </div>
              )}
            </div>
          )}
          {session.tip && (
            <div style={{ fontSize: 12, color: 'var(--c-text-2)', fontStyle: 'italic', lineHeight: 1.5 }}>
              💡 {session.tip}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pace Gap Card ──────────────────────────────────────────────────────────────
function PaceGapCard({ profile, predictedPaceSec, vo2max, vo2maxDisp, category, daysLeft }) {
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
            {vo2maxDisp && predictedPaceSec && (
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
