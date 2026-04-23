import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../supabase'
import {
  getCurrentPlanPosition,
  getTodayWorkout,
  getNextWorkout,
  formatWorkoutType,
  formatDuration,
  daysUntilMarathon,
  isInBuildPhase,
  getMondayOf,
} from '../../utils/planUtils'
import BuildPhaseToday from '../BuildPhaseToday'

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

const RPE_OPTIONS = [
  { value: 1, emoji: '😌', label: 'Leicht', color: '#22c55e' },
  { value: 2, emoji: '💪', label: 'Gut',    color: '#4a9eff' },
  { value: 3, emoji: '🔥', label: 'Hart',   color: '#ef4444' },
]

const TYPE_COLORS = {
  easy: 'var(--c-easy)', tempo: 'var(--c-tempo)', interval: 'var(--c-interval)',
  long: 'var(--c-long)', recovery: 'var(--c-recovery)', cross: 'var(--c-cross)',
  swim: '#4a9eff', hike: '#ff8c42', strength: '#c77dff', yoga: '#1D9E75',
  other: 'var(--c-text-2)',
}

const TYPE_ICONS = {
  easy: '🏃', tempo: '⚡', interval: '🔥', long: '🛣️',
  recovery: '🌿', cross: '🚴', swim: '🏊', hike: '🥾',
  strength: '🏋️', yoga: '🧘', other: '📝',
}

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function TodayTab({ user, profile, trainingPlan, completedWorkoutIds, onToggleComplete, workoutLogs, onLogAdded, onLogDeleted, stravaRuns = [], onConfirmRacePlan, aiPlan = null, aiPlanGenerating = false }) {
  const trainingMode = profile.training_mode || 'race'
  const hasMarathon = !!profile.marathon_date

  // For fitness/tracking modes there's no marathon — guard all marathon-date calls
  const buildPhase = useMemo(() => {
    if (trainingMode === 'fitness') return true   // always in build phase
    if (trainingMode === 'tracking') return false  // no plan at all
    return hasMarathon ? isInBuildPhase(profile.marathon_date) : false
  }, [trainingMode, hasMarathon, profile.marathon_date])

  const pos = useMemo(() => {
    if (!hasMarathon) return { status: 'active', week: 1, totalWeeks: 0 }
    return getCurrentPlanPosition(profile.marathon_date)
  }, [hasMarathon, profile.marathon_date])

  const todayWorkout = useMemo(() => {
    if (!trainingPlan || !hasMarathon) return null
    return getTodayWorkout(trainingPlan.plan_data, profile.marathon_date)
  }, [trainingPlan, hasMarathon, profile.marathon_date])

  const nextWorkout = useMemo(() => {
    if (!trainingPlan || !hasMarathon) return null
    return getNextWorkout(trainingPlan.plan_data, profile.marathon_date, completedWorkoutIds)
  }, [trainingPlan, hasMarathon, profile.marathon_date, completedWorkoutIds])

  const daysLeft = useMemo(() => {
    if (!hasMarathon) return null
    return daysUntilMarathon(profile.marathon_date)
  }, [hasMarathon, profile.marathon_date])

  const [logOpen, setLogOpen] = useState(false)
  const [logForm, setLogForm] = useState({
    workout_date: todayStr(),
    workout_type: todayWorkout?.type || 'easy',
    distance_km: '',
    duration_min: '',
    notes: '',
    rpe: null,
  })
  const [logging, setLogging] = useState(false)
  const [logError, setLogError] = useState('')
  const [rpeLogId, setRpeLogId] = useState(null)
  const [rpeSaving, setRpeSaving] = useState(false)

  const displayWorkout = todayWorkout || nextWorkout?.workout

  function updateLog(key, val) { setLogForm(f => ({ ...f, [key]: val })) }

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

  async function submitLog() {
    setLogError('')
    if (!logForm.workout_type) { setLogError('Wähle einen Typ.'); return }
    if (!logForm.distance_km && !logForm.duration_min) {
      setLogError('Gib zumindest Distanz oder Dauer ein.'); return
    }
    setLogging(true)
    try {
      const { data, error } = await supabase.from('workout_logs').insert({
        user_id: user.id,
        workout_date: logForm.workout_date,
        workout_type: logForm.workout_type,
        distance_km: logForm.distance_km ? parseFloat(logForm.distance_km) : null,
        duration_min: logForm.duration_min ? parseFloat(logForm.duration_min) : null,
        notes: logForm.notes.trim() || null,
        rpe: logForm.rpe || null,
        plan_workout_id: logForm.workout_date === todayStr() && todayWorkout ? todayWorkout.id : null,
      }).select().single()

      if (error) throw error

      onLogAdded(data)
      setLogOpen(false)
      setLogForm({ workout_date: todayStr(), workout_type: 'easy', distance_km: '', duration_min: '', notes: '', rpe: null })
      if (!logForm.rpe) setRpeLogId(data.id)
    } catch (err) {
      setLogError(err.message || 'Fehler beim Speichern.')
    } finally {
      setLogging(false)
    }
  }

  const recentLogs = [...workoutLogs]
    .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
    .slice(0, 6)

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2 style={{ fontSize: '1.125rem' }}>
            {new Date().toLocaleDateString('de-AT', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
            {trainingMode === 'fitness' ? 'Fitness-Modus · Aufbauphase' :
             trainingMode === 'tracking' ? 'Training-Tracker' :
             pos.status === 'active' ? `Trainingswoche ${pos.week} von ${pos.totalWeeks}` :
             pos.status === 'not_started' ? `Startet in ${pos.daysUntilStart} Tagen` :
             'Plan abgeschlossen!'}
          </p>
        </div>
        {daysLeft !== null && (
          <div style={{
            background: daysLeft <= 14 ? 'var(--c-primary-dim)' : 'var(--c-card)',
            border: `1px solid ${daysLeft <= 14 ? 'var(--c-primary)' : 'var(--c-border)'}`,
            borderRadius: 'var(--r-md)', padding: 'var(--sp-2) var(--sp-3)', textAlign: 'center', minWidth: 60,
          }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: daysLeft <= 14 ? 'var(--c-primary)' : 'var(--c-text)', lineHeight: 1 }}>
              {daysLeft}
            </div>
            <div style={{ fontSize: '0.6875rem', color: daysLeft <= 14 ? 'var(--c-primary)' : 'var(--c-text-3)', fontWeight: 600, lineHeight: 1.3, marginTop: 2 }}>
              Tage bis<br/>Marathon
            </div>
          </div>
        )}
      </div>

      <div className="screen-scroll">
        <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

          {/* TRACKING MODE — passive AI observer */}
          {trainingMode === 'tracking' && workoutLogs.length >= 3 && (
            <TrackingObserverCard workoutLogs={workoutLogs} profile={profile} />
          )}

          {/* AUFBAUPHASE */}
          {buildPhase ? (
            <BuildPhaseToday
              user={user}
              profile={profile}
              stravaRuns={stravaRuns}
              workoutLogs={workoutLogs}
              onLogAdded={onLogAdded}
              onConfirmRacePlan={onConfirmRacePlan}
              aiPlan={aiPlan}
              aiPlanGenerating={aiPlanGenerating}
            />
          ) : (<>

          {/* Quick-Log Button — always visible at top */}
          <button
            onClick={() => setLogOpen(o => !o)}
            style={{
              width: '100%', padding: '14px 18px',
              background: logOpen ? 'var(--c-primary)' : 'var(--c-card)',
              border: `1.5px solid ${logOpen ? 'var(--c-primary)' : 'var(--c-border)'}`,
              borderRadius: 14, cursor: 'pointer', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: logOpen ? 'rgba(255,255,255,0.2)' : 'var(--c-primary-dim)',
              border: `1px solid ${logOpen ? 'rgba(255,255,255,0.3)' : 'var(--c-primary)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
            }}>➕</div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: logOpen ? '#fff' : 'var(--c-text)' }}>
                Sport eintragen
              </div>
              <div style={{ fontSize: 12, color: logOpen ? 'rgba(255,255,255,0.7)' : 'var(--c-text-3)' }}>
                Lauf, Radfahren, Schwimmen …
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={logOpen ? '#fff' : 'var(--c-text-3)'}
              strokeWidth="2.5" strokeLinecap="round"
              style={{ transition: 'transform 0.2s', transform: logOpen ? 'rotate(180deg)' : 'none' }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {/* Log Form */}
          {logOpen && (
            <div style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 14, padding: 18,
              display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)',
            }}>
              {/* Date + Type row */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Datum</label>
                  <input
                    type="date"
                    className="form-input"
                    value={logForm.workout_date}
                    max={todayStr()}
                    onChange={e => updateLog('workout_date', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1.4 }}>
                  <label className="form-label">Sportart</label>
                  <select className="form-input" value={logForm.workout_type} onChange={e => updateLog('workout_type', e.target.value)}>
                    {WORKOUT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Distance + Duration */}
              <div style={{ display: 'flex', gap: 10 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Distanz (km)</label>
                  <input
                    type="number" className="form-input" placeholder="0.0"
                    value={logForm.distance_km} min={0} step={0.1}
                    onChange={e => updateLog('distance_km', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Dauer (min)</label>
                  <input
                    type="number" className="form-input" placeholder="60"
                    value={logForm.duration_min} min={0} step={1}
                    onChange={e => updateLog('duration_min', e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notizen (optional)</label>
                <textarea
                  className="form-input"
                  placeholder="Wie war's? Besonderheiten?"
                  value={logForm.notes}
                  onChange={e => updateLog('notes', e.target.value)}
                  rows={2}
                />
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

              {logError && <div className="alert alert-error"><span>⚠</span> {logError}</div>}

              <button className="btn btn-primary btn-lg" onClick={submitLog} disabled={logging}>
                {logging ? 'Speichern…' : 'Eintragen'}
              </button>
            </div>
          )}

          {/* Today's Workout */}
          {displayWorkout && (
            <WorkoutHero
              workout={displayWorkout}
              isToday={!!todayWorkout}
              nextDate={!todayWorkout && nextWorkout?.workoutDate}
              nextWeek={!todayWorkout && nextWorkout?.week}
              isDone={completedWorkoutIds.includes(displayWorkout.id)}
              onToggle={() => onToggleComplete(displayWorkout.id)}
            />
          )}

          {/* Recent Activity */}
          {recentLogs.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 'var(--sp-3)', fontSize: '1rem' }}>Letzte Aktivitäten</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {recentLogs.map(log => {
                  const color = TYPE_COLORS[log.workout_type] || 'var(--c-text-2)'
                  const icon = TYPE_ICONS[log.workout_type] || '📝'
                  const rpeEmoji = log.rpe ? ['', '😌', '💪', '🔥'][log.rpe] : null
                  return (
                    <div key={log.id} className="card card-sm" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 'var(--r-md)',
                        background: `${color}22`, border: `1px solid ${color}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: '1rem',
                      }}>
                        {icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--c-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {WORKOUT_TYPES.find(t => t.value === log.workout_type)?.label.replace(/^.\s/, '') || log.workout_type}
                          {rpeEmoji && <span style={{ fontSize: 14 }}>{rpeEmoji}</span>}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)' }}>
                          {log.distance_km ? `${log.distance_km} km` : ''}
                          {log.distance_km && log.duration_min ? ' · ' : ''}
                          {log.duration_min ? formatDuration(log.duration_min) : ''}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', flexShrink: 0 }}>
                        {formatRelativeDate(log.workout_date)}
                      </div>
                      {onLogDeleted && (
                        <button
                          onClick={() => onLogDeleted(log.id)}
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--c-text-3)',
                            cursor: 'pointer', padding: '4px 6px', fontSize: 16, flexShrink: 0,
                            borderRadius: 6, lineHeight: 1,
                          }}
                          title="Löschen"
                        >🗑</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {recentLogs.length === 0 && !displayWorkout && (
            <div className="empty-state">
              <div className="empty-state-icon">👟</div>
              <h3>Noch keine Aktivitäten</h3>
              <p>Trag deinen ersten Sport ein!</p>
            </div>
          )}
          </>)}

          {/* Weekly Summary — always visible */}
          <WeeklySummaryCard workoutLogs={workoutLogs} profile={profile} />

        </div>
      </div>

      {/* RPE Post-Log Modal */}
      {rpeLogId && (
        <>
          {/* Backdrop */}
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

function WorkoutHero({ workout, isToday, nextDate, nextWeek, isDone, onToggle }) {
  const color = {
    easy: 'var(--c-easy)', tempo: 'var(--c-tempo)', interval: 'var(--c-interval)',
    long: 'var(--c-long)', recovery: 'var(--c-recovery)', cross: 'var(--c-cross)',
  }[workout.type] || 'var(--c-primary)'

  return (
    <div className="workout-hero" style={{ borderColor: isToday ? color : 'var(--c-border)' }}>
      <div className="workout-hero-label">
        {isToday ? 'Heutiges Training' : nextDate
          ? `Nächstes: ${nextDate.toLocaleDateString('de-AT', { weekday: 'short', month: 'short', day: 'numeric' })}`
          : 'Nächste Einheit'}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {formatWorkoutType(workout.type)}
            </span>
            {nextWeek && <span style={{ fontSize: '0.75rem', color: 'var(--c-text-3)' }}>Woche {nextWeek}</span>}
          </div>
          <h2 style={{ fontSize: '1.25rem', marginBottom: 'var(--sp-3)', color: 'var(--c-text)' }}>{workout.title}</h2>
          {workout.description && (
            <p style={{ fontSize: '0.875rem', color: 'var(--c-text-2)', lineHeight: 1.55, marginBottom: 'var(--sp-4)' }}>
              {workout.description}
            </p>
          )}
        </div>
      </div>

      <div className="workout-hero-stats">
        {workout.distance_km && (
          <div className="workout-hero-stat">
            <div className="workout-hero-stat-value">{workout.distance_km}</div>
            <div className="workout-hero-stat-label">km</div>
          </div>
        )}
        {workout.duration_min && (
          <div className="workout-hero-stat">
            <div className="workout-hero-stat-value">{formatDuration(workout.duration_min)}</div>
            <div className="workout-hero-stat-label">Dauer</div>
          </div>
        )}
        {workout.pace_target && (
          <div className="workout-hero-stat">
            <div className="workout-hero-stat-value" style={{ fontSize: '1rem' }}>{workout.pace_target}</div>
            <div className="workout-hero-stat-label">Zielpace</div>
          </div>
        )}
      </div>

      {isToday && (
        <button
          onClick={onToggle}
          style={{
            marginTop: 'var(--sp-5)', width: '100%', padding: 'var(--sp-3)',
            borderRadius: 'var(--r-md)',
            border: `1.5px solid ${isDone ? 'var(--c-primary)' : 'var(--c-border-light)'}`,
            background: isDone ? 'var(--c-primary)' : 'transparent',
            color: isDone ? '#fff' : 'var(--c-text-2)',
            fontWeight: 600, fontSize: '0.9375rem', cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-2)',
            fontFamily: 'var(--font)',
          }}
        >
          {isDone ? (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> Erledigt</>
          ) : (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> Als erledigt markieren</>
          )}
        </button>
      )}
    </div>
  )
}

function WeeklySummaryCard({ workoutLogs, profile }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const monday = getMondayOf(today)
  const mondayStr = monday.toISOString().split('T')[0]
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const sundayStr = sunday.toISOString().split('T')[0]

  const thisWeek = workoutLogs.filter(l => l.workout_date >= mondayStr && l.workout_date <= sundayStr)
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7)
  const lastMondayStr = lastMonday.toISOString().split('T')[0]
  const lastWeek = workoutLogs.filter(l => l.workout_date >= lastMondayStr && l.workout_date < mondayStr)

  // Don't show on Monday morning if nothing logged yet this week — would show 0/X confusingly
  const isMondayEmpty = today.getDay() === 1 && thisWeek.length === 0
  if ((thisWeek.length === 0 && lastWeek.length === 0) || isMondayEmpty) return null

  // If this week is empty but last week has data, show last week's summary instead
  const showingLastWeek = thisWeek.length === 0 && lastWeek.length > 0
  const activeLogs = showingLastWeek ? lastWeek : thisWeek
  const activeMonday = showingLastWeek ? lastMonday : monday
  const activeSunday = showingLastWeek
    ? new Date(lastMonday.getTime() + 6 * 86400000)
    : sunday

  const planned = profile.sessions_per_week || 3
  const done = activeLogs.length
  const totalKm = Math.round(activeLogs.reduce((s, l) => s + (l.distance_km || 0), 0) * 10) / 10

  // For km trend: compare this week vs last week (only meaningful when showing this week)
  const lastKm = Math.round(lastWeek.reduce((s, l) => s + (l.distance_km || 0), 0) * 10) / 10
  const kmDiff = totalKm - lastKm
  const kmTrend = !showingLastWeek && lastKm > 0
    ? (kmDiff >= 0 ? `+${kmDiff.toFixed(1)}` : kmDiff.toFixed(1))
    : null

  const rpeItems = activeLogs.filter(l => l.rpe != null)
  const avgRpe = rpeItems.length > 0
    ? rpeItems.reduce((s, l) => s + l.rpe, 0) / rpeItems.length : null
  const rpeEmoji = avgRpe === null ? null : avgRpe < 1.5 ? '😌' : avgRpe < 2.5 ? '💪' : '🔥'

  const pct = Math.min(1, done / Math.max(planned, 1))
  const barColor = pct >= 1 ? '#22c55e' : pct >= 0.5 ? '#4a9eff' : 'var(--c-primary)'

  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 14, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
          {showingLastWeek ? 'Letzte Woche' : 'Diese Woche'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
          {activeMonday.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })} – {activeSunday.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 999, transition: 'width 0.5s ease' }} />
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: done >= planned ? '#22c55e' : 'var(--c-text)', lineHeight: 1 }}>
            {done}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-3)' }}>/{planned}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>Einheiten</div>
        </div>
        {totalKm > 0 && (
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
              {totalKm}
              {kmTrend && (
                <span style={{ fontSize: 12, fontWeight: 600, color: kmDiff >= 0 ? '#22c55e' : '#ef4444', marginLeft: 4 }}>
                  {kmTrend}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>km</div>
          </div>
        )}
        {rpeEmoji && (
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, lineHeight: 1 }}>{rpeEmoji}</div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>Ø Anstrengung</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tracking Observer Card ─────────────────────────────────────────────────────
// Passive AI coach for tracking mode: observes patterns and gives insights.
function TrackingObserverCard({ workoutLogs, profile }) {
  const [insight, setInsight]     = useState(null)
  const [loading, setLoading]     = useState(false)
  const [lastLogCount, setLastLogCount] = useState(0)

  const shouldRefresh = workoutLogs.length !== lastLogCount

  useEffect(() => {
    if (!shouldRefresh && insight) return
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey || workoutLogs.length < 3) return

    setLoading(true)
    const sorted = [...workoutLogs]
      .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
      .slice(0, 10)

    const RPE_LABELS = { 1: 'leicht', 2: 'moderat', 3: 'sehr hart' }
    const logsText = sorted.map(l =>
      `${l.workout_date}: ${l.workout_type}${l.distance_km ? ` ${l.distance_km}km` : ''}${l.duration_min ? ` ${l.duration_min}min` : ''}${l.rpe ? ` (${RPE_LABELS[l.rpe]})` : ''}`
    ).join('\n')

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Analysiere diese Trainingseinheiten und gib eine kurze, präzise Beobachtung (1-2 Sätze, kein Smalltalk, direkt):

${logsText}

Level: ${profile.level || 'unbekannt'}

Beobachte: Konsistenz, Volumen-Trend, Intensitätsmuster, auffällige Muster.
Antworte mit JSON: {"observation": "...", "emoji": "📈|📉|⚡|💤|🔥|✅"}`,
        }],
      }),
    })
    .then(r => r.json())
    .then(data => {
      const text = data.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        setInsight(parsed)
        setLastLogCount(workoutLogs.length)
      }
    })
    .catch(() => {})
    .finally(() => setLoading(false))
  }, [workoutLogs.length, shouldRefresh])

  if (!insight && !loading) return null

  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-border)',
      borderRadius: 12, padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>
        {loading ? '🤖' : insight?.emoji || '📊'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Coach beobachtet
        </div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--c-text-3)' }}>Analysiere dein Training…</div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.5 }}>
            {insight?.observation}
          </div>
        )}
      </div>
    </div>
  )
}

function formatRelativeDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.round((today - date) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  if (diff < 7) return `vor ${diff}d`
  return date.toLocaleDateString('de-AT', { month: 'short', day: 'numeric' })
}
