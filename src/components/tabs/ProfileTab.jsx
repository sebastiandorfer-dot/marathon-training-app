import { useState } from 'react'
import { supabase } from '../../supabase'
import {
  formatPace,
  daysUntilMarathon,
  planCompletionPct,
  formatWorkoutType,
  formatDuration,
} from '../../utils/planUtils'
import {
  deriveMaxHR,
  calculateVO2max,
  predictMarathonPaceFromVO2max,
  formatPaceSec,
  formatMarathonTime,
  vo2maxCategory,
  weeklyMileageStats,
} from '../../utils/fitnessUtils'

const DAYS_FULL = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

const DAYS_SHORT_PROFILE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export default function ProfileTab({ user, profile, trainingPlan, workoutLogs, completedWorkoutIds, stravaRuns = [], onProfileUpdate, onSignOut, onRegeneratePlan, onDeletePlan }) {
  const [editingContext, setEditingContext] = useState(false)
  const [contextValue, setContextValue] = useState(profile.context || '')
  const [savingContext, setSavingContext] = useState(false)
  const [contextSaved, setContextSaved] = useState(false)
  const [contextError, setContextError] = useState('')

  // Pace editing
  const [editingPace, setEditingPace] = useState(false)
  const [paceMin, setPaceMin] = useState(profile.target_pace_min ?? '')
  const [paceSec, setPaceSec] = useState(profile.target_pace_sec ?? '')
  const [savingPace, setSavingPace] = useState(false)
  const [paceSaved, setPaceSaved] = useState(false)
  const [paceError, setPaceError] = useState('')

  // Training schedule editing
  const [editingSchedule, setEditingSchedule]       = useState(false)
  const [schedTrainingDays, setSchedTrainingDays]   = useState(profile.training_days || [])
  const [schedSessionsPerWeek, setSchedSessionsPerWeek] = useState(
    profile.sessions_per_week ?? Math.min(4, (profile.training_days || []).length)
  )
  const [schedBlockedDays, setSchedBlockedDays]     = useState(profile.blocked_days || [])
  const [schedFlexibility, setSchedFlexibility]     = useState(profile.flexibility_mode || 'flexible')
  const [savingSchedule, setSavingSchedule]         = useState(false)
  const [scheduleSaved, setScheduleSaved]           = useState(false)

  function toggleSchedTraining(idx) {
    setSchedTrainingDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx]
    )
    // Can't be both training and blocked
    setSchedBlockedDays(prev => prev.filter(d => d !== idx))
  }

  function toggleSchedBlocked(idx) {
    if (schedTrainingDays.includes(idx)) return // training days can't be blocked
    setSchedBlockedDays(prev =>
      prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx]
    )
  }

  async function saveSchedule() {
    if (schedTrainingDays.length === 0) return
    setSavingSchedule(true)
    try {
      const updates = {
        training_days:        schedTrainingDays,
        sessions_per_week:    schedSessionsPerWeek,
        blocked_days:         schedBlockedDays,
        flexibility_mode:     schedFlexibility,
        // Reset schedule cache + stamp today as the new schedule start date
        build_phase_schedule: null,
        schedule_since:       new Date().toISOString().split('T')[0],
      }
      const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
      if (error) throw error
      onProfileUpdate({ ...profile, ...updates })
      setScheduleSaved(true)
      setEditingSchedule(false)
      setTimeout(() => setScheduleSaved(false), 2500)
    } catch (err) {
      console.error(err)
    } finally {
      setSavingSchedule(false)
    }
  }

  function cancelScheduleEdit() {
    setSchedTrainingDays(profile.training_days || [])
    setSchedSessionsPerWeek(profile.sessions_per_week ?? Math.min(4, (profile.training_days || []).length))
    setSchedBlockedDays(profile.blocked_days || [])
    setSchedFlexibility(profile.flexibility_mode || 'flexible')
    setEditingSchedule(false)
  }

  const daysLeft = profile.marathon_date ? daysUntilMarathon(profile.marathon_date) : null
  const completionPct = planCompletionPct(trainingPlan?.plan_data, completedWorkoutIds)

  const totalKm = workoutLogs.reduce((sum, l) => sum + (l.distance_km || 0), 0)
  const totalWorkouts = workoutLogs.length

  // Fitness data from Strava
  const maxHR = deriveMaxHR(stravaRuns)
  const vo2max = calculateVO2max(stravaRuns, maxHR)
  const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
  const category = vo2max ? vo2maxCategory(vo2max) : null
  const mileage = weeklyMileageStats(stravaRuns)

  const sortedLogs = [...workoutLogs].sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))

  async function saveContext() {
    setSavingContext(true)
    setContextError('')
    try {
      const { error } = await supabase.from('profiles').update({
        context: contextValue.trim(),
      }).eq('id', user.id)
      if (error) throw error
      onProfileUpdate({ ...profile, context: contextValue.trim() })
      setContextSaved(true)
      setEditingContext(false)
      setTimeout(() => setContextSaved(false), 2500)
    } catch (err) {
      setContextError(err.message || 'Failed to save.')
    } finally {
      setSavingContext(false)
    }
  }

  async function savePace() {
    const min = parseInt(paceMin)
    const sec = parseInt(paceSec)
    if (isNaN(min) || min < 3 || min > 9 || isNaN(sec) || sec < 0 || sec > 59) {
      setPaceError('Pace muss zwischen 3:00 und 9:59 min/km liegen.')
      return
    }
    setSavingPace(true)
    setPaceError('')
    try {
      const { error } = await supabase.from('profiles').update({
        target_pace_min: min,
        target_pace_sec: sec,
      }).eq('id', user.id)
      if (error) throw error
      onProfileUpdate({ ...profile, target_pace_min: min, target_pace_sec: sec })
      setPaceSaved(true)
      setEditingPace(false)
      setTimeout(() => setPaceSaved(false), 2500)
    } catch (err) {
      setPaceError(err.message || 'Fehler beim Speichern.')
    } finally {
      setSavingPace(false)
    }
  }

  async function handleSignOut() {
    if (!confirm('Wirklich abmelden?')) return
    await supabase.auth.signOut()
    onSignOut()
  }

  const marathonDateFormatted = profile.marathon_date
    ? new Date(profile.marathon_date).toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : null

  return (
    <div className="screen">
      <div className="screen-header">
        <h2 style={{ fontSize: '1.125rem' }}>Profil</h2>
        <button className="btn btn-sm btn-ghost btn-danger" onClick={handleSignOut}>
          Abmelden
        </button>
      </div>

      <div className="screen-scroll">
        <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

          {/* Profile header */}
          <div className="card" style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 'var(--r-full)',
              background: 'var(--c-primary-dim)', border: '2px solid var(--c-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', flexShrink: 0,
            }}>
              🏃
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--c-text-2)', marginTop: 2, textTransform: 'capitalize' }}>
                {[
                  profile.level,
                  profile.target_pace_min != null ? `Ziel: ${formatPace(profile.target_pace_min, profile.target_pace_sec)}/km` : null,
                ].filter(Boolean).join(' · ') || (profile.training_mode === 'tracking' ? 'Tracking-Modus' : 'Fitness-Modus')}
              </div>
            </div>
          </div>

          {/* Marathon countdown — only for race mode */}
          {marathonDateFormatted && (
            <div className="card" style={{
              background: daysLeft !== null && daysLeft <= 14 ? 'var(--c-primary-dim)' : 'var(--c-card)',
              border: daysLeft !== null && daysLeft <= 14 ? '1px solid var(--c-primary)' : '1px solid var(--c-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--c-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                    Renntag
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--c-text)' }}>{profile.marathon_name}</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--c-text-2)', marginTop: 2 }}>{marathonDateFormatted}</div>
                </div>
                <div style={{ textAlign: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: 800, color: daysLeft !== null && daysLeft <= 14 ? 'var(--c-primary)' : 'var(--c-text)', lineHeight: 1 }}>
                    {daysLeft}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', fontWeight: 600 }}>Tage noch</div>
                </div>
              </div>
            </div>
          )}

          {/* Fitness card (Strava data) */}
          {(vo2max || mileage.last4avg > 0) && (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <h3 style={{ fontSize: '1rem' }}>🫁 Fitness-Überblick</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
                {vo2max && (
                  <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-primary)' }}>
                      {Math.round(vo2max)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
                      VO₂max · {category?.label}
                    </div>
                  </div>
                )}
                {predictedPaceSec && (
                  <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>
                      {formatMarathonTime(predictedPaceSec)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
                      Aktuelle Prognose
                    </div>
                  </div>
                )}
                {mileage.last4avg > 0 && (
                  <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>
                      {mileage.last4avg}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
                      ⌀ km/Woche (4W)
                    </div>
                  </div>
                )}
                {stravaRuns.length > 0 && (
                  <div style={{ background: 'var(--c-bg)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>
                      {stravaRuns.length}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
                      Strava-Läufe
                    </div>
                  </div>
                )}
              </div>
              {predictedPaceSec && (
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', borderTop: '1px solid var(--c-border)', paddingTop: 10 }}>
                  Prognose basiert auf VO₂max {Math.round(vo2max)} · Zielpace {formatPace(profile.target_pace_min, profile.target_pace_sec)}/km
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div>
            <h3 style={{ marginBottom: 'var(--sp-3)', fontSize: '1rem' }}>Trainingsstatistik</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{totalKm.toFixed(0)}</div>
                <div className="stat-label">km eingetragen</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{totalWorkouts}</div>
                <div className="stat-label">Einheiten</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--c-primary)' }}>{completionPct}%</div>
                <div className="stat-label">Plan erfüllt</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatPace(profile.target_pace_min, profile.target_pace_sec)}</div>
                <div className="stat-label">Zielpace/km</div>
              </div>
            </div>

            {completionPct > 0 && (
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${completionPct}%` }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 4 }}>
                  {completedWorkoutIds.length} von {trainingPlan?.plan_data?.weeks?.reduce((sum, w) => sum + (w.workouts?.filter(w => w.type !== 'rest').length || 0), 0) || '?'} Einheiten abgeschlossen
                </div>
              </div>
            )}
          </div>

          {/* Profile details */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <h3 style={{ fontSize: '1rem' }}>Trainingsdetails</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <ProfileRow label="Level" value={<span style={{ textTransform: 'capitalize' }}>{profile.level}</span>} />
              <ProfileRow label="Trainingstage" value={(profile.training_days || []).map(d => DAYS_FULL[d]).join(', ')} />
              {profile.cross_training_sports?.length > 0 && (
                <ProfileRow label="Cross-Training" value={profile.cross_training_sports.join(', ')} />
              )}
            </div>
          </div>

          {/* Editable Zielpace */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1rem' }}>Zielpace</h3>
              {!editingPace ? (
                <button className="btn btn-sm btn-ghost" onClick={() => { setEditingPace(true); setPaceMin(profile.target_pace_min ?? ''); setPaceSec(profile.target_pace_sec ?? ''); setPaceError('') }}>Bearbeiten</button>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setEditingPace(false); setPaceError('') }}>Abbrechen</button>
                  <button className="btn btn-sm btn-primary" onClick={savePace} disabled={savingPace}>
                    {savingPace ? 'Speichern…' : 'Speichern'}
                  </button>
                </div>
              )}
            </div>

            {!editingPace ? (
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--c-primary)' }}>
                  {formatPace(profile.target_pace_min, profile.target_pace_sec)}
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--c-text-3)', marginLeft: 6 }}>min/km</span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginTop: 4 }}>
                  Dein Zieltempo für den Marathon. Wird für Pace-Berechnungen und den KI-Plan verwendet.
                </div>
                {paceSaved && <div className="alert alert-success" style={{ marginTop: 'var(--sp-3)' }}><span>✓</span> Gespeichert! KI-Plan wird aktualisiert.</div>}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginBottom: 'var(--sp-3)' }}>
                  Gib dein Zieltempo pro Kilometer ein (z.B. 5:30 = 5 min 30 sek).
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number" className="form-input" placeholder="5"
                      value={paceMin} min={3} max={9} step={1}
                      onChange={e => setPaceMin(e.target.value)}
                      style={{ width: 70, textAlign: 'center', fontSize: '1.25rem', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: '1.1rem', color: 'var(--c-text-3)', fontWeight: 700 }}>:</span>
                    <input
                      type="number" className="form-input" placeholder="30"
                      value={paceSec} min={0} max={59} step={1}
                      onChange={e => setPaceSec(e.target.value)}
                      style={{ width: 70, textAlign: 'center', fontSize: '1.25rem', fontWeight: 700 }}
                    />
                  </div>
                  <span style={{ fontSize: '0.875rem', color: 'var(--c-text-3)' }}>min/km</span>
                </div>
                {paceError && <div className="alert alert-error" style={{ marginTop: 'var(--sp-3)' }}><span>⚠</span> {paceError}</div>}
              </div>
            )}
          </div>

          {/* Training schedule editing */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: '1rem' }}>Trainingstage</h3>
              {!editingSchedule ? (
                <button className="btn btn-sm btn-ghost" onClick={() => setEditingSchedule(true)}>Bearbeiten</button>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button className="btn btn-sm btn-ghost" onClick={cancelScheduleEdit}>Abbrechen</button>
                  <button className="btn btn-sm btn-primary" onClick={saveSchedule} disabled={savingSchedule || schedTrainingDays.length === 0}>
                    {savingSchedule ? 'Speichern…' : 'Speichern'}
                  </button>
                </div>
              )}
            </div>

            {!editingSchedule ? (
              // Read-only view
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {DAYS_SHORT_PROFILE.map((day, idx) => {
                    const isPref    = (profile.training_days || []).includes(idx)
                    const isBlocked = (profile.blocked_days || []).includes(idx)
                    return (
                      <div key={idx} style={{
                        padding: '4px 10px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                        background: isBlocked ? 'var(--c-border)' : isPref ? 'var(--c-primary-dim)' : 'transparent',
                        border: `1.5px solid ${isBlocked ? 'var(--c-border)' : isPref ? 'var(--c-primary)' : 'var(--c-border)'}`,
                        color: isBlocked ? 'var(--c-text-3)' : isPref ? 'var(--c-primary)' : 'var(--c-text-3)',
                      }}>
                        {isBlocked ? '🚫' : ''}{day}
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 4 }}>
                  <strong>{profile.sessions_per_week ?? (profile.training_days || []).length}×</strong> pro Woche ·{' '}
                  {profile.flexibility_mode === 'strict'
                    ? '🔒 Nur diese Tage'
                    : '🔄 Flexibel'}
                </div>
                {scheduleSaved && <div className="alert alert-success"><span>✓</span> Gespeichert! KI-Plan wird aktualisiert.</div>}
              </div>
            ) : (
              // Edit view
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                {/* Available days */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)', marginBottom: 4 }}>
                    Mögliche Trainingstage
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 8 }}>
                    Alle Tage, an denen du grundsätzlich trainieren könntest.
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {DAYS_SHORT_PROFILE.map((day, idx) => {
                      const active  = schedTrainingDays.includes(idx)
                      const blocked = schedBlockedDays.includes(idx)
                      return (
                        <button key={idx} onClick={() => {
                          toggleSchedTraining(idx)
                          // Reduce sessions if we're removing a day below the sessions count
                          const newLen = active ? schedTrainingDays.length - 1 : schedTrainingDays.length + 1
                          if (active && newLen < schedSessionsPerWeek) setSchedSessionsPerWeek(Math.max(1, newLen))
                        }}
                          style={{
                            padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                            border: `1.5px solid ${active ? 'var(--c-primary)' : 'var(--c-border)'}`,
                            background: active ? 'var(--c-primary-dim)' : 'transparent',
                            color: active ? 'var(--c-primary)' : 'var(--c-text-3)',
                            cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.15s',
                            opacity: blocked ? 0.4 : 1,
                          }}>
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Sessions per week */}
                <div style={{ padding: '12px 14px', background: 'var(--c-bg)', borderRadius: 12, border: '1px solid var(--c-border)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)', marginBottom: 4 }}>
                    Einheiten pro Woche: <span style={{ color: 'var(--c-primary)' }}>{schedSessionsPerWeek}×</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 10 }}>
                    Wie oft du tatsächlich trainieren möchtest.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[1,2,3,4,5,6,7].filter(n => n <= schedTrainingDays.length).map(n => (
                      <button key={n} onClick={() => setSchedSessionsPerWeek(n)}
                        style={{
                          width: 36, height: 36, borderRadius: '50%', fontWeight: 700, fontSize: 14,
                          cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.15s',
                          background: schedSessionsPerWeek === n ? 'var(--c-primary)' : 'transparent',
                          border: `2px solid ${schedSessionsPerWeek === n ? 'var(--c-primary)' : 'var(--c-border)'}`,
                          color: schedSessionsPerWeek === n ? '#fff' : 'var(--c-text-2)',
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Flexibility mode */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)', marginBottom: 8 }}>
                    Flexibilität
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[
                      { id: 'strict',   label: '🔒 Nur diese Tage', desc: 'Kein Training an anderen Tagen' },
                      { id: 'flexible', label: '🔄 Flexibel',       desc: 'Andere Tage möglich bei Bedarf' },
                    ].map(opt => (
                      <div key={opt.id} onClick={() => setSchedFlexibility(opt.id)}
                        style={{
                          flex: 1, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
                          border: `1.5px solid ${schedFlexibility === opt.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                          background: schedFlexibility === opt.id ? 'var(--c-primary-dim)' : 'var(--c-card)',
                        }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: schedFlexibility === opt.id ? 'var(--c-primary)' : 'var(--c-text)', marginBottom: 2 }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{opt.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blocked days (only shown for flexible mode) */}
                {schedFlexibility === 'flexible' && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)', marginBottom: 4 }}>
                      Gesperrte Tage <span style={{ fontWeight: 400, color: 'var(--c-text-3)' }}>(niemals Training)</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 8 }}>
                      An gesperrten Tagen wird nie automatisch Training eingeplant.
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {DAYS_SHORT_PROFILE.map((day, idx) => {
                        const isTraining = schedTrainingDays.includes(idx)
                        const isBlocked  = schedBlockedDays.includes(idx)
                        return (
                          <button key={idx} onClick={() => toggleSchedBlocked(idx)}
                            disabled={isTraining}
                            style={{
                              padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                              border: `1.5px solid ${isBlocked ? '#ef4444' : 'var(--c-border)'}`,
                              background: isBlocked ? '#ef444422' : 'transparent',
                              color: isTraining ? 'var(--c-text-3)' : isBlocked ? '#ef4444' : 'var(--c-text-2)',
                              cursor: isTraining ? 'not-allowed' : 'pointer',
                              fontFamily: 'var(--font)', transition: 'all 0.15s',
                              opacity: isTraining ? 0.35 : 1,
                            }}>
                            {isBlocked ? '🚫 ' : ''}{day}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {schedTrainingDays.length === 0 && (
                  <div style={{ fontSize: 12, color: '#ef4444' }}>Mindestens 1 Trainingstag auswählen.</div>
                )}
              </div>
            )}
          </div>

          {/* Editable context */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
              <h3 style={{ fontSize: '1rem' }}>Über mich</h3>
              {!editingContext ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => { setEditingContext(true); setContextValue(profile.context || '') }}
                >
                  Bearbeiten
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setEditingContext(false); setContextError('') }}>
                    Abbrechen
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={saveContext} disabled={savingContext}>
                    {savingContext ? 'Speichern…' : 'Speichern'}
                  </button>
                </div>
              )}
            </div>

            {editingContext ? (
              <>
                <textarea
                  className="form-input"
                  value={contextValue}
                  onChange={e => setContextValue(e.target.value)}
                  rows={6}
                  placeholder="Erzähl deinem Coach von dir: Verletzungen, Ziele, vergangene Rennen, Zeitplanung…"
                  autoFocus
                />
                {contextError && <div className="alert alert-error" style={{ marginTop: 'var(--sp-3)' }}><span>⚠</span> {contextError}</div>}
              </>
            ) : profile.context ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--c-text-2)', lineHeight: 1.6 }}>{profile.context}</p>
            ) : (
              <p style={{ fontSize: '0.875rem', color: 'var(--c-text-3)', fontStyle: 'italic' }}>
                Noch nichts eingetragen. Füge Infos zu deinen Zielen, Verletzungen und Erfahrungen hinzu — dein Coach kann dann besser beraten.
              </p>
            )}

            {contextSaved && (
              <div className="alert alert-success" style={{ marginTop: 'var(--sp-3)' }}><span>✓</span> Gespeichert!</div>
            )}
          </div>

          {/* Activity Log */}
          {sortedLogs.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 'var(--sp-3)', fontSize: '1rem' }}>Aktivitätslog</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {sortedLogs.map(log => (
                  <div key={log.id} className="card card-sm" style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
                    <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 44 }}>
                      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase' }}>
                        {new Date(log.workout_date).toLocaleDateString('de-AT', { month: 'short' })}
                      </div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--c-text)', lineHeight: 1 }}>
                        {new Date(log.workout_date).getDate()}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{formatWorkoutType(log.workout_type)}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
                        {log.distance_km ? `${log.distance_km} km` : ''}
                        {log.distance_km && log.duration_min ? ' · ' : ''}
                        {log.duration_min ? formatDuration(log.duration_min) : ''}
                      </div>
                      {log.notes && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginTop: 4 }}>{log.notes}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan Management */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <h3 style={{ fontSize: '1rem' }}>Trainingsplan</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--c-text-2)' }}>
              Neuen Plan generieren lässt die KI deinen Plan basierend auf deinem aktuellen Profil und Marathondatum neu erstellen.
            </p>
            <button
              className="btn btn-ghost btn-lg"
              onClick={() => { if (confirm('Neuen Trainingsplan generieren? Dein aktueller Plan wird ersetzt.')) onRegeneratePlan() }}
            >
              🔄 Plan neu generieren
            </button>
            <button
              className="btn btn-danger"
              style={{ width: '100%' }}
              onClick={() => { if (confirm('Trainingsplan löschen? Das kann nicht rückgängig gemacht werden.')) onDeletePlan() }}
            >
              🗑 Plan löschen
            </button>
          </div>

          {/* Danger zone */}
          <div style={{ paddingBottom: 'var(--sp-4)' }}>
            <button
              className="btn btn-danger btn-lg"
              onClick={handleSignOut}
              style={{ width: '100%' }}
            >
              Abmelden
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '0.875rem', color: 'var(--c-text-3)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: '0.875rem', color: 'var(--c-text)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
