import { useState, useMemo } from 'react'
import {
  getCurrentPlanPosition,
  getWorkoutDate,
  formatWorkoutType,
  formatDuration,
  formatDistance,
  DAYS_SHORT,
  isInBuildPhase,
} from '../../utils/planUtils'
import BuildPhasePlan from '../BuildPhasePlan'

const TYPE_COLORS = {
  easy:     'var(--c-easy)',
  tempo:    'var(--c-tempo)',
  interval: 'var(--c-interval)',
  long:     'var(--c-long)',
  recovery: 'var(--c-recovery)',
  cross:    'var(--c-cross)',
  swim:     '#4a9eff',
  hike:     '#ff8c42',
  strength: '#c77dff',
  yoga:     '#1D9E75',
  rest:     'var(--c-rest)',
  other:    'var(--c-text-2)',
}

const TYPE_ICONS = {
  easy: '🏃', tempo: '⚡', interval: '🔥', long: '🛣️',
  recovery: '🌿', cross: '🚴', swim: '🏊', hike: '🥾',
  strength: '🏋️', yoga: '🧘', other: '📝',
}

const TYPE_LABELS = {
  easy: 'Easy Run', tempo: 'Tempo', interval: 'Intervall', long: 'Langer Lauf',
  recovery: 'Regeneration', cross: 'Radfahren', swim: 'Schwimmen',
  hike: 'Wandern', strength: 'Krafttraining', yoga: 'Yoga', other: 'Sonstiges',
}

export default function PlanTab({ profile, trainingPlan, completedWorkoutIds, onToggleComplete, workoutLogs = [], stravaRuns = [], onProfileUpdate }) {
  const trainingMode = profile.training_mode || 'race'
  const hasMarathon  = !!profile.marathon_date

  // Fitness mode → always build phase. Tracking mode → no plan (early return below).
  const buildPhase = useMemo(() => {
    if (trainingMode === 'fitness') return true
    if (trainingMode === 'tracking') return false
    return hasMarathon ? isInBuildPhase(profile.marathon_date) : true
  }, [trainingMode, hasMarathon, profile.marathon_date])

  const pos = useMemo(() => {
    if (!hasMarathon) return { status: 'active', week: 1, totalWeeks: 0 }
    return getCurrentPlanPosition(profile.marathon_date)
  }, [hasMarathon, profile.marathon_date])

  // Must be declared before currentWeek to avoid temporal dead zone
  const totalWeeks = trainingPlan?.plan_data?.weeks?.length || 18

  const currentWeek = pos.status === 'active' ? pos.week : pos.status === 'finished' ? pos.totalWeeks : 1
  const [viewWeek, setViewWeek] = useState(currentWeek)
  const [expandedId, setExpandedId] = useState(null)
  const [toggling, setToggling] = useState(null)

  const weekData = trainingPlan?.plan_data?.weeks?.find(w => w.week === viewWeek)

  // Find logged workouts for a specific date
  function logsForDate(date) {
    const dateStr = date.toISOString().split('T')[0]
    return workoutLogs.filter(l => l.workout_date === dateStr)
  }

  async function handleToggle(workout) {
    setToggling(workout.id)
    await onToggleComplete(workout.id)
    setToggling(null)
  }

  // Tracking mode: no plan view
  if (trainingMode === 'tracking') {
    return (
      <div className="screen">
        <div className="screen-header">
          <h2 style={{ fontSize: '1.125rem' }}>Plan</h2>
        </div>
        <div className="screen-scroll">
          <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 'var(--sp-4)' }}>
            <div style={{ fontSize: '3rem' }}>📊</div>
            <h3 style={{ textAlign: 'center' }}>Kein Trainingsplan</h3>
            <p style={{ textAlign: 'center', color: 'var(--c-text-2)', maxWidth: 280, fontSize: '0.9rem', lineHeight: 1.5 }}>
              Im Tracking-Modus gibt es keinen vorgegebenen Plan. Logge dein Training im Heute-Tab und sieh deine Fortschritte im Fitness-Tab.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      {/* Header */}
      <div className="screen-header" style={{ flexDirection: 'column', gap: 'var(--sp-3)', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.125rem' }}>
              {trainingMode === 'fitness' ? 'Aufbauplan' : 'Training Plan'}
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
              {trainingMode === 'fitness' ? 'Fitness-Modus' : profile.marathon_name}
            </p>
          </div>
          {pos.status === 'active' && (
            <div style={{
              background: 'var(--c-primary-dim)',
              border: '1px solid var(--c-primary)',
              borderRadius: 'var(--r-full)',
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--c-primary)',
            }}>
              Week {pos.week}
            </div>
          )}
        </div>

        {/* Week navigator */}
        <div className="week-header" style={{ marginBottom: 0 }}>
          <button
            className="week-nav-btn"
            disabled={viewWeek <= 1}
            onClick={() => setViewWeek(v => v - 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>

          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>
              Week {viewWeek}
              {viewWeek === pos.week && pos.status === 'active' && (
                <span style={{
                  marginLeft: 8, fontSize: '0.6875rem',
                  background: 'var(--c-primary)', color: '#fff',
                  borderRadius: 'var(--r-full)', padding: '2px 7px', fontWeight: 700,
                }}>JETZT</span>
              )}
            </div>
            {weekData?.theme && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginTop: 2 }}>{weekData.theme}</div>
            )}
          </div>

          <button
            className="week-nav-btn"
            disabled={viewWeek >= totalWeeks}
            onClick={() => setViewWeek(v => v + 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="screen-scroll">
        <div className="screen-content">
          {buildPhase && (
            <BuildPhasePlan
              profile={profile}
              stravaRuns={stravaRuns}
              workoutLogs={workoutLogs}
              onProfileUpdate={onProfileUpdate}
            />
          )}
          {!buildPhase && <WeeklyPlanView
            weekData={weekData} viewWeek={viewWeek} pos={pos} profile={profile}
            trainingPlan={trainingPlan} completedWorkoutIds={completedWorkoutIds}
            workoutLogs={workoutLogs} expandedId={expandedId} setExpandedId={setExpandedId}
            toggling={toggling} handleToggle={handleToggle} logsForDate={logsForDate}
          />}
        </div>
      </div>
    </div>
  )
}

function WeeklyPlanView({ weekData, viewWeek, pos, profile, trainingPlan, completedWorkoutIds, workoutLogs, expandedId, setExpandedId, toggling, handleToggle, logsForDate }) {
  return (<>
          {/* Week stats */}
          {weekData && (
            <div style={{
              display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)',
            }}>
              <div style={{ flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{weekData.total_km ?? '—'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 2 }}>km gesamt</div>
              </div>
              <div style={{ flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{weekData.workouts?.filter(w => w.type !== 'rest').length ?? 0}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 2 }}>Einheiten</div>
              </div>
              <div style={{ flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-3)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--c-primary)' }}>
                  {weekData.workouts?.filter(w => w.type !== 'rest' && completedWorkoutIds.includes(w.id)).length ?? 0}
                  <span style={{ fontSize: '0.875rem', color: 'var(--c-text-3)', fontWeight: 400 }}>
                    /{weekData.workouts?.filter(w => w.type !== 'rest').length ?? 0}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 2 }}>erledigt</div>
              </div>
            </div>
          )}

          {/* Workouts list */}
          {weekData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {/* Show all days in order */}
              {[...Array(7)].map((_, dayIdx) => {
                const workout = weekData.workouts?.find(w => w.day_of_week === dayIdx)
                const workoutDate = getWorkoutDate(profile.marathon_date, viewWeek, dayIdx)
                const isToday = new Date().toDateString() === workoutDate.toDateString()
                const isPast = workoutDate < new Date() && !isToday

                const dayLogs = logsForDate(workoutDate)

                if (!workout) {
                  // Rest / unplanned day — but show any logged activity
                  return (
                    <div key={dayIdx} style={{
                      background: 'var(--c-card)',
                      border: `1px solid ${dayLogs.length > 0 ? 'var(--c-border-light)' : 'var(--c-border)'}`,
                      borderRadius: 'var(--r-md)',
                      padding: 'var(--sp-3) var(--sp-4)',
                      opacity: dayLogs.length > 0 ? 1 : 0.4,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                        <div style={{ width: 36, textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: isToday ? 'var(--c-primary)' : 'var(--c-text-3)', textTransform: 'uppercase' }}>
                            {DAYS_SHORT[dayIdx]}
                          </div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: isToday ? 'var(--c-primary)' : 'var(--c-text-3)' }}>
                            {workoutDate.getDate()}
                          </div>
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--c-text-3)' }}>
                          {dayLogs.length === 0 ? 'Ruhetag' : ''}
                        </div>
                      </div>
                      {/* Spontaneous logs on this day */}
                      {dayLogs.map(log => (
                        <div key={log.id} style={{
                          marginTop: 8, marginLeft: 48,
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          <span style={{ fontSize: '0.9rem' }}>{TYPE_ICONS[log.workout_type] || '📝'}</span>
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: TYPE_COLORS[log.workout_type] || 'var(--c-text)' }}>
                              {TYPE_LABELS[log.workout_type] || log.workout_type}
                              <span style={{ marginLeft: 6, fontSize: '0.75rem', background: 'var(--c-primary-dim)', color: 'var(--c-primary)', borderRadius: 6, padding: '1px 6px', fontWeight: 700 }}>spontan</span>
                            </div>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)' }}>
                              {log.distance_km ? `${log.distance_km} km` : ''}
                              {log.distance_km && log.duration_min ? ' · ' : ''}
                              {log.duration_min ? `${log.duration_min} min` : ''}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                }

                const isDone = completedWorkoutIds.includes(workout.id)
                const isExpanded = expandedId === workout.id
                const color = TYPE_COLORS[workout.type] || 'var(--c-text)'
                const planDayLogs = logsForDate(workoutDate)

                return (
                  <div key={dayIdx}
                    style={{
                      background: 'var(--c-card)',
                      border: `1px solid ${isToday ? 'var(--c-primary)' : isDone ? 'var(--c-border-light)' : 'var(--c-border)'}`,
                      borderRadius: 'var(--r-md)',
                      overflow: 'hidden',
                      opacity: isDone && !isExpanded ? 0.65 : 1,
                      transition: 'all 0.15s',
                      boxShadow: isToday ? '0 0 0 1px var(--c-primary-dim)' : 'none',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-4)', cursor: 'pointer', alignItems: 'flex-start' }}
                      onClick={() => setExpandedId(isExpanded ? null : workout.id)}
                    >
                      {/* Date */}
                      <div style={{ width: 36, textAlign: 'center', flexShrink: 0, paddingTop: 2 }}>
                        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: isToday ? 'var(--c-primary)' : 'var(--c-text-3)', textTransform: 'uppercase' }}>
                          {DAYS_SHORT[dayIdx]}
                        </div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: isToday ? 'var(--c-primary)' : 'var(--c-text-2)' }}>
                          {workoutDate.getDate()}
                        </div>
                      </div>

                      {/* Type stripe */}
                      <div style={{ width: 3, borderRadius: 2, background: color, alignSelf: 'stretch', flexShrink: 0, minHeight: 40 }} />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 3 }}>
                          <span style={{
                            fontSize: '0.75rem', fontWeight: 700, color,
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                          }}>
                            {formatWorkoutType(workout.type)}
                          </span>
                          {isToday && (
                            <span style={{ fontSize: '0.6875rem', background: 'var(--c-primary)', color: '#fff', borderRadius: 'var(--r-full)', padding: '1px 6px', fontWeight: 700 }}>
                              HEUTE
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--c-text)' }}>
                          {workout.title}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
                          {workout.distance_km ? `${workout.distance_km} km` : ''}
                          {workout.distance_km && workout.duration_min ? ' · ' : ''}
                          {workout.duration_min ? formatDuration(workout.duration_min) : ''}
                          {workout.pace_target ? ` · ${workout.pace_target}` : ''}
                        </div>
                      </div>

                      {/* Check button */}
                      <button
                        className="checkbox"
                        style={{ marginTop: 4 }}
                        onClick={e => { e.stopPropagation(); handleToggle(workout) }}
                        disabled={toggling === workout.id}
                      >
                        {toggling === workout.id ? (
                          <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                        ) : isDone ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : null}
                      </button>
                    </div>

                    {/* Expanded description */}
                    {isExpanded && workout.description && (
                      <div style={{
                        padding: 'var(--sp-3) var(--sp-4)',
                        paddingTop: 0,
                        paddingLeft: 'calc(var(--sp-4) + 36px + var(--sp-3) + 3px + var(--sp-3))',
                        borderTop: '1px solid var(--c-border)',
                        marginTop: 'var(--sp-2)',
                      }}>
                        <p style={{ fontSize: '0.875rem', color: 'var(--c-text-2)', lineHeight: 1.55 }}>
                          {workout.description}
                        </p>
                        {workout.pace_target && (
                          <div style={{ marginTop: 'var(--sp-2)', fontSize: '0.8125rem' }}>
                            <span style={{ color: 'var(--c-text-3)' }}>Ziel: </span>
                            <span style={{ color, fontWeight: 600 }}>{workout.pace_target}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Spontaneous extra logs on this planned day */}
                    {planDayLogs.length > 0 && (
                      <div style={{ borderTop: '1px solid var(--c-border)', padding: '8px 16px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {planDayLogs.map(log => (
                          <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '0.85rem' }}>{TYPE_ICONS[log.workout_type] || '📝'}</span>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)' }}>
                              <span style={{ fontWeight: 600, color: TYPE_COLORS[log.workout_type] || 'var(--c-text)' }}>
                                {TYPE_LABELS[log.workout_type] || log.workout_type}
                              </span>
                              {log.distance_km ? ` · ${log.distance_km} km` : ''}
                              {log.duration_min ? ` · ${log.duration_min} min` : ''}
                              <span style={{ marginLeft: 6, fontSize: '0.7rem', background: 'var(--c-primary-dim)', color: 'var(--c-primary)', borderRadius: 6, padding: '1px 5px', fontWeight: 700 }}>eingetragen</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h3>Woche {viewWeek} nicht gefunden</h3>
              <p>Keine Plandaten für diese Woche verfügbar.</p>
            </div>
          )}
  </>)
}
