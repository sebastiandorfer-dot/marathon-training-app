import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../supabase'
import {
  computePaceTrend,
  weeklyMileageStats,
  formatPaceSec,
  calculateVO2max,
  deriveMaxHR,
} from '../../utils/fitnessUtils'
import { getPlanStartDate } from '../../utils/planUtils'

// ── Constants ──────────────────────────────────────────────────────────────────

const RACE_DISTANCES = [
  { id: '5km',           label: '5 km',          km: 5 },
  { id: '10km',          label: '10 km',          km: 10 },
  { id: 'half_marathon', label: 'Halbmarathon',   km: 21.0975 },
  { id: 'marathon',      label: 'Marathon',        km: 42.195 },
]

const DISTANCE_PRESETS = [10, 15, 20, 25, 30]

// ── Helpers ────────────────────────────────────────────────────────────────────

function secToMmSs(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function mmSsToSec(str) {
  const parts = str.split(':')
  if (parts.length !== 2) return null
  const m = parseInt(parts[0], 10)
  const s = parseInt(parts[1], 10)
  if (isNaN(m) || isNaN(s)) return null
  return m * 60 + s
}

function formatFinishTime(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Best average pace (sec/km) from runs of at least `minKm` in the last `days` days */
function bestPaceForDistance(stravaRuns, minKm, days = 60) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const qualifying = stravaRuns.filter(r =>
    r.average_speed &&
    r.distance >= minKm * 1000 &&
    new Date(r.start_date).getTime() > cutoff
  )
  if (!qualifying.length) return null
  const paces = qualifying.map(r => 1000 / r.average_speed) // sec/km
  return Math.min(...paces)
}

/** Longest single run distance in km over last `days` days */
function longestRun(stravaRuns, days = 90) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const recent = stravaRuns.filter(r =>
    r.distance && new Date(r.start_date).getTime() > cutoff
  )
  if (!recent.length) return 0
  return Math.max(...recent.map(r => r.distance / 1000))
}

/** Calculate goal progress (0–1) + display strings */
function calcGoalProgress(goal, stravaRuns, workoutLogs) {
  if (goal.type === 'distance') {
    const target = goal.target_distance_km
    const best = longestRun(stravaRuns, 90)
    const pct = target ? Math.min(1, best / target) : 0
    return {
      pct,
      current: best > 0 ? `${best.toFixed(1)} km` : '—',
      target: `${target} km`,
      label: 'Längster Lauf',
      achieved: best >= target,
    }
  }

  if (goal.type === 'time') {
    const targetKm = goal.race_distance_km || 5
    const targetSec = goal.target_time_sec
    // Use runs ≥ 60% of target distance to estimate pace
    const bestPace = bestPaceForDistance(stravaRuns, targetKm * 0.6)
    if (!bestPace || !targetSec) {
      return { pct: 0, current: '—', target: formatFinishTime(targetSec), label: 'Zielzeit', achieved: false }
    }
    const predictedSec = bestPace * targetKm
    const pct = Math.min(1, targetSec / predictedSec)
    return {
      pct,
      current: formatFinishTime(Math.round(predictedSec)),
      target: formatFinishTime(targetSec),
      label: `${goal.race_distance_km || 5} km Ziel`,
      achieved: predictedSec <= targetSec,
    }
  }

  if (goal.type === 'race') {
    const km = goal.race_distance_km || RACE_DISTANCES.find(d => d.id === goal.race_distance)?.km || 10
    const targetSec = goal.target_time_sec
    const bestPace = bestPaceForDistance(stravaRuns, km * 0.5)

    if (!bestPace) {
      return { pct: 0, current: '—', target: targetSec ? formatFinishTime(targetSec) : 'Finishen', label: 'Zielzeit', achieved: false }
    }
    const predictedSec = bestPace * km
    if (!targetSec) {
      // No target time — show current prediction, progress = 0 (no target to measure against)
      return {
        pct: 0,
        current: formatFinishTime(Math.round(predictedSec)),
        target: 'Kein Zeitlimit',
        label: 'Prognose',
        achieved: false,
      }
    }
    const pct = Math.min(1, targetSec / predictedSec)
    return {
      pct,
      current: formatFinishTime(Math.round(predictedSec)),
      target: formatFinishTime(targetSec),
      label: 'Prognose',
      achieved: predictedSec <= targetSec,
    }
  }

  return { pct: 0, current: '—', target: '—', label: '', achieved: false }
}

/**
 * Riegel's race time prediction formula: T2 = T1 × (D2/D1)^1.06
 * More accurate than linear pace scaling because longer races are run slower.
 */
function riegelPredict(knownTimeSec, knownDistKm, targetDistKm) {
  if (!knownTimeSec || !knownDistKm || !targetDistKm) return null
  return knownTimeSec * Math.pow(targetDistKm / knownDistKm, 1.06)
}

/**
 * Best projected finish time for targetKm, using Riegel from the closest qualifying runs.
 * Accepts runs between 20% and 120% of target distance for projection.
 */
function bestProjectedTime(stravaRuns, targetKm, days = 90) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const qualifying = stravaRuns.filter(r =>
    r.average_speed &&
    r.distance >= targetKm * 0.2 * 1000 &&
    r.distance <= targetKm * 1.2 * 1000 &&
    new Date(r.start_date).getTime() > cutoff
  )
  if (!qualifying.length) return null
  const projections = qualifying.map(r => {
    const runKm = r.distance / 1000
    const runTimeSec = (r.distance / r.average_speed) // meters / (m/s) = seconds
    return riegelPredict(runTimeSec, runKm, targetKm)
  }).filter(Boolean)
  return projections.length ? Math.min(...projections) : null
}

/**
 * Estimate when a goal will be achieved.
 * Returns { date, source: 'plan'|'estimate'|'achieved', weeksAway, weekNum? } or null.
 *
 * Distance: scans training plan for first long run >= target (needs distance_km set by AI).
 *   Fallback: 10%/week long-run progression (the classic "10% rule").
 *
 * Time/Race: uses Riegel projection from real runs + 0.5%/week improvement.
 *   0.5%/week = ~23% over a year — realistic for dedicated recreational runners.
 *   (0.8%/week would compound to ~35%/year — only valid for absolute beginners.)
 */
function estimateAchievementDate(goal, stravaRuns, trainingPlan, profile) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // ── Distance goal ─────────────────────────────────────────────────────────
  if (goal.type === 'distance') {
    const target = goal.target_distance_km
    const current = longestRun(stravaRuns, 90)
    if (current >= target) return { date: today, source: 'achieved', weeksAway: 0 }

    // Scan training plan — only use weeks where the long run has distance_km explicitly set
    if (trainingPlan?.plan_data?.weeks && profile?.marathon_date) {
      try {
        const planStart = getPlanStartDate(profile.marathon_date)
        for (const week of trainingPlan.plan_data.weeks) {
          const longRuns = (week.workouts || [])
            .filter(w => w.type === 'long' && typeof w.distance_km === 'number' && w.distance_km > 0)
            .sort((a, b) => b.distance_km - a.distance_km)
          const longRun = longRuns[0]
          if (!longRun || longRun.distance_km < target) continue
          const weekDate = new Date(planStart)
          weekDate.setDate(planStart.getDate() + (week.week - 1) * 7 + (longRun.day_of_week ?? 5))
          if (weekDate >= today) {
            const weeksAway = Math.ceil((weekDate - today) / (7 * 24 * 60 * 60 * 1000))
            return { date: weekDate, source: 'plan', weeksAway, weekNum: week.week }
          }
        }
      } catch (_) { /* ignore */ }
    }

    // Fallback: 10%/week progression from current longest run
    if (current <= 0) return null
    let km = current
    let weeks = 0
    while (km < target && weeks < 52) { km *= 1.10; weeks++ }
    if (weeks >= 52) return null
    const date = new Date(today)
    date.setDate(today.getDate() + weeks * 7)
    return { date, source: 'estimate', weeksAway: weeks }
  }

  // ── Time / Race goal ──────────────────────────────────────────────────────
  if (goal.type === 'time' || goal.type === 'race') {
    const targetKm = goal.race_distance_km ||
      RACE_DISTANCES.find(d => d.id === goal.race_distance)?.km || 5
    const targetSec = goal.target_time_sec
    if (!targetSec) return null

    // Riegel projection: prefer recent 90-day window, fall back to 365 days
    const projectedSec = bestProjectedTime(stravaRuns, targetKm, 90) ||
                         bestProjectedTime(stravaRuns, targetKm, 365)
    if (!projectedSec) return null

    if (projectedSec <= targetSec) return { date: today, source: 'achieved', weeksAway: 0 }

    // 0.5%/week improvement — conservative but realistic for recreational runners
    let timeSec = projectedSec
    let weeks = 0
    while (timeSec > targetSec && weeks < 104) { timeSec *= 0.995; weeks++ }
    if (weeks >= 104) return null
    const date = new Date(today)
    date.setDate(today.getDate() + weeks * 7)
    return { date, source: 'estimate', weeksAway: weeks }
  }

  return null
}

function progressColor(pct) {
  if (pct >= 1) return '#22c55e'
  if (pct >= 0.7) return '#4a9eff'
  if (pct >= 0.4) return '#f59e0b'
  return 'var(--c-primary)'
}

// ── SVG Charts ─────────────────────────────────────────────────────────────────

function PaceTrendChart({ data }) {
  const valid = data.filter(d => d.pace !== null)
  if (valid.length < 2) return (
    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--c-text-3)', fontSize: 13 }}>
      Mehr Läufe ≥5 km nötig für Pace-Trend
    </div>
  )

  const W = 320, H = 100
  const PAD = { t: 10, r: 8, b: 28, l: 42 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b

  const paces = valid.map(d => d.pace)
  const minP = Math.min(...paces) - 15
  const maxP = Math.max(...paces) + 15
  const range = maxP - minP || 60

  const pts = data.map((d, i) => ({
    x: PAD.l + (i / (data.length - 1)) * iW,
    // Higher pace (slower) = higher y (lower on screen) — inverted
    y: d.pace ? PAD.t + ((d.pace - minP) / range) * iH : null,
    pace: d.pace,
    week: d.week,
  }))

  // Build smooth path through valid points only
  const validPts = pts.filter(p => p.y !== null)
  const pathD = validPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  // Area fill
  const areaD = validPts.length >= 2
    ? `${pathD} L${validPts[validPts.length - 1].x.toFixed(1)},${(PAD.t + iH).toFixed(1)} L${validPts[0].x.toFixed(1)},${(PAD.t + iH).toFixed(1)} Z`
    : null

  // Y-axis labels (pace values at top and bottom)
  const topPace = minP  // fastest (shown at top)
  const botPace = maxP  // slowest (shown at bottom)

  // Trend direction — compare first half vs second half avg
  const half = Math.floor(validPts.length / 2)
  const avgFirst = validPts.slice(0, half).reduce((s, p) => s + p.pace, 0) / half
  const avgLast = validPts.slice(half).reduce((s, p) => s + p.pace, 0) / (validPts.length - half)
  const improving = avgLast < avgFirst // lower pace = faster = better

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Pace-Trend (letzte 8 Wochen)</span>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
          background: improving ? '#22c55e22' : '#ef444422',
          color: improving ? '#22c55e' : '#ef4444',
        }}>
          {improving ? '↑ Schneller' : '↓ Langsamer'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', overflow: 'visible' }}>
        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map(t => (
          <line key={t}
            x1={PAD.l} y1={PAD.t + t * iH}
            x2={PAD.l + iW} y2={PAD.t + t * iH}
            stroke="var(--c-border)" strokeWidth="1" strokeDasharray="3,3"
          />
        ))}
        {/* Y-axis labels */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize="9" fill="var(--c-text-3)">{formatPaceSec(topPace)}</text>
        <text x={PAD.l - 4} y={PAD.t + iH} textAnchor="end" fontSize="9" fill="var(--c-text-3)">{formatPaceSec(botPace)}</text>
        {/* X-axis week labels (every 2 weeks) */}
        {data.filter((_, i) => i % 2 === 0).map((d, i) => (
          <text key={i}
            x={PAD.l + ((i * 2) / (data.length - 1)) * iW}
            y={H - 8} textAnchor="middle" fontSize="9" fill="var(--c-text-3)"
          >
            {new Date(d.week + 'T12:00:00').toLocaleDateString('de-AT', { month: 'numeric', day: 'numeric' })}
          </text>
        ))}
        {/* Area fill */}
        {areaD && (
          <path d={areaD} fill="var(--c-primary)" fillOpacity="0.08" />
        )}
        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--c-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Data points */}
        {validPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--c-primary)" />
        ))}
        {/* Highlight last point */}
        {validPts.length > 0 && (
          <circle
            cx={validPts[validPts.length - 1].x}
            cy={validPts[validPts.length - 1].y}
            r="5" fill="var(--c-primary)" fillOpacity="0.25"
            stroke="var(--c-primary)" strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  )
}

function VolumeChart({ data }) {
  const hasData = data.some(d => d.km > 0)
  if (!hasData) return null

  const W = 320, H = 90
  const PAD = { t: 6, r: 8, b: 24, l: 32 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b

  const maxKm = Math.max(...data.map(d => d.km), 1)
  const barW = (iW / data.length) * 0.6
  const gap = iW / data.length

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 6 }}>
        Wöchentliches Volumen (km)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', overflow: 'visible' }}>
        {/* Y-axis label */}
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" fontSize="9" fill="var(--c-text-3)">{Math.round(maxKm)}</text>
        <text x={PAD.l - 4} y={PAD.t + iH} textAnchor="end" fontSize="9" fill="var(--c-text-3)">0</text>
        {/* Baseline */}
        <line x1={PAD.l} y1={PAD.t + iH} x2={PAD.l + iW} y2={PAD.t + iH}
          stroke="var(--c-border)" strokeWidth="1" />
        {data.map((d, i) => {
          const barH = d.km > 0 ? (d.km / maxKm) * iH : 0
          const x = PAD.l + i * gap + gap / 2 - barW / 2
          const y = PAD.t + iH - barH
          const isCurrentWeek = i === data.length - 1
          return (
            <g key={i}>
              {barH > 0 && (
                <rect x={x} y={y} width={barW} height={barH} rx="2"
                  fill={isCurrentWeek ? 'var(--c-primary)' : 'var(--c-primary)'}
                  fillOpacity={isCurrentWeek ? 1 : 0.4}
                />
              )}
              {d.km > 0 && (
                <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="8" fill="var(--c-text-3)">
                  {d.km}
                </text>
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--c-text-3)">
                {new Date(d.week + 'T12:00:00').toLocaleDateString('de-AT', { month: 'numeric', day: 'numeric' })}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Goal Card ──────────────────────────────────────────────────────────────────

function GoalCard({ goal, stravaRuns, workoutLogs, trainingPlan, profile, onDelete, onAchieve }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const prog = useMemo(() => calcGoalProgress(goal, stravaRuns, workoutLogs), [goal, stravaRuns, workoutLogs])
  const prediction = useMemo(
    () => estimateAchievementDate(goal, stravaRuns, trainingPlan, profile),
    [goal, stravaRuns, trainingPlan, profile]
  )
  const col = progressColor(prog.pct)

  const raceLabel = RACE_DISTANCES.find(d => d.id === goal.race_distance)?.label || ''
  const subtitle = goal.type === 'race'
    ? `${raceLabel}${goal.race_date ? ` · ${new Date(goal.race_date + 'T12:00:00').toLocaleDateString('de-AT', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`
    : goal.type === 'distance'
    ? `Distanzziel · ${goal.target_distance_km} km`
    : `Zeitziel · ${goal.race_distance_km || 5} km in ${formatFinishTime(goal.target_time_sec)}`

  const typeIcon = goal.type === 'race' ? '🏁' : goal.type === 'distance' ? '📏' : '⚡'

  return (
    <div style={{
      background: 'var(--c-card)', border: `1px solid ${prog.achieved ? '#22c55e44' : 'var(--c-border)'}`,
      borderRadius: 14, padding: '14px 16px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Achieved shimmer */}
      {prog.achieved && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          background: 'linear-gradient(135deg, #22c55e22, transparent)',
          width: '100%', height: '100%', pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{typeIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {goal.title}
            {prog.achieved && <span style={{ fontSize: 14 }}>✅</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 1 }}>{subtitle}</div>
        </div>
        <button onClick={() => setConfirmDelete(c => !c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-3)', fontSize: 18, padding: '0 2px', flexShrink: 0 }}>
          ···
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 999, background: 'var(--c-bg)', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%', borderRadius: 999,
          width: `${Math.round(prog.pct * 100)}%`,
          background: col,
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Current vs target */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>{prog.label}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>{prog.current}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>Ziel</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-2)' }}>{prog.target}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginBottom: 1 }}>Fortschritt</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>{Math.round(prog.pct * 100)}%</div>
        </div>
      </div>

      {/* Prediction */}
      {prediction && !prog.achieved && prediction.source !== 'achieved' && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 14 }}>{prediction.source === 'plan' ? '📋' : '🔮'}</span>
          <div>
            <span style={{ fontSize: 11, color: 'var(--c-text-3)', marginRight: 4 }}>
              {prediction.source === 'plan' ? 'Laut Trainingsplan:' : 'Prognose:'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-text-2)' }}>
              {prediction.source === 'plan'
                ? `Woche ${prediction.weekNum} · ${prediction.date.toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : prediction.weeksAway <= 1
                  ? 'Diese Woche erreichbar'
                  : `~${prediction.weeksAway} Wochen · ${prediction.date.toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' })}`
              }
            </span>
          </div>
        </div>
      )}
      {prediction?.source === 'achieved' && !prog.achieved && (
        <div style={{
          marginTop: 10, paddingTop: 10,
          borderTop: '1px solid var(--c-border)',
          fontSize: 12, color: '#22c55e', fontWeight: 600,
        }}>
          ✅ Bereits schaffbar — markiere es als erreicht!
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, borderTop: '1px solid var(--c-border)', paddingTop: 12 }}>
          {prog.achieved && (
            <button onClick={() => { onAchieve(goal.id); setConfirmDelete(false) }}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #22c55e44', background: '#22c55e11', color: '#22c55e', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)' }}>
              ✅ Als erreicht markieren
            </button>
          )}
          <button onClick={() => { onDelete(goal.id); setConfirmDelete(false) }}
            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #ef444444', background: '#ef444411', color: '#ef4444', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            Löschen
          </button>
          <button onClick={() => setConfirmDelete(false)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text-3)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// ── Add Goal Form ──────────────────────────────────────────────────────────────

function AddGoalForm({ onSave, onCancel }) {
  const [step, setStep] = useState(1)
  const [type, setType] = useState(null)
  const [form, setForm] = useState({
    title: '',
    race_distance: '10km',
    race_date: '',
    target_time_input: '',   // MM:SS or H:MM:SS typed by user
    target_distance_km: 20,
    goal_distance_km: 5,     // for time goals: which distance
  })
  const [saving, setSaving] = useState(false)

  function update(k, v) { setForm(f => ({ ...f, [k]: v })) }

  const typeOptions = [
    { id: 'race', icon: '🏁', label: 'Rennen', desc: 'Mit Datum + Zielzeit' },
    { id: 'distance', icon: '📏', label: 'Distanz', desc: 'So weit wie möglich' },
    { id: 'time', icon: '⚡', label: 'Zeit', desc: 'Schneller über X km' },
  ]

  function buildGoalPayload() {
    const raceKm = RACE_DISTANCES.find(d => d.id === form.race_distance)?.km || 10
    let target_time_sec = null
    if (form.target_time_input.trim()) {
      target_time_sec = mmSsToSec(form.target_time_input.trim())
      if (!target_time_sec) {
        // Try H:MM:SS
        const parts = form.target_time_input.split(':')
        if (parts.length === 3) {
          target_time_sec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
        }
      }
    }

    if (type === 'race') {
      return {
        type,
        title: form.title || `${RACE_DISTANCES.find(d => d.id === form.race_distance)?.label} Rennen`,
        race_distance: form.race_distance,
        race_distance_km: raceKm,
        race_date: form.race_date || null,
        target_time_sec,
      }
    }
    if (type === 'distance') {
      return {
        type,
        title: form.title || `${form.target_distance_km} km laufen`,
        target_distance_km: parseFloat(form.target_distance_km),
      }
    }
    if (type === 'time') {
      const timeDistKm = parseFloat(form.goal_distance_km)
      return {
        type,
        title: form.title || `${timeDistKm} km in ${form.target_time_input || '—'}`,
        race_distance_km: timeDistKm,
        target_time_sec,
      }
    }
  }

  async function handleSave() {
    const payload = buildGoalPayload()
    if (!payload) return
    setSaving(true)
    await onSave(payload)
    setSaving(false)
  }

  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-primary)',
      borderRadius: 14, padding: 18,
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-text)' }}>Neues Ziel ✨</div>

      {/* Step 1: type selection */}
      {step === 1 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {typeOptions.map(opt => (
              <button key={opt.id} onClick={() => { setType(opt.id); setStep(2) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', borderRadius: 12,
                  border: `1.5px solid var(--c-border)`,
                  background: 'var(--c-bg)', cursor: 'pointer', fontFamily: 'var(--font)',
                  textAlign: 'left', transition: 'all 0.15s',
                }}>
                <span style={{ fontSize: 24 }}>{opt.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--c-text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <button onClick={onCancel}
            style={{ background: 'none', border: 'none', color: 'var(--c-text-3)', fontSize: 14, cursor: 'pointer', fontFamily: 'var(--font)', padding: 4 }}>
            Abbrechen
          </button>
        </>
      )}

      {/* Step 2: details */}
      {step === 2 && type === 'race' && (
        <>
          <div className="form-group">
            <label className="form-label">Renndistanz</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RACE_DISTANCES.map(d => (
                <button key={d.id} onClick={() => update('race_distance', d.id)}
                  style={{
                    padding: '8px 14px', borderRadius: 20, fontSize: 13,
                    border: `1.5px solid ${form.race_distance === d.id ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    background: form.race_distance === d.id ? 'var(--c-primary-dim)' : 'var(--c-bg)',
                    color: form.race_distance === d.id ? 'var(--c-primary)' : 'var(--c-text-2)',
                    fontWeight: form.race_distance === d.id ? 700 : 400,
                    cursor: 'pointer', fontFamily: 'var(--font)',
                  }}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Renndatum (optional)</label>
            <input type="date" className="form-input" value={form.race_date}
              onChange={e => update('race_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Zielzeit (optional) — z.B. 1:45:00</label>
            <input type="text" className="form-input" placeholder="h:mm:ss oder mm:ss"
              value={form.target_time_input} onChange={e => update('target_time_input', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Name (optional)</label>
            <input type="text" className="form-input" placeholder={`${RACE_DISTANCES.find(d => d.id === form.race_distance)?.label} Rennen`}
              value={form.title} onChange={e => update('title', e.target.value)} />
          </div>
        </>
      )}

      {step === 2 && type === 'distance' && (
        <>
          <div className="form-group">
            <label className="form-label">Zieldistanz</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DISTANCE_PRESETS.map(km => (
                <button key={km} onClick={() => update('target_distance_km', km)}
                  style={{
                    padding: '8px 14px', borderRadius: 20, fontSize: 13,
                    border: `1.5px solid ${form.target_distance_km === km ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    background: form.target_distance_km === km ? 'var(--c-primary-dim)' : 'var(--c-bg)',
                    color: form.target_distance_km === km ? 'var(--c-primary)' : 'var(--c-text-2)',
                    fontWeight: form.target_distance_km === km ? 700 : 400,
                    cursor: 'pointer', fontFamily: 'var(--font)',
                  }}>
                  {km} km
                </button>
              ))}
            </div>
            <input type="number" className="form-input" placeholder="Andere Distanz (km)" min={1} step={1}
              value={DISTANCE_PRESETS.includes(Number(form.target_distance_km)) ? '' : form.target_distance_km}
              onChange={e => update('target_distance_km', e.target.value)}
              style={{ marginTop: 8 }} />
          </div>
          <div className="form-group">
            <label className="form-label">Name (optional)</label>
            <input type="text" className="form-input" placeholder={`${form.target_distance_km} km laufen`}
              value={form.title} onChange={e => update('title', e.target.value)} />
          </div>
        </>
      )}

      {step === 2 && type === 'time' && (
        <>
          <div className="form-group">
            <label className="form-label">Über welche Distanz?</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[5, 10, 21.0975].map(km => (
                <button key={km} onClick={() => update('goal_distance_km', km)}
                  style={{
                    padding: '8px 14px', borderRadius: 20, fontSize: 13,
                    border: `1.5px solid ${form.goal_distance_km === km ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    background: form.goal_distance_km === km ? 'var(--c-primary-dim)' : 'var(--c-bg)',
                    color: form.goal_distance_km === km ? 'var(--c-primary)' : 'var(--c-text-2)',
                    fontWeight: form.goal_distance_km === km ? 700 : 400,
                    cursor: 'pointer', fontFamily: 'var(--font)',
                  }}>
                  {km === 21.0975 ? 'Halbmarathon' : `${km} km`}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Zielzeit — z.B. 20:00 für Sub-20</label>
            <input type="text" className="form-input" placeholder="mm:ss oder h:mm:ss"
              value={form.target_time_input} onChange={e => update('target_time_input', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Name (optional)</label>
            <input type="text" className="form-input"
              placeholder={`${form.goal_distance_km === 21.0975 ? 'Halbmarathon' : `${form.goal_distance_km} km`} in ${form.target_time_input || '—'}`}
              value={form.title} onChange={e => update('title', e.target.value)} />
          </div>
        </>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setStep(1)}
            style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid var(--c-border)', background: 'transparent', color: 'var(--c-text-2)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 14 }}>
            ← Zurück
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: 'none', background: 'var(--c-primary)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Speichern…' : 'Ziel speichern ✓'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main StatsTab ──────────────────────────────────────────────────────────────

export default function StatsTab({ user, profile, workoutLogs, stravaRuns, trainingPlan }) {
  const [goals, setGoals] = useState([])
  const [showAdd, setShowAdd] = useState(false)

  // Load goals from Supabase
  useEffect(() => {
    if (!user) return
    supabase.from('goals').select('*').eq('user_id', user.id).eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setGoals(data) })
  }, [user])

  const maxHR = useMemo(() => deriveMaxHR(stravaRuns), [stravaRuns])
  const paceTrend = useMemo(() => computePaceTrend(stravaRuns, maxHR), [stravaRuns, maxHR])
  const mileage = useMemo(() => weeklyMileageStats(stravaRuns), [stravaRuns])

  async function handleSaveGoal(payload) {
    const { data, error } = await supabase.from('goals')
      .insert({ ...payload, user_id: user.id }).select().single()
    if (!error && data) {
      setGoals(g => [data, ...g])
      setShowAdd(false)
    }
  }

  async function handleDeleteGoal(id) {
    await supabase.from('goals').delete().eq('id', id).eq('user_id', user.id)
    setGoals(g => g.filter(goal => goal.id !== id))
  }

  async function handleAchieveGoal(id) {
    await supabase.from('goals').update({ status: 'achieved', achieved_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id)
    setGoals(g => g.filter(goal => goal.id !== id))
  }

  const totalRuns = stravaRuns.length
  const totalKm = stravaRuns.reduce((s, r) => s + r.distance / 1000, 0)
  const bestPace5k = bestPaceForDistance(stravaRuns, 3, 90)

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2 style={{ fontSize: '1.125rem' }}>Statistiken</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
            Ziele · Pace · Volumen
          </p>
        </div>
        {/* Quick summary */}
        {totalRuns > 0 && (
          <div style={{
            background: 'var(--c-card)', border: '1px solid var(--c-border)',
            borderRadius: 10, padding: '6px 12px', textAlign: 'right',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
              {Math.round(totalKm)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', fontWeight: 600 }}>km gesamt</div>
          </div>
        )}
      </div>

      <div className="screen-scroll">
        <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

          {/* ── GOALS SECTION ─────────────────────────────────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
              <h3 style={{ fontSize: '1rem' }}>Meine Ziele 🎯</h3>
              {!showAdd && (
                <button onClick={() => setShowAdd(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 14px', borderRadius: 20,
                    border: '1.5px solid var(--c-primary)',
                    background: 'var(--c-primary-dim)', color: 'var(--c-primary)',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
                  }}>
                  <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Ziel
                </button>
              )}
            </div>

            {showAdd && (
              <AddGoalForm onSave={handleSaveGoal} onCancel={() => setShowAdd(false)} />
            )}

            {goals.length === 0 && !showAdd && (
              <div style={{
                background: 'var(--c-card)', border: '1px dashed var(--c-border)',
                borderRadius: 14, padding: '24px 20px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text)', marginBottom: 6 }}>
                  Noch keine Ziele
                </div>
                <div style={{ fontSize: 13, color: 'var(--c-text-3)', marginBottom: 16 }}>
                  Setze dir ein Ziel — Rennen, Distanz oder Zielzeit — und verfolge deinen Fortschritt.
                </div>
                <button onClick={() => setShowAdd(true)}
                  style={{
                    padding: '12px 24px', borderRadius: 12,
                    border: 'none', background: 'var(--c-primary)', color: '#fff',
                    fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)',
                  }}>
                  Erstes Ziel setzen
                </button>
              </div>
            )}

            {goals.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {goals.map(goal => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    stravaRuns={stravaRuns}
                    workoutLogs={workoutLogs}
                    trainingPlan={trainingPlan}
                    profile={profile}
                    onDelete={handleDeleteGoal}
                    onAchieve={handleAchieveGoal}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── CHARTS SECTION ────────────────────────────────────── */}
          {stravaRuns.length >= 3 && (
            <div style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 14, padding: '16px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              <PaceTrendChart data={paceTrend} />
              <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 16 }}>
                <VolumeChart data={mileage.weeklyBreakdown} />
              </div>
            </div>
          )}

          {stravaRuns.length < 3 && (
            <div style={{
              background: 'var(--c-card)', border: '1px solid var(--c-border)',
              borderRadius: 14, padding: '20px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', marginBottom: 4 }}>
                Trends werden sichtbar
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
                Sobald du Strava verbunden hast und mindestens 3 Läufe erfasst sind, zeigen wir dir Pace-Trend und Wochenvolumen.
              </div>
            </div>
          )}

          {/* ── BEST PERFORMANCES ─────────────────────────────────── */}
          {stravaRuns.length >= 3 && (
            <div>
              <h3 style={{ fontSize: '1rem', marginBottom: 'var(--sp-3)' }}>Bestleistungen</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
                {[
                  { label: '5 km Pace', value: bestPace5k ? formatPaceSec(bestPace5k) + '/km' : '—', sub: 'Beste Pace ≥3 km' },
                  { label: 'Längster Lauf', value: `${longestRun(stravaRuns, 365).toFixed(1)} km`, sub: 'Letztes Jahr' },
                  { label: 'Ø Woche', value: `${mileage.last4avg} km`, sub: 'Letzte 4 Wochen' },
                  { label: 'Peak-Woche', value: `${mileage.peak} km`, sub: 'Aller Zeiten' },
                ].map((stat, i) => (
                  <div key={i} style={{
                    background: 'var(--c-card)', border: '1px solid var(--c-border)',
                    borderRadius: 12, padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', fontWeight: 600, marginBottom: 4 }}>{stat.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>{stat.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 3 }}>{stat.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
