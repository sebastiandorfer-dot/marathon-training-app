import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { daysUntilMarathon, daysUntilRacePlan } from '../utils/planUtils'
import {
  deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max,
  formatPaceSec, weeklyMileageStats,
} from '../utils/fitnessUtils'
import {
  isHard,
  smartPlace,
  buildBaseSchedule,
  initSchedule,
  getMondayOf,
  computeWeekDisplay,
  getBuildPhaseKmTarget,
  AUTO_TYPES,
  getWeeklyTypes,
  hasConflict,
} from '../utils/buildPhaseUtils'
import { getPaceTargetRange } from '../utils/stravaUtils'

const DAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const TYPE_META = {
  easy:     { label: 'Easy Lauf',    color: 'var(--c-easy)',      icon: '🏃' },
  tempo:    { label: 'Tempo',        color: 'var(--c-tempo)',     icon: '⚡' },
  long:     { label: 'Langer Lauf',  color: 'var(--c-long)',      icon: '🛣️' },
  cross:    { label: 'Radfahren',    color: 'var(--c-cross)',     icon: '🚴' },
  strength: { label: 'Kraft',        color: '#c77dff',            icon: '🏋️' },
  recovery: { label: 'Erholung',     color: 'var(--c-recovery)',  icon: '🌿' },
  rest:     { label: 'Ruhetag',      color: 'var(--c-text-3)',    icon: '💤' },
  swim:     { label: 'Schwimmen',    color: '#4a9eff',            icon: '🏊' },
  hike:     { label: 'Wandern',      color: '#ff8c42',            icon: '🥾' },
  yoga:     { label: 'Yoga',         color: '#1D9E75',            icon: '🧘' },
  other:    { label: 'Sonstiges',    color: 'var(--c-text-2)',    icon: '📝' },
  blocked:  { label: 'Gesperrt',     color: 'var(--c-text-3)',    icon: '🚫' },
  missed:   { label: 'Verpasst',     color: 'var(--c-text-3)',    icon: '—'  },
}

// Running types — only these are ever auto-scheduled
const RUN_TYPES = [
  { id: 'easy',     label: 'Easy Lauf',   icon: '🏃' },
  { id: 'tempo',    label: 'Tempo',       icon: '⚡' },
  { id: 'long',     label: 'Langer Lauf', icon: '🛣️' },
  { id: 'recovery', label: 'Erholung',    icon: '🌿' },
  { id: 'rest',     label: 'Ruhetag',     icon: '💤' },
]

// Other sports — manual override only, never auto-suggested
const OTHER_SPORT_TYPES = [
  { id: 'cross',    label: 'Radfahren',   icon: '🚴' },
  { id: 'swim',     label: 'Schwimmen',   icon: '🏊' },
  { id: 'strength', label: 'Kraft',       icon: '🏋️' },
  { id: 'hike',     label: 'Wandern',     icon: '🥾' },
  { id: 'yoga',     label: 'Yoga',        icon: '🧘' },
]

/**
 * Rebuild base template when user edits one day.
 * Redistributes remaining types to other preferred days.
 */
function rebuildAfterEdit(changedDay, newType, profile) {
  const blocked   = profile.blocked_days || []
  const preferred = profile.training_days || []

  const next = {}
  for (let i = 0; i < 7; i++) next[i] = 'rest'
  next[changedDay] = newType

  const allActive = [...new Set([
    ...preferred.filter(d => !blocked.includes(d)),
    ...(newType !== 'rest' && !blocked.includes(changedDay) ? [changedDay] : []),
  ])].sort()

  const types = getWeeklyTypes(allActive.length, profile.level || 'intermediate')

  // Remove the chosen type from the distribution (already placed)
  const remaining = [...types]
  if (newType !== 'rest') {
    const idx = remaining.indexOf(newType)
    if (idx >= 0) remaining.splice(idx, 1)
  }

  const otherDays = allActive.filter(d => d !== changedDay)
  const placed = smartPlace(remaining, otherDays, { [changedDay]: newType })
  Object.assign(next, placed)
  next[changedDay] = newType
  return next
}

// ── AI Day Detail — expandable structure/tip panel for weekly plan cards ──────
function AIDayDetail({ session, meta }) {
  const [open, setOpen] = useState(false)
  const hasContent = session.structure || session.tip

  return (
    <div style={{ borderTop: `1px solid ${meta.color}22` }}>
      {/* Toggle strip */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font)', padding: '5px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>
          🤖 KI-Details
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--c-text-3)" strokeWidth="2.5" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && hasContent && (
        <div style={{
          padding: '8px 14px 12px',
          background: meta.color + '08',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {session.pace && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{
                background: 'var(--c-card)', border: `1px solid ${meta.color}33`,
                borderRadius: 8, padding: '5px 10px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 1 }}>Pace</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{session.pace}</div>
              </div>
              {session.distance_km && (
                <div style={{
                  background: 'var(--c-card)', border: '1px solid var(--c-border)',
                  borderRadius: 8, padding: '5px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 1 }}>Distanz</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>{session.distance_km} km</div>
                </div>
              )}
              {session.duration_min && (
                <div style={{
                  background: 'var(--c-card)', border: '1px solid var(--c-border)',
                  borderRadius: 8, padding: '5px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginBottom: 1 }}>Dauer</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>{session.duration_min} min</div>
                </div>
              )}
            </div>
          )}
          {session.structure && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Aufbau</div>
              <div style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.5 }}>{session.structure}</div>
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

const MILESTONE_OPTIONS = [
  {
    id: 'weekly_km',
    icon: '📈',
    title: 'Wochenkilometer aufbauen',
    description: 'Progressiv mehr Kilometer laufen bis zum Rennplan-Start',
    color: 'var(--c-easy)',
    getTarget: (profile, mileage, daysToRacePlan) => {
      const weeksLeft = Math.ceil(daysToRacePlan / 7)
      const current = mileage.last4avg || 20
      const target = Math.round(current * 1.3 / 5) * 5
      return { current: `${current} km/Woche`, target: `${target} km/Woche`, weeks: weeksLeft }
    },
    renderProgress: (data, mileage) => {
      const current = mileage.last4avg || 0
      const target = parseFloat(data?.target) || 40
      const pct = Math.min(100, Math.round((current / target) * 100))
      return { pct, label: `${current} / ${target} km pro Woche` }
    },
  },
  {
    id: 'vo2max',
    icon: '🫁',
    title: 'VO₂max steigern',
    description: 'Aerobe Kapazität verbessern durch regelmäßiges Training',
    color: '#4a9eff',
    getTarget: (profile, mileage, daysToRacePlan, vo2max) => {
      if (!vo2max) return null
      const target = Math.round(vo2max + Math.min(5, vo2max * 0.08))
      return { current: `${Math.round(vo2max)}`, target: `${target} ml/kg/min` }
    },
    renderProgress: (data, mileage, vo2max) => {
      if (!vo2max) return { pct: 0, label: 'Keine HR-Daten verfügbar' }
      const current = Math.round(vo2max)
      const target = parseFloat(data?.target) || current + 5
      const baseline = current - 5
      const pct = Math.min(100, Math.round(((current - baseline) / (target - baseline)) * 100))
      return { pct, label: `VO₂max ${current} → Ziel ${target} ml/kg/min` }
    },
  },
  {
    id: 'pace',
    icon: '⚡',
    title: 'Easy Pace verbessern',
    description: 'Schneller werden bei gleicher Herzfrequenz',
    color: 'var(--c-tempo)',
    getTarget: (profile, mileage, daysToRacePlan, vo2max, predictedPaceSec) => {
      const targetPaceMin = parseInt(profile.target_pace_min) || 5
      const targetPaceSec = parseInt(profile.target_pace_sec) || 0
      const targetTotal   = targetPaceMin * 60 + targetPaceSec
      const easyPace      = Math.round(targetTotal * 1.15)
      const currentPace   = predictedPaceSec ? Math.round(predictedPaceSec * 1.15) : easyPace + 30
      return { current: formatPaceSec(currentPace) + '/km', target: formatPaceSec(easyPace) + '/km', currentSec: currentPace, targetSec: easyPace }
    },
    renderProgress: (data, mileage, vo2max, predictedPaceSec) => {
      if (!data?.targetSec || !data?.currentSec) return { pct: 0, label: 'Keine Daten' }
      const startPace = data.currentSec + 60
      const pct = Math.min(100, Math.round(((startPace - data.currentSec) / (startPace - data.targetSec)) * 100))
      return { pct: Math.max(0, pct), label: `Easy Pace ${data.current} → Ziel ${data.target}` }
    },
  },
  {
    id: 'consistency',
    icon: '🗓️',
    title: 'Konstanz aufbauen',
    description: 'Regelmäßig trainieren und eine Routine etablieren',
    color: '#1D9E75',
    getTarget: (profile) => {
      const days = (profile.training_days || []).length
      return { current: `${days} Tage/Woche geplant`, target: `${days} Wochen konstant trainieren` }
    },
    renderProgress: (data, mileage, vo2max, predictedPaceSec, workoutLogs) => {
      const now = new Date()
      let consistentWeeks = 0
      for (let i = 0; i < 8; i++) {
        const weekStart = new Date(now)
        weekStart.setDate(now.getDate() - i * 7 - now.getDay())
        weekStart.setHours(0, 0, 0, 0)
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7)
        const hasWorkout = (workoutLogs || []).some(l => {
          const d = new Date(l.workout_date)
          return d >= weekStart && d < weekEnd
        })
        if (hasWorkout) consistentWeeks++
      }
      const pct = Math.round((consistentWeeks / 8) * 100)
      return { pct, label: `${consistentWeeks} von 8 Wochen aktiv` }
    },
  },
]

export default function BuildPhasePlan({ profile, stravaRuns = [], workoutLogs = [], onProfileUpdate, onLogAdded, weekOffset: weekOffsetProp, onWeekOffsetChange, aiPlan = null }) {
  const trainingMode    = profile.training_mode || 'race'
  const hasMarathon     = !!profile.marathon_date
  const daysToRacePlan  = hasMarathon ? daysUntilRacePlan(profile.marathon_date) : null
  const weeksToRacePlan = daysToRacePlan !== null ? Math.ceil(daysToRacePlan / 7) : null

  const maxHR           = deriveMaxHR(stravaRuns)
  const vo2max          = calculateVO2max(stravaRuns, maxHR)
  const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
  const mileage         = weeklyMileageStats(stravaRuns)

  const [selectedMilestones, setSelectedMilestones] = useState(() => {
    const stored = profile.selected_milestones
    return Array.isArray(stored) && stored.length > 0 ? stored : ['weekly_km', 'consistency']
  })
  const [milestoneEditing, setMilestoneEditing] = useState(false)
  // weekOffset is lifted to PlanTab when the parent provides weekOffsetProp/onWeekOffsetChange
  const [localWeekOffset, setLocalWeekOffset] = useState(0)
  const weekOffset    = weekOffsetProp !== undefined ? weekOffsetProp : localWeekOffset
  const setWeekOffset = onWeekOffsetChange ?? setLocalWeekOffset
  const [schedule, setSchedule]     = useState(() => initSchedule(profile, workoutLogs))
  const [scheduleEditing, setScheduleEditing] = useState(false)

  // Re-initialize schedule when profile training settings or workout data changes.
  // Use stable string keys to avoid infinite loops from array reference churn.
  const trainingDaysKey = (profile.training_days || []).join(',')
  const blockedDaysKey  = (profile.blocked_days  || []).join(',')
  // Track workoutLogs length + last log id so schedule reacts to new logs (fatigue update)
  const workoutLogsKey  = `${workoutLogs.length}:${workoutLogs[0]?.id ?? ''}`
  useEffect(() => {
    setSchedule(initSchedule(profile, workoutLogs))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.schedule_since, profile.sessions_per_week, trainingDaysKey, blockedDaysKey, workoutLogsKey])
  const [saving, setSaving]         = useState(false)

  // ── Derived values ─────────────────────────────────────────────
  const monday = useMemo(() => {
    const m = getMondayOf(new Date())
    m.setDate(m.getDate() + weekOffset * 7)
    return m
  }, [weekOffset])

  // workoutLogs already contains merged strava runs (passed from App.jsx as allWorkoutLogs)
  const weekLogs = useMemo(() => {
    const start  = monday.toISOString().split('T')[0]
    const end    = new Date(monday); end.setDate(monday.getDate() + 6)
    const endStr = end.toISOString().split('T')[0]
    return workoutLogs.filter(l => l.workout_date >= start && l.workout_date <= endStr)
  }, [workoutLogs, monday])

  // Workout type of last Sunday → cross-week conflict detection
  const prevWeekLastType = useMemo(() => {
    const prevSunday    = new Date(monday); prevSunday.setDate(monday.getDate() - 1)
    const prevSundayStr = prevSunday.toISOString().split('T')[0]
    const log = workoutLogs.find(l => l.workout_date === prevSundayStr)
    if (log) return log.workout_type
    const stravaLog = stravaRuns.find(r => r.start_date.slice(0, 10) === prevSundayStr)
    return stravaLog ? 'easy' : (schedule[6] || 'rest')
  }, [monday, workoutLogs, stravaRuns, schedule])

  // ── AI-driven effective schedule ──────────────────────────────
  // For the current and next week, replace the base schedule with AI plan sessions.
  // Option B: AI sets both day AND type — user's training_days are just a default.
  const { effectiveSchedule, aiPlanActive, aiSessionByDay } = useMemo(() => {
    if (!aiPlan?.sessions?.length) return { effectiveSchedule: schedule, aiPlanActive: false, aiSessionByDay: {} }

    const today       = new Date(); today.setHours(0, 0, 0, 0)
    const currMonday  = getMondayOf(today)
    const nextMonday  = new Date(currMonday); nextMonday.setDate(currMonday.getDate() + 7)
    const isCurrentWeek = monday.getTime() === currMonday.getTime()
    const isNextWeek    = monday.getTime() === nextMonday.getTime()

    if (!isCurrentWeek && !isNextWeek) return { effectiveSchedule: schedule, aiPlanActive: false, aiSessionByDay: {} }

    const aiSessions = aiPlan.sessions.filter(s =>
      isNextWeek ? s.isNextWeek === true : !s.isNextWeek
    )
    if (!aiSessions.length) return { effectiveSchedule: schedule, aiPlanActive: false, aiSessionByDay: {} }

    // Build all-rest base, place AI sessions on their days
    const effective = {}
    const byDay = {}
    for (let i = 0; i < 7; i++) effective[i] = 'rest'
    for (const s of aiSessions) {
      if (s.dayOfWeek >= 0 && s.dayOfWeek <= 6 && s.type && s.type !== 'rest') {
        effective[s.dayOfWeek] = s.type
        byDay[s.dayOfWeek] = s
      }
    }
    return { effectiveSchedule: effective, aiPlanActive: true, aiSessionByDay: byDay }
  }, [aiPlan, schedule, monday])

  const displaySchedule = useMemo(() =>
    computeWeekDisplay(effectiveSchedule, weekLogs, profile, monday, prevWeekLastType),
    [effectiveSchedule, weekLogs, profile, monday, prevWeekLastType]
  )

  const weekLabel = useMemo(() => {
    const end = new Date(monday); end.setDate(monday.getDate() + 6)
    if (weekOffset === 0) return 'Diese Woche'
    if (weekOffset === -1) return 'Letzte Woche'
    if (weekOffset === 1) return 'Nächste Woche'
    return `${monday.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}`
  }, [monday, weekOffset])

  // ── Week summary stats ─────────────────────────────────────────
  const weekStats = useMemo(() => {
    const planned  = Object.values(displaySchedule).filter(e => e.type !== 'rest' && e.type !== 'blocked' && e.type !== 'missed').length
    const done     = weekLogs.length
    const kmLogged = weekLogs.reduce((sum, l) => sum + (l.distance_km || 0), 0)

    // Progressive km target for this week.
    // Anchor to the displayed week's Monday — not today+offset — so past/future
    // weeks show their correct km target rather than this week's value shifted.
    const totalBuildWeeks = weeksToRacePlan ?? 26
    const weeksElapsed = (() => {
      if (!profile.schedule_since) return 1
      const since = new Date(profile.schedule_since + 'T00:00:00')
      // monday is already the correct Monday for the displayed week (incl. weekOffset)
      return Math.max(1, Math.ceil((monday - since) / (7 * 24 * 60 * 60 * 1000)))
    })()
    const kmTarget        = getBuildPhaseKmTarget(mileage.last4avg || 0, weeksElapsed, totalBuildWeeks)

    return { planned, done, kmLogged: Math.round(kmLogged * 10) / 10, kmTarget }
  }, [displaySchedule, weekLogs, mileage, weeksToRacePlan, monday, profile.schedule_since])

  // ── Handlers ───────────────────────────────────────────────────
  function handleDayEdit(dayIdx, newType) {
    setSchedule(rebuildAfterEdit(dayIdx, newType, profile))
  }

  async function saveSchedule() {
    setSaving(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const updates = { build_phase_schedule: schedule, schedule_since: today }
      await supabase.from('profiles').update(updates).eq('id', profile.id)
      if (onProfileUpdate) onProfileUpdate({ ...profile, ...updates })
      setScheduleEditing(false)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  function cancelEdit() {
    setSchedule(initSchedule(profile, workoutLogs))
    setScheduleEditing(false)
  }

  // Mark a missed day as voluntary rest — inserts a 'rest' log so it no longer shows as missed
  const [markingRest, setMarkingRest] = useState(null) // dayIdx being saved
  async function markVoluntaryRest(dayIdx, date) {
    setMarkingRest(dayIdx)
    try {
      const dateStr = date.toISOString().split('T')[0]
      const { data, error } = await supabase.from('workout_logs').insert({
        user_id:      profile.id,
        workout_date: dateStr,
        workout_type: 'rest',
        notes:        'Freiwilliger Ruhetag',
      }).select().single()
      if (!error && data && onLogAdded) onLogAdded(data)
    } catch (e) { console.error(e) }
    finally { setMarkingRest(null) }
  }

  async function toggleMilestone(id) {
    const prev = selectedMilestones
    const next = prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    setSelectedMilestones(next) // optimistic update
    try {
      const { error } = await supabase.from('profiles').update({ selected_milestones: next }).eq('id', profile.id)
      if (error) throw error
    } catch (err) {
      console.error('toggleMilestone failed:', err)
      setSelectedMilestones(prev) // rollback on error
    }
  }

  const activeMilestones = MILESTONE_OPTIONS.filter(m => selectedMilestones.includes(m.id))

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Header card */}
      <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '16px 18px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          🏗️ {trainingMode === 'fitness' ? 'Fitness-Modus' : 'Aufbauphase'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--c-text)', marginBottom: 4 }}>
          {trainingMode === 'fitness'
            ? 'Dauerhaftes Fitnesstraining'
            : `Noch ${weeksToRacePlan} Wochen bis zum Rennplan`}
        </div>
        <p style={{ fontSize: 13, color: 'var(--c-text-2)', margin: 0, lineHeight: 1.5 }}>
          {trainingMode === 'fitness'
            ? 'Du trainierst im Fitness-Modus — kein Zielrennen, dafür kontinuierlicher Fortschritt.'
            : `In ${daysToRacePlan} Tagen startet dein 18-Wochen-Marathonplan für „${profile.marathon_name}". Nutze die Zeit um Fitness aufzubauen.`}
        </p>
      </div>

      {/* Taper banner — shown 3 weeks before race plan starts */}
      {weeksToRacePlan !== null && weeksToRacePlan <= 3 && weeksToRacePlan >= 0 && (
        <div style={{
          background: weeksToRacePlan <= 1 ? '#ff6b3522' : '#f59e0b22',
          border: `1px solid ${weeksToRacePlan <= 1 ? '#ff6b35' : '#f59e0b'}44`,
          borderRadius: 12, padding: '12px 16px',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>
            {weeksToRacePlan <= 1 ? '🏁' : '📉'}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: weeksToRacePlan <= 1 ? '#ff6b35' : '#f59e0b', marginBottom: 2 }}>
              {weeksToRacePlan === 0
                ? 'Rennplan startet diese Woche!'
                : weeksToRacePlan === 1
                  ? 'Letzte Aufbauwoche'
                  : weeksToRacePlan === 2
                    ? 'Starke Tapering-Phase'
                    : 'Moderate Tapering-Phase'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text-2)', lineHeight: 1.5 }}>
              {weeksToRacePlan === 0
                ? 'Dein 18-Wochen-Marathonplan beginnt — wechsle bald in den Rennmodus.'
                : weeksToRacePlan === 1
                  ? 'Nur noch Easy-Läufe und Long Run. Keine harten Einheiten mehr vor dem Rennplan.'
                  : weeksToRacePlan === 2
                    ? 'Intensität stark reduziert — Intervalle und Tempo sind durch Easy/Regeneration ersetzt.'
                    : 'Intervalle sind durch Tempo ersetzt — Belastung wird schrittweise zurückgefahren.'}
            </div>
          </div>
        </div>
      )}

      {/* Weekly schedule */}
      <div>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: '1rem' }}>Wochenplan</h3>
          {scheduleEditing ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelEdit}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 13, fontFamily: 'var(--font)', fontWeight: 600 }}>
                Abbrechen
              </button>
              <button onClick={saveSchedule} disabled={saving}
                style={{ background: 'var(--c-primary)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 13, fontFamily: 'var(--font)', fontWeight: 700, borderRadius: 8, padding: '4px 12px' }}>
                {saving ? '…' : 'Speichern'}
              </button>
            </div>
          ) : (
            <button onClick={() => setScheduleEditing(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-primary)', fontSize: 13, fontFamily: 'var(--font)', fontWeight: 600 }}>
              Bearbeiten
            </button>
          )}
        </div>

        {/* Week navigator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: aiPlanActive ? 6 : 10 }}>
          <button onClick={() => setWeekOffset(o => o - 1)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', padding: '4px 10px', fontSize: 20, lineHeight: 1 }}>‹</button>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--c-text-2)' }}>{weekLabel}</span>
          <button onClick={() => setWeekOffset(o => o + 1)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', padding: '4px 10px', fontSize: 20, lineHeight: 1 }}>›</button>
        </div>

        {/* AI-plan active indicator */}
        {aiPlanActive && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
            background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
            borderRadius: 8, padding: '5px 10px',
          }}>
            <span style={{ fontSize: 13 }}>🤖</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-primary)', flex: 1 }}>
              KI-Plan aktiv
              {aiPlan?.weekTheme ? ` — ${aiPlan.weekTheme}` : ''}
            </span>
          </div>
        )}

        {/* Week summary strip */}
        <div style={{
          display: 'flex', gap: 8, marginBottom: 12, padding: '10px 14px',
          background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
        }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: weekStats.done > 0 ? 'var(--c-primary)' : 'var(--c-text)' }}>
              {weekStats.done}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-3)' }}>/{weekStats.planned}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 1 }}>Einheiten</div>
          </div>
          <div style={{ width: 1, background: 'var(--c-border)' }} />
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>
              {weekStats.kmLogged > 0 ? weekStats.kmLogged : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 1 }}>km geloggt</div>
          </div>
          {weekStats.kmTarget > 0 && (
            <>
              <div style={{ width: 1, background: 'var(--c-border)' }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--c-text)' }}>{weekStats.kmTarget}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 1 }}>km Ziel</div>
              </div>
            </>
          )}
        </div>

        {/* Edit mode hint */}
        {scheduleEditing && (
          <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 10, padding: '8px 12px', background: 'var(--c-card)', borderRadius: 10, border: '1px solid var(--c-border)' }}>
            📋 Vorlage bearbeiten — gilt für alle zukünftigen Wochen. Eine Änderung verteilt die restlichen Einheiten automatisch neu.
          </div>
        )}

        {/* Day cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 7 }, (_, dayIdx) => {
            const entry   = displaySchedule[dayIdx] || { type: 'rest', logged: false }
            const date    = new Date(monday); date.setDate(monday.getDate() + dayIdx)
            const { type, logged, logs, isToday, isPast, adjusted } = entry
            const meta    = TYPE_META[type] || TYPE_META.rest
            const isBlocked = type === 'blocked'
            const isRest    = type === 'rest'
            const isMissed  = type === 'missed'

            // In edit mode: show and modify the base template type
            const editType = schedule[dayIdx] || 'rest'

            return (
              <div key={dayIdx} style={{
                background: isToday ? 'var(--c-primary-dim)' : 'var(--c-card)',
                border: `1px solid ${isToday ? 'var(--c-primary)' : 'var(--c-border)'}`,
                borderRadius: 12, overflow: 'hidden',
                opacity: (isPast && (isRest || isMissed) && !logged) ? 0.45 : 1,
              }}>
                {/* Main row */}
                <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, flexShrink: 0, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: isToday ? 'var(--c-primary)' : 'var(--c-text-3)' }}>
                      {DAYS_SHORT[dayIdx]}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: isToday ? 'var(--c-primary)' : 'var(--c-text)' }}>
                      {date.getDate()}
                    </div>
                  </div>

                  {logged ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{meta.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>{meta.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                          {logs?.[0]?.distance_km ? `${logs[0].distance_km} km` : ''}
                          {logs?.[0]?.distance_km && logs?.[0]?.duration_min ? ' · ' : ''}
                          {logs?.[0]?.duration_min ? `${logs[0].duration_min} min` : ''}
                          {logs?.length > 1 ? ` +${logs.length - 1} weitere` : ''}
                        </div>
                      </div>
                      {/* RPE badge */}
                      {logs?.[0]?.rpe && (
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: logs[0].rpe >= 8 ? '#ef4444' : logs[0].rpe >= 6 ? '#f59e0b' : '#22c55e',
                          background: (logs[0].rpe >= 8 ? '#ef4444' : logs[0].rpe >= 6 ? '#f59e0b' : '#22c55e') + '18',
                          borderRadius: 6, padding: '2px 6px',
                        }}>
                          {logs[0].rpe}/10
                        </span>
                      )}
                      <div style={{ fontSize: 16, color: 'var(--c-primary)' }}>✓</div>
                    </div>
                  ) : isBlocked ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 16 }}>🚫</span>
                      <div style={{ fontSize: 13, color: 'var(--c-text-3)', flex: 1 }}>Gesperrt</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-3)', fontStyle: 'italic' }}>manuell eintragbar</div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{meta.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: (isRest || isMissed) ? 'var(--c-text-3)' : meta.color, textDecoration: isMissed ? 'line-through' : 'none' }}>
                          {aiPlanActive && aiSessionByDay[dayIdx]?.title
                            ? aiSessionByDay[dayIdx].title
                            : meta.label}
                        </div>
                        {/* AI session stats: distance / duration / pace */}
                        {aiPlanActive && aiSessionByDay[dayIdx] && !isRest && !isMissed && (() => {
                          const s = aiSessionByDay[dayIdx]
                          const parts = []
                          if (s.distance_km) parts.push(`${s.distance_km} km`)
                          if (s.duration_min) parts.push(`${s.duration_min} min`)
                          return parts.length > 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--c-text-3)', display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                              {parts.map((p, i) => <span key={i}>{p}</span>)}
                              {s.pace && (
                                <span style={{ color: meta.color, fontWeight: 600 }}>@ {s.pace}</span>
                              )}
                            </div>
                          ) : s.pace ? (
                            <div style={{ fontSize: 11, color: meta.color, fontWeight: 600, marginTop: 2 }}>
                              @ {s.pace}
                            </div>
                          ) : null
                        })()}
                        {/* Fallback pace range — when AI hasn't provided one */}
                        {!isRest && !isMissed && (() => {
                          const aiPace = aiPlanActive && aiSessionByDay[dayIdx]?.pace
                          if (aiPace) return null
                          const range = getPaceTargetRange(profile, type)
                          if (!range) return null
                          return (
                            <div style={{ fontSize: 11, color: meta.color, fontWeight: 600, marginTop: 2, opacity: 0.85 }}>
                              🎯 {range}
                            </div>
                          )
                        })()}
                        {adjusted && !isPast && !aiPlanActive && (
                          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 1 }}>↩ verschoben</div>
                        )}
                      </div>
                      {isToday && !scheduleEditing && !isBlocked && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-primary)', background: 'rgba(99,102,241,0.15)', borderRadius: 6, padding: '2px 7px' }}>
                          HEUTE
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* AI session detail panel — structure + tip, expandable */}
                {aiPlanActive && !logged && !isRest && !isMissed && !isBlocked && !scheduleEditing &&
                  aiSessionByDay[dayIdx] &&
                  (aiSessionByDay[dayIdx].structure || aiSessionByDay[dayIdx].tip || aiSessionByDay[dayIdx].pace) && (
                  <AIDayDetail session={aiSessionByDay[dayIdx]} meta={meta} />
                )}

                {/* Voluntary rest strip — only on missed past days */}
                {isMissed && !logged && !scheduleEditing && onLogAdded && (
                  <div style={{
                    borderTop: '1px solid var(--c-border)',
                    padding: '7px 14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Geplantes Training verpasst?</span>
                    <button
                      onClick={() => markVoluntaryRest(dayIdx, date)}
                      disabled={markingRest === dayIdx}
                      style={{
                        background: 'none', border: '1px solid var(--c-border)',
                        borderRadius: 8, padding: '3px 10px', cursor: 'pointer',
                        fontSize: 12, color: 'var(--c-text-2)', fontFamily: 'var(--font)',
                        fontWeight: 600, transition: 'all 0.15s',
                        opacity: markingRest === dayIdx ? 0.5 : 1,
                      }}
                    >
                      {markingRest === dayIdx ? '…' : '💤 War Ruhetag'}
                    </button>
                  </div>
                )}

                {/* Edit mode: type picker */}
                {scheduleEditing && (
                  <div style={{ borderTop: '1px solid var(--c-border)', padding: '10px 14px' }}>
                    {/* Running options */}
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      {RUN_TYPES.map(t => {
                        const active = editType === t.id
                        const col = TYPE_META[t.id]?.color || 'var(--c-primary)'
                        return (
                          <button key={t.id} onClick={() => handleDayEdit(dayIdx, t.id)}
                            style={{
                              flexShrink: 0, padding: '5px 10px', borderRadius: 20,
                              border: `1.5px solid ${active ? col : 'var(--c-border)'}`,
                              background: active ? col + '22' : 'transparent',
                              color: active ? col : 'var(--c-text-3)',
                              fontSize: 12, fontWeight: active ? 700 : 500,
                              cursor: 'pointer', fontFamily: 'var(--font)',
                              display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
                            }}>
                            {t.icon} {t.label}
                          </button>
                        )
                      })}
                    </div>
                    {/* Other sports — manual override only */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-text-3)', marginBottom: 5 }}>
                        Stattdessen anderen Sport
                      </div>
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                        {OTHER_SPORT_TYPES.map(t => {
                          const active = editType === t.id
                          const col = TYPE_META[t.id]?.color || 'var(--c-text-2)'
                          return (
                            <button key={t.id} onClick={() => handleDayEdit(dayIdx, t.id)}
                              style={{
                                flexShrink: 0, padding: '5px 10px', borderRadius: 20,
                                border: `1.5px solid ${active ? col : 'var(--c-border)'}`,
                                background: active ? col + '22' : 'transparent',
                                color: active ? col : 'var(--c-text-3)',
                                fontSize: 12, fontWeight: active ? 700 : 500,
                                cursor: 'pointer', fontFamily: 'var(--font)',
                                display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
                              }}>
                              {t.icon} {t.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Milestones */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: '1rem' }}>Meine Ziele</h3>
          <button onClick={() => setMilestoneEditing(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-primary)', fontSize: 13, fontFamily: 'var(--font)', fontWeight: 600 }}>
            {milestoneEditing ? 'Fertig' : 'Bearbeiten'}
          </button>
        </div>

        {milestoneEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {MILESTONE_OPTIONS.map(m => {
              const selected = selectedMilestones.includes(m.id)
              return (
                <div key={m.id} onClick={() => toggleMilestone(m.id)}
                  style={{
                    background: selected ? 'var(--c-primary-dim)' : 'var(--c-card)',
                    border: `1.5px solid ${selected ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    borderRadius: 12, padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  <span style={{ fontSize: 22 }}>{m.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: selected ? 'var(--c-primary)' : 'var(--c-text)' }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>{m.description}</div>
                  </div>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: selected ? 'var(--c-primary)' : 'transparent',
                    border: `2px solid ${selected ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                </div>
              )
            })}
          </div>
        ) : activeMilestones.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--c-text-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
            <p>Noch keine Ziele. Tippe auf „Bearbeiten".</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeMilestones.map(m => {
              const targetData = m.getTarget(profile, mileage, daysToRacePlan, vo2max, predictedPaceSec)
              if (!targetData) return null
              const progress = m.renderProgress(targetData, mileage, vo2max, predictedPaceSec, workoutLogs)
              return (
                <div key={m.id} style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 20 }}>{m.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>{m.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 1 }}>{progress.label}</div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: m.color }}>{progress.pct}%</div>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: m.color, width: `${progress.pct}%`, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Jetzt: {targetData.current}</span>
                    <span style={{ fontSize: 11, color: m.color, fontWeight: 600 }}>Ziel: {targetData.target}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tips */}
      <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 14, padding: '14px 16px' }}>
        <h3 style={{ fontSize: '0.9rem', marginBottom: 10 }}>💡 Aufbauphase — Fokus</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: '🏃', text: 'Grundlagenausdauer aufbauen — 80% locker, 20% intensiv' },
            { icon: '📊', text: 'Wochenkilometer langsam steigern (max. +10% pro Woche)' },
            { icon: '😴', text: 'Schlaf und Erholung sind genauso wichtig wie das Training' },
            weeksToRacePlan !== null
              ? { icon: '🎯', text: `Rennplan startet in ${weeksToRacePlan} Wochen — dann wird es spezifisch` }
              : { icon: '🎯', text: 'Setze dir ein Wochenziel und steigere es progressiv alle 4 Wochen' },
          ].map((tip, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{tip.icon}</span>
              <span style={{ fontSize: 13, color: 'var(--c-text-2)', lineHeight: 1.4 }}>{tip.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
