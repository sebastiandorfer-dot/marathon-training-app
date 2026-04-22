import { useState } from 'react'

const CROSS_TRAINING_OPTIONS = [
  { id: 'cycling',    label: 'Radfahren',    emoji: '🚴' },
  { id: 'swimming',   label: 'Schwimmen',    emoji: '🏊' },
  { id: 'yoga',       label: 'Yoga',         emoji: '🧘' },
  { id: 'strength',   label: 'Kraft',        emoji: '🏋️' },
  { id: 'hiking',     label: 'Wandern',      emoji: '🥾' },
  { id: 'rowing',     label: 'Rudern',       emoji: '🚣' },
  { id: 'elliptical', label: 'Crosstrainer', emoji: '⚡' },
  { id: 'pilates',    label: 'Pilates',      emoji: '🌀' },
]

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Steps per training mode
const MODE_STEPS = {
  race:     ['mode', 'level', 'pace', 'schedule',         'context'],
  fitness:  ['mode', 'level', 'pace', 'schedule-fitness', 'context'],
  tracking: ['mode', 'context'],
}

function getSteps(mode) {
  return MODE_STEPS[mode] || ['mode']
}

export default function Onboarding({ user, onComplete }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [data, setData] = useState({
    trainingMode: '',
    level: '',
    targetPaceMin: '5',
    targetPaceSec: '30',
    crossTrainingSports: [],
    trainingDays: [1, 3, 5, 6],
    sessionsPerWeek: 4,
    flexibility: 'flexible',
    blockedDays: [],
    marathonDate: '',
    marathonName: '',
    targetWeeklyKm: 40,
    context: '',
  })
  const [error, setError] = useState('')

  function update(key, val) {
    setData(d => ({ ...d, [key]: val }))
    setError('')
  }

  function toggleSport(id) {
    setData(d => ({
      ...d,
      crossTrainingSports: d.crossTrainingSports.includes(id)
        ? d.crossTrainingSports.filter(s => s !== id)
        : [...d.crossTrainingSports, id],
    }))
  }

  function toggleDay(idx) {
    setData(d => ({
      ...d,
      trainingDays: d.trainingDays.includes(idx)
        ? d.trainingDays.filter(d2 => d2 !== idx)
        : [...d.trainingDays, idx].sort((a, b) => a - b),
      blockedDays: d.blockedDays.filter(b => b !== idx),
    }))
  }

  function toggleBlockedDay(idx) {
    setData(d => ({
      ...d,
      blockedDays: d.blockedDays.includes(idx)
        ? d.blockedDays.filter(b => b !== idx)
        : [...d.blockedDays, idx],
    }))
  }

  const steps = getSteps(data.trainingMode)
  const currentStepId = steps[stepIdx] || 'mode'
  const isLastStep = stepIdx === steps.length - 1

  // For display: use race (5) as default until mode is selected
  const displayTotal = data.trainingMode ? steps.length : 5
  const displayPct = Math.round(((stepIdx + 1) / displayTotal) * 100)

  const minDate = new Date(Date.now() + 18 * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const maxDate = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  function validateStep() {
    if (currentStepId === 'mode' && !data.trainingMode) return 'Bitte wähle einen Trainingsmodus.'
    if (currentStepId === 'level' && !data.level) return 'Bitte wähle dein Erfahrungslevel.'
    if (currentStepId === 'pace') {
      const min = parseInt(data.targetPaceMin)
      const sec = parseInt(data.targetPaceSec)
      if (isNaN(min) || min < 3 || min > 12) return 'Minuten müssen zwischen 3 und 12 liegen.'
      if (isNaN(sec) || sec < 0 || sec > 59) return 'Sekunden müssen zwischen 0 und 59 liegen.'
    }
    if (currentStepId === 'schedule') {
      if (data.trainingDays.length < 2) return 'Wähle mindestens 2 Trainingstage.'
      if (!data.marathonDate) return 'Bitte gib dein Marathondatum ein.'
      const marathonMs = new Date(data.marathonDate).getTime()
      if (marathonMs < Date.now() + 18 * 7 * 24 * 60 * 60 * 1000) return 'Der Marathon muss mindestens 18 Wochen in der Zukunft liegen.'
      if (!data.marathonName.trim()) return 'Bitte gib den Namen des Marathons ein.'
    }
    if (currentStepId === 'schedule-fitness') {
      if (data.trainingDays.length < 2) return 'Wähle mindestens 2 Trainingstage.'
    }
    return null
  }

  function handleNext() {
    const err = validateStep()
    if (err) { setError(err); return }
    setError('')

    if (isLastStep) {
      handleFinish()
    } else {
      setStepIdx(s => s + 1)
    }
  }

  function handleBack() {
    if (stepIdx > 0) {
      setStepIdx(s => s - 1)
      setError('')
    }
  }

  function handleFinish() {
    const payload = {
      training_mode: data.trainingMode,
      context: data.context.trim(),
      cross_training_sports: data.crossTrainingSports,
    }

    if (data.trainingMode === 'race' || data.trainingMode === 'fitness') {
      payload.level = data.level
      payload.target_pace_min = parseInt(data.targetPaceMin)
      payload.target_pace_sec = parseInt(data.targetPaceSec)
      payload.training_days = data.trainingDays
      payload.sessions_per_week = data.sessionsPerWeek
      payload.flexibility_mode = data.flexibility
      payload.blocked_days = data.blockedDays
      payload.schedule_since = new Date().toISOString().split('T')[0]
    }

    if (data.trainingMode === 'race') {
      payload.marathon_date = data.marathonDate
      payload.marathon_name = data.marathonName.trim()
    }

    if (data.trainingMode === 'fitness') {
      payload.target_weekly_km = data.targetWeeklyKm
    }

    onComplete(payload)
  }

  function getFinishLabel() {
    if (data.trainingMode === 'tracking') return '✅ Los geht\'s'
    if (data.trainingMode === 'fitness') return '🏃 Fitness-Modus starten'
    return '🚀 Plan erstellen'
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--c-bg)',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--sp-5) var(--sp-5) var(--sp-4)',
        borderBottom: '1px solid var(--c-border)',
        background: 'var(--c-bg)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', fontWeight: 600 }}>
            Schritt {stepIdx + 1} von {data.trainingMode ? steps.length : '?'}
          </span>
          <span style={{ fontSize: '0.8125rem', color: 'var(--c-primary)', fontWeight: 600 }}>
            {displayPct}%
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${displayPct}%` }} />
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 'var(--sp-6) var(--sp-5)',
        maxWidth: 540, margin: '0 auto', width: '100%',
      }}>
        {currentStepId === 'mode' && (
          <StepMode value={data.trainingMode} onChange={v => { update('trainingMode', v); setStepIdx(0) }} />
        )}
        {currentStepId === 'level' && (
          <StepLevel value={data.level} onChange={v => update('level', v)} />
        )}
        {currentStepId === 'pace' && (
          <StepPace
            mode={data.trainingMode}
            min={data.targetPaceMin}
            sec={data.targetPaceSec}
            onChangeMin={v => update('targetPaceMin', v)}
            onChangeSec={v => update('targetPaceSec', v)}
          />
        )}
        {currentStepId === 'schedule' && (
          <StepScheduleRace
            days={data.trainingDays}
            onToggleDay={toggleDay}
            sessions={data.sessionsPerWeek}
            onSessions={v => update('sessionsPerWeek', v)}
            flexibility={data.flexibility}
            onFlexibility={v => update('flexibility', v)}
            blockedDays={data.blockedDays}
            onToggleBlocked={toggleBlockedDay}
            marathonDate={data.marathonDate}
            onMarathonDate={v => update('marathonDate', v)}
            marathonName={data.marathonName}
            onMarathonName={v => update('marathonName', v)}
            minDate={minDate}
            maxDate={maxDate}
          />
        )}
        {currentStepId === 'schedule-fitness' && (
          <StepScheduleFitness
            days={data.trainingDays}
            onToggleDay={toggleDay}
            sessions={data.sessionsPerWeek}
            onSessions={v => update('sessionsPerWeek', v)}
            flexibility={data.flexibility}
            onFlexibility={v => update('flexibility', v)}
            blockedDays={data.blockedDays}
            onToggleBlocked={toggleBlockedDay}
            weeklyKm={data.targetWeeklyKm}
            onWeeklyKm={v => update('targetWeeklyKm', v)}
          />
        )}
        {currentStepId === 'context' && (
          <StepContext
            mode={data.trainingMode}
            value={data.context}
            onChange={v => update('context', v)}
            sports={data.crossTrainingSports}
            onToggleSport={toggleSport}
          />
        )}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 'var(--sp-4)' }}>
            <span>⚠</span> {error}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div style={{
        padding: 'var(--sp-4) var(--sp-5)',
        borderTop: '1px solid var(--c-border)',
        background: 'var(--c-bg)',
        display: 'flex',
        gap: 'var(--sp-3)',
        flexShrink: 0,
        paddingBottom: 'max(var(--sp-4), env(safe-area-inset-bottom, 0px))',
      }}>
        {stepIdx > 0 && (
          <button className="btn btn-ghost" onClick={handleBack} style={{ flex: '0 0 auto', minWidth: 100 }}>
            ← Zurück
          </button>
        )}
        <button className="btn btn-primary" onClick={handleNext} style={{ flex: 1 }}>
          {isLastStep && data.trainingMode ? getFinishLabel() : 'Weiter →'}
        </button>
      </div>
    </div>
  )
}

// ── Step: Training Mode ────────────────────────────────────────
function StepMode({ value, onChange }) {
  const modes = [
    {
      id: 'race',
      icon: '🏆',
      title: 'Wettkampf',
      subtitle: 'Ich trainiere für einen Marathon',
      desc: 'Strukturierter 18-Wochen-Plan mit Periodisierung, Taper und Race-Day-Vorbereitung. Passt sich deinem Marathondatum und Zieltempo an.',
    },
    {
      id: 'fitness',
      icon: '🏃',
      title: 'Fitness',
      subtitle: 'Ich will dauerhaft fit bleiben',
      desc: 'Kein festes Rennen — du trainierst kontinuierlich. Der Plan steigert dein Wochenkilometer-Ziel progressiv und passt sich deinem Alltag an.',
    },
    {
      id: 'tracking',
      icon: '📊',
      title: 'Tracking',
      subtitle: 'Ich will mein Training aufzeichnen',
      desc: 'Keine Planvorgaben — du loggst dein eigenes Training und siehst deine Fortschritte, Statistiken und Trends.',
    },
  ]

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Wie trainierst du?</h2>
      <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--c-text-2)' }}>
        Wähle deinen Trainingsmodus — du kannst ihn später jederzeit ändern.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {modes.map(m => (
          <div
            key={m.id}
            onClick={() => onChange(m.id)}
            style={{
              background: value === m.id ? 'var(--c-primary-dim)' : 'var(--c-card)',
              border: `2px solid ${value === m.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
              borderRadius: 16,
              padding: '16px 18px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span style={{ fontSize: 28 }}>{m.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: value === m.id ? 'var(--c-primary)' : 'var(--c-text)' }}>
                  {m.title}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginTop: 1 }}>
                  {m.subtitle}
                </div>
              </div>
              {value === m.id && (
                <span style={{ marginLeft: 'auto', color: 'var(--c-primary)', fontSize: 18 }}>✓</span>
              )}
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', margin: 0, lineHeight: 1.5 }}>
              {m.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Step: Experience Level ────────────────────────────────────
function StepLevel({ value, onChange }) {
  const levels = [
    {
      id: 'beginner',
      icon: '🌱',
      title: 'Einsteiger',
      desc: 'Neu im Marathontraining oder weniger als 20 km/Woche. Erster Marathon oder Rückkehr nach langer Pause.',
    },
    {
      id: 'intermediate',
      icon: '⚡',
      title: 'Fortgeschritten',
      desc: 'Regelmäßig 30–50 km/Woche. Mindestens ein Marathon absolviert oder starke Halbmarathon-Basis.',
    },
    {
      id: 'advanced',
      icon: '🔥',
      title: 'Leistungsorientiert',
      desc: '60+ km/Woche. Mehrere Marathons, Jagd auf eine Bestzeit oder sub 3:30.',
    },
  ]
  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Wie erfahren bist du?</h2>
      <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--c-text-2)' }}>
        Dein Trainingsplan passt sich genau an deinen aktuellen Stand an.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {levels.map(l => (
          <div
            key={l.id}
            className={`level-card ${value === l.id ? 'selected' : ''}`}
            onClick={() => onChange(l.id)}
          >
            <div className="level-card-icon">{l.icon}</div>
            <h3>{l.title}</h3>
            <p>{l.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Step: Target Pace ─────────────────────────────────────────
function StepPace({ mode, min, sec, onChangeMin, onChangeSec }) {
  const isRace = mode === 'race'
  const references = isRace
    ? [
        ['4:30', 'Sub 3:10 Marathon'],
        ['5:00', 'Sub 3:31 Marathon'],
        ['5:30', 'Sub 3:52 Marathon'],
        ['6:00', 'Sub 4:14 Marathon'],
        ['6:30', 'Sub 4:34 Marathon'],
      ]
    : [
        ['4:45', 'Sehr schnell'],
        ['5:15', 'Schnell'],
        ['5:45', 'Mittel'],
        ['6:15', 'Gemütlich'],
        ['7:00', 'Entspannt'],
      ]

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>
        {isRace ? 'Deine Zielpace?' : 'Deine Lauftempo?'}
      </h2>
      <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--c-text-2)' }}>
        {isRace
          ? 'Dein angestrebtes Tempo pro Kilometer. Das bestimmt die Intensität jeder Einheit in deinem Plan.'
          : 'Dein angenehmes Dauerlauftempo. Der Plan richtet Easy Runs und Tempo-Einheiten danach aus.'}
      </p>

      <div className="pace-input-wrap">
        <input
          type="number"
          className="pace-input"
          value={min}
          min={3} max={12}
          onChange={e => onChangeMin(e.target.value)}
        />
        <span className="pace-separator">:</span>
        <input
          type="number"
          className="pace-input"
          value={sec}
          min={0} max={59}
          onChange={e => onChangeSec(e.target.value.padStart(2, '0').slice(-2))}
        />
        <span className="pace-unit">min / km</span>
      </div>

      <div style={{ marginTop: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)' }}>
          {isRace ? 'Häufige Referenzpaces:' : 'Häufige Trainingspaces:'}
        </p>
        {references.map(([pace, label]) => (
          <button
            key={pace}
            onClick={() => { onChangeMin(pace.split(':')[0]); onChangeSec(pace.split(':')[1]) }}
            style={{
              background: `${min}:${sec.padStart(2, '0')}` === pace ? 'var(--c-primary-dim)' : 'var(--c-card)',
              border: `1px solid ${`${min}:${sec.padStart(2, '0')}` === pace ? 'var(--c-primary)' : 'var(--c-border)'}`,
              borderRadius: 'var(--r-sm)',
              padding: 'var(--sp-2) var(--sp-3)',
              color: 'var(--c-text)',
              cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.875rem',
              fontFamily: 'var(--font)',
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{pace}/km</span>
            <span style={{ color: 'var(--c-text-2)' }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Step: Schedule + Marathon (Race Mode) ─────────────────────
function StepScheduleRace({ days, onToggleDay, sessions, onSessions, flexibility, onFlexibility, blockedDays, onToggleBlocked, marathonDate, onMarathonDate, marathonName, onMarathonName, minDate, maxDate }) {
  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Dein Zeitplan</h2>
      <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--c-text-2)' }}>
        Wann trainierst du, und wann ist dein großes Rennen?
      </p>

      <ScheduleSection
        days={days}
        onToggleDay={onToggleDay}
        sessions={sessions}
        onSessions={onSessions}
        flexibility={flexibility}
        onFlexibility={onFlexibility}
        blockedDays={blockedDays}
        onToggleBlocked={onToggleBlocked}
      />

      <div className="form-group" style={{ marginBottom: 'var(--sp-4)', marginTop: 'var(--sp-5)' }}>
        <label className="form-label">Name des Marathons</label>
        <input
          type="text"
          className="form-input"
          placeholder="z.B. Wien Marathon 2026"
          value={marathonName}
          onChange={e => onMarathonName(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Marathondatum</label>
        <input
          type="date"
          className="form-input"
          value={marathonDate}
          min={minDate}
          max={maxDate}
          onChange={e => onMarathonDate(e.target.value)}
          style={{ colorScheme: 'dark' }}
        />
        <span style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)' }}>
          Muss mindestens 18 Wochen in der Zukunft liegen für einen vollständigen Trainingsplan.
        </span>
      </div>
    </div>
  )
}

// ── Step: Schedule + Weekly Goal (Fitness Mode) ───────────────
function StepScheduleFitness({ days, onToggleDay, sessions, onSessions, flexibility, onFlexibility, blockedDays, onToggleBlocked, weeklyKm, onWeeklyKm }) {
  const presets = [20, 30, 40, 50, 60, 70]

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Dein Trainingsplan</h2>
      <p style={{ marginBottom: 'var(--sp-6)', color: 'var(--c-text-2)' }}>
        An welchen Tagen kannst du laufen, wie oft willst du trainieren, und was ist dein Wochenziel?
      </p>

      <ScheduleSection
        days={days}
        onToggleDay={onToggleDay}
        sessions={sessions}
        onSessions={onSessions}
        flexibility={flexibility}
        onFlexibility={onFlexibility}
        blockedDays={blockedDays}
        onToggleBlocked={onToggleBlocked}
      />

      {/* Weekly km goal */}
      <div style={{ marginTop: 'var(--sp-5)' }}>
        <label className="form-label" style={{ marginBottom: 'var(--sp-3)', display: 'block' }}>
          Wochenziel: <strong style={{ color: 'var(--c-primary)' }}>{weeklyKm} km/Woche</strong>
        </label>
        <input
          type="range"
          min={15}
          max={100}
          step={5}
          value={weeklyKm}
          onChange={e => onWeeklyKm(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--c-primary)', marginBottom: 'var(--sp-3)' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {presets.map(km => (
            <button
              key={km}
              onClick={() => onWeeklyKm(km)}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'var(--font)',
                background: weeklyKm === km ? 'var(--c-primary-dim)' : 'var(--c-card)',
                border: `1.5px solid ${weeklyKm === km ? 'var(--c-primary)' : 'var(--c-border)'}`,
                color: weeklyKm === km ? 'var(--c-primary)' : 'var(--c-text-2)',
              }}
            >
              {km} km
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 'var(--sp-2)' }}>
          Der Plan steigert dich progressiv auf dieses Ziel — mit Cutback-Wochen alle 4 Wochen.
        </p>
      </div>
    </div>
  )
}

// ── Shared: Training Days + Sessions + Flexibility ────────────
function ScheduleSection({ days, onToggleDay, sessions, onSessions, flexibility, onFlexibility, blockedDays, onToggleBlocked }) {
  const maxSessions = Math.max(1, days.length)
  // Clamp sessions when days change
  const effectiveSessions = Math.min(sessions, maxSessions)

  return (
    <>
      {/* Available days */}
      <div style={{ marginBottom: 'var(--sp-5)' }}>
        <label className="form-label" style={{ marginBottom: 'var(--sp-2)', display: 'block' }}>
          An welchen Tagen kannst du trainieren?
        </label>
        <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-3)', marginBottom: 'var(--sp-3)' }}>
          Markiere alle Tage, die grundsätzlich möglich sind.
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {DAYS.map((d, i) => (
            <button
              key={i}
              className={`day-chip ${days.includes(i) ? 'selected' : ''}`}
              onClick={() => {
                onToggleDay(i)
                // If removing a day drops below sessions count, reduce sessions
                const newDays = days.includes(i) ? days.filter(d => d !== i) : [...days, i]
                if (newDays.length < sessions) onSessions(Math.max(1, newDays.length))
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions per week — the key new field */}
      <div style={{ marginBottom: 'var(--sp-5)', padding: '14px 16px', background: 'var(--c-card)', borderRadius: 12, border: '1px solid var(--c-border)' }}>
        <label className="form-label" style={{ marginBottom: 'var(--sp-3)', display: 'block' }}>
          Wie viele Einheiten pro Woche willst du trainieren?
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[1,2,3,4,5,6,7].filter(n => n <= maxSessions).map(n => (
            <button
              key={n}
              onClick={() => onSessions(n)}
              style={{
                width: 40, height: 40, borderRadius: '50%', fontWeight: 700, fontSize: 15,
                cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.15s',
                background: effectiveSessions === n ? 'var(--c-primary)' : 'transparent',
                border: `2px solid ${effectiveSessions === n ? 'var(--c-primary)' : 'var(--c-border)'}`,
                color: effectiveSessions === n ? '#fff' : 'var(--c-text-2)',
              }}
            >
              {n}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 8 }}>
          Der Plan verteilt <strong>{effectiveSessions}×</strong> Training auf deine verfügbaren Tage — der Rest sind Ruhetage.
        </p>
      </div>

      <div>
        <label className="form-label" style={{ marginBottom: 'var(--sp-3)', display: 'block' }}>
          Wie flexibel bist du?
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {[
            { id: 'strict',   icon: '🔒', title: 'Nur diese Tage',  desc: 'Ich kann ausschließlich an meinen gewählten Tagen trainieren.' },
            { id: 'flexible', icon: '🔄', title: 'Flexibel',         desc: 'Ich bevorzuge diese Tage, kann aber auch an anderen trainieren.' },
          ].map(opt => (
            <div key={opt.id} onClick={() => onFlexibility(opt.id)} style={{
              background: flexibility === opt.id ? 'var(--c-primary-dim)' : 'var(--c-card)',
              border: `1.5px solid ${flexibility === opt.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
              borderRadius: 12, padding: '12px 14px',
              display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              <span style={{ fontSize: 20 }}>{opt.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: flexibility === opt.id ? 'var(--c-primary)' : 'var(--c-text)' }}>{opt.title}</div>
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>{opt.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {flexibility === 'flexible' && (
          <div style={{ marginTop: 'var(--sp-4)', padding: '14px', background: 'var(--c-card)', borderRadius: 12, border: '1px solid var(--c-border)' }}>
            <label className="form-label" style={{ marginBottom: 'var(--sp-2)', display: 'block' }}>
              Welche Tage sind absolut unmöglich? (optional)
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              {DAYS.map((d, i) => {
                const isPreferred = days.includes(i)
                const isBlocked = blockedDays.includes(i)
                return (
                  <button key={i} disabled={isPreferred} onClick={() => !isPreferred && onToggleBlocked(i)}
                    style={{
                      padding: '6px 12px', borderRadius: 20, fontSize: '0.875rem', fontFamily: 'var(--font)',
                      fontWeight: 600, cursor: isPreferred ? 'default' : 'pointer', transition: 'all 0.15s',
                      opacity: isPreferred ? 0.35 : 1,
                      background: isBlocked ? 'rgba(239,68,68,0.12)' : 'transparent',
                      border: `1.5px solid ${isBlocked ? '#ef4444' : 'var(--c-border)'}`,
                      color: isBlocked ? '#ef4444' : 'var(--c-text-2)',
                    }}>
                    {isBlocked ? '🚫 ' : ''}{d}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 8 }}>
              Bevorzugte Trainingstage können nicht gesperrt werden.
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ── Step: Context + Other Sports (Last Step, all modes) ───────
function StepContext({ mode, value, onChange, sports, onToggleSport }) {
  const placeholders = {
    race: 'z.B. Hatte letztes Jahr ein Knieproblem, ist aber ausgeheilt. Ich trainiere früh morgens vor der Arbeit. Möchte unter 3:30 laufen. Mein letzter Marathon war in Wien in 3:48...',
    fitness: 'z.B. Ich laufe seit 2 Jahren regelmäßig, möchte meine Kondition verbessern. Trainiere meistens morgens. Knie manchmal empfindlich...',
    tracking: 'z.B. Ich folge meinem eigenen Trainingsplan. Laufe 4x pro Woche. Ziel ist ein Halbmarathon im Herbst...',
  }

  return (
    <div className="fade-up">
      {/* Sports section */}
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Weitere Sportarten?</h2>
      <p style={{ marginBottom: 'var(--sp-4)', color: 'var(--c-text-2)' }}>
        Wähle Sportarten die du zusätzlich machst — du kannst sie beim Loggen eintragen. Überspringen wenn du nur läufst.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-6)' }}>
        {CROSS_TRAINING_OPTIONS.map(s => (
          <button
            key={s.id}
            className={`sport-chip ${sports.includes(s.id) ? 'selected' : ''}`}
            onClick={() => onToggleSport(s.id)}
          >
            <span>{s.emoji}</span> {s.label}
          </button>
        ))}
      </div>

      {/* Context section */}
      <h2 style={{ marginBottom: 'var(--sp-2)' }}>Erzähl deinem Coach von dir</h2>
      <p style={{ marginBottom: 'var(--sp-4)', color: 'var(--c-text-2)' }}>
        Teile Verletzungen, Ziele, vergangene Rennen oder alles was dein Training beeinflusst. Je mehr Details, desto besser.
      </p>
      <div className="form-group">
        <textarea
          className="form-input"
          placeholder={placeholders[mode] || placeholders.race}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={6}
        />
      </div>
      <p style={{ marginTop: 'var(--sp-4)', fontSize: '0.8125rem', color: 'var(--c-text-3)' }}>
        Optional, aber sehr empfohlen. Du kannst das später jederzeit in deinem Profil bearbeiten.
      </p>
    </div>
  )
}
