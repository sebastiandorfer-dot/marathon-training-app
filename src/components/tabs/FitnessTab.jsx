import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../supabase'
import { getStravaAuthUrl, fetchAllStravaRuns, getValidToken } from '../../utils/stravaUtils'
import {
  deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max,
  formatPaceSec, formatMarathonTime, calculateFitnessTrend,
  vo2maxCategory, getVO2maxDisplay, getMarathonTimeRange,
  weeklyMileageStats, computePaceTrend,
} from '../../utils/fitnessUtils'
import { weeklyLoadStats } from '../../utils/aiPlanService'
import { daysUntilMarathon } from '../../utils/planUtils'

export default function FitnessTab({ user, profile, onProfileUpdate, onRunsUpdate, workoutLogs = [] }) {
  const [runs, setRuns] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [lastSync, setLastSync] = useState(profile.strava_last_sync || null)

  const isConnected = !!profile.strava_access_token
  const daysLeft = profile.marathon_date ? daysUntilMarathon(profile.marathon_date) : null
  const inRaceWindow = daysLeft !== null && daysLeft <= 126 // 18 weeks

  // Load cached runs from Supabase
  useEffect(() => {
    if (!isConnected) return
    supabase
      .from('strava_runs')
      .select('*')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false })
      .then(({ data }) => { if (data) setRuns(data) })
  }, [user.id, isConnected])

  // Fitness calculations
  const maxHR = deriveMaxHR(runs)
  const vo2max = calculateVO2max(runs, maxHR)
  const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
  const trend = calculateFitnessTrend(runs)
  const mileage = weeklyMileageStats(runs)
  const category = vo2max ? vo2maxCategory(vo2max) : null
  const vo2maxDisplay = vo2max ? getVO2maxDisplay(vo2max) : null
  const marathonRange = useMemo(() => getMarathonTimeRange(vo2max, workoutLogs), [vo2max, workoutLogs])
  const paceTrend = useMemo(() => computePaceTrend(runs, maxHR), [runs, maxHR])
  const loadHistory = useMemo(() => weeklyLoadStats(workoutLogs), [workoutLogs])

  // ── Streak: consecutive calendar weeks with ≥1 logged workout ──
  const streak = useMemo(() => {
    if (!workoutLogs || workoutLogs.length === 0) return 0
    const getWeekKey = (dateStr) => {
      const d = new Date(dateStr)
      const sun = new Date(d)
      sun.setDate(d.getDate() - d.getDay())
      return sun.toISOString().split('T')[0]
    }
    const weeksWithLogs = new Set(workoutLogs.map(l => getWeekKey(l.workout_date)))
    // If current week already has a log, start counting from it; else start from last week
    const currKey = getWeekKey(new Date())
    const startOffset = weeksWithLogs.has(currKey) ? 0 : 1
    let count = 0
    let i = startOffset
    while (true) {
      const d = new Date()
      d.setDate(d.getDate() - i * 7)
      const key = getWeekKey(d)
      if (weeksWithLogs.has(key)) { count++; i++ } else break
    }
    return count
  }, [workoutLogs])

  // ── Target pace in seconds ──────────────────────────────────────
  const targetPaceSec = useMemo(() => {
    const m = parseInt(profile.target_pace_min) || 0
    const s = parseInt(profile.target_pace_sec) || 0
    return m * 60 + s > 0 ? m * 60 + s : null
  }, [profile.target_pace_min, profile.target_pace_sec])

  const handleConnectStrava = () => {
    window.location.href = getStravaAuthUrl()
  }

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncError('')
    try {
      const token = await getValidToken(profile, supabase)
      if (!token) throw new Error('No valid Strava token')

      const stravaRuns = await fetchAllStravaRuns(token)

      // Upsert runs into Supabase
      if (stravaRuns.length > 0) {
        const rows = stravaRuns.map(r => ({
          user_id: user.id,
          strava_id: String(r.id),
          start_date: r.start_date,
          distance: r.distance,
          moving_time: r.moving_time,
          average_speed: r.average_speed,
          average_heartrate: r.average_heartrate || null,
          max_heartrate: r.max_heartrate || null,
          total_elevation_gain: r.total_elevation_gain || 0,
          name: r.name,
        }))
        await supabase.from('strava_runs').upsert(rows, { onConflict: 'strava_id' })
        setRuns(rows)
        if (onRunsUpdate) onRunsUpdate(rows)
      }

      const now = new Date().toISOString()
      await supabase.from('profiles').update({ strava_last_sync: now }).eq('id', user.id)
      setLastSync(now)
      onProfileUpdate({ ...profile, strava_last_sync: now })
    } catch (err) {
      setSyncError(err.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [profile, user.id, onProfileUpdate])

  // ── Auto-sync on mount if last sync >4h ago ────────────────────
  const autoSyncRef = useRef(false)
  useEffect(() => {
    if (!isConnected || autoSyncRef.current) return
    const lastSyncTime = lastSync ? new Date(lastSync).getTime() : 0
    if (Date.now() - lastSyncTime > 4 * 60 * 60 * 1000) {
      autoSyncRef.current = true
      handleSync()
    }
  }, [isConnected, handleSync, lastSync])

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2 style={{ fontSize: '1.125rem' }}>Fitness</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--c-text-2)', marginTop: 2 }}>
            {isConnected ? `${runs.length} Läufe analysiert` : 'Verbinde Strava für deine Prognose'}
          </p>
        </div>
        {isConnected && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={handleSync}
            disabled={syncing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" style={{ animation: syncing ? 'spin 0.7s linear infinite' : 'none' }}>
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            {syncing ? 'Synchronisiere…' : 'Sync'}
          </button>
        )}
      </div>

      <div className="screen-scroll">
        <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

          {/* Training Streak — shown whenever there are logs, regardless of Strava */}
          {workoutLogs.length > 0 && (
            <div style={{
              display: 'flex', gap: 10,
            }}>
              <div style={{
                flex: 1, background: 'var(--c-card)', border: `1px solid ${streak >= 4 ? 'var(--c-primary)' : 'var(--c-border)'}`,
                borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{streak >= 8 ? '🔥' : streak >= 4 ? '⚡' : '🏃'}</div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: streak >= 4 ? 'var(--c-primary)' : 'var(--c-text)', lineHeight: 1 }}>
                    {streak}
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text-3)', marginLeft: 4 }}>
                      {streak === 1 ? 'Woche' : 'Wochen'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>
                    {streak === 0 ? 'Noch kein Streak' : 'Training-Streak'}
                  </div>
                </div>
              </div>
              <div style={{
                flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)',
                borderRadius: 14, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
                  {workoutLogs.length}
                </div>
                <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginTop: 2 }}>
                  Workouts gesamt
                </div>
              </div>
            </div>
          )}

          {/* Strava Connection */}
          {!isConnected ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-8)' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 'var(--sp-4)' }}>🔗</div>
              <h3 style={{ marginBottom: 'var(--sp-2)' }}>Strava verbinden</h3>
              <p style={{ marginBottom: 'var(--sp-5)', fontSize: '0.9rem' }}>
                Verbinde dein Strava-Konto um deine Läufe zu analysieren und eine wissenschaftliche Marathonprognose zu erhalten — basierend auf deinen echten Herzfrequenz- und Pace-Daten.
              </p>
              <button
                style={{
                  background: '#FC4C02', color: '#fff', border: 'none', borderRadius: 12,
                  padding: '14px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                  fontFamily: 'inherit', width: '100%',
                }}
                onClick={handleConnectStrava}
              >
                Mit Strava verbinden
              </button>
            </div>
          ) : (
            <>
              {/* Strava connected status */}
              <div style={{
                background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 12,
                padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#FC4C02', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>Strava verbunden</div>
                  {lastSync && (
                    <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                      Letzter Sync: {new Date(lastSync).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {syncError && <div style={{ fontSize: 12, color: 'var(--c-error)' }}>⚠ {syncError}</div>}
              </div>

              {runs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🏃</div>
                  <h3>Noch keine Läufe</h3>
                  <p>Tippe Sync um deine Strava-Läufe zu laden.</p>
                </div>
              ) : (
                <>
                  {/* Marathon Prediction — main card */}
                  <div style={{
                    background: `linear-gradient(135deg, var(--c-card) 0%, var(--c-card-hover) 100%)`,
                    border: `1px solid ${inRaceWindow ? 'var(--c-primary)' : 'var(--c-border)'}`,
                    borderRadius: 20, padding: 24, position: 'relative', overflow: 'hidden',
                  }}>
                    <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'var(--c-primary-dim)', pointerEvents: 'none' }} />
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-primary)', marginBottom: 8 }}>
                      🎯 Marathon Prediction
                    </div>

                    {marathonRange ? (
                      <>
                        {/* Time range — main display */}
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
                              {marathonRange.midTime}
                            </div>
                            <div style={{ fontSize: 14, color: 'var(--c-text-3)', fontWeight: 500 }}>
                              ±{marathonRange.confidence === 'high' ? '5' : marathonRange.confidence === 'medium' ? '15' : '20'} sek/km
                            </div>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 4 }}>
                            Bereich: {marathonRange.minTime} – {marathonRange.maxTime}
                          </div>
                        </div>

                        {/* Confidence indicator */}
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: marathonRange.confidence === 'high' ? 'rgba(34,197,94,0.1)' : marathonRange.confidence === 'medium' ? 'rgba(74,158,255,0.1)' : 'rgba(120,144,156,0.1)',
                          border: `1px solid ${marathonRange.confidence === 'high' ? '#22c55e44' : marathonRange.confidence === 'medium' ? '#4a9eff44' : '#78909c44'}`,
                          borderRadius: 8, padding: '4px 10px', marginBottom: 16, fontSize: 12,
                        }}>
                          <span>{marathonRange.confidence === 'high' ? '🎯' : marathonRange.confidence === 'medium' ? '📊' : '📐'}</span>
                          <span style={{ color: 'var(--c-text-2)' }}>
                            {marathonRange.confidence === 'high' ? 'Hohe Genauigkeit' : marathonRange.confidence === 'medium' ? 'Mittlere Genauigkeit' : 'Schätzung'} · {marathonRange.note}
                          </span>
                        </div>

                        {/* Fitness level + HR (no raw VO2max number) */}
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {vo2maxDisplay && (
                            <div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: vo2maxDisplay.color }}>{vo2maxDisplay.label}</div>
                              <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Fitness Level ({vo2maxDisplay.range})</div>
                            </div>
                          )}
                          {maxHR && (
                            <div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>{maxHR}</div>
                              <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Max HR (bpm)</div>
                            </div>
                          )}
                          {marathonRange.midPace && (
                            <div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>{marathonRange.midPace}</div>
                              <div style={{ fontSize: 11, color: 'var(--c-text-3)' }}>Pace /km</div>
                            </div>
                          )}
                        </div>

                        {!inRaceWindow && daysLeft !== null && (
                          <div style={{
                            marginTop: 16, padding: '10px 14px', background: 'rgba(29,158,117,0.1)',
                            border: '1px solid var(--c-primary)', borderRadius: 10, fontSize: 13, color: 'var(--c-text-2)',
                          }}>
                            <strong style={{ color: 'var(--c-primary)' }}>📈 Aufbauphase</strong> — Noch {daysLeft} Tage bis zum Rennen.
                            In {daysLeft - 126} Tagen startet dein 18-Wochen-Plan.
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <div style={{ fontSize: 16, color: 'var(--c-text-2)', marginBottom: 8 }}>
                          Nicht genug Daten für eine Vorhersage.
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--c-text-3)' }}>
                          Du brauchst mindestens 3 Läufe mit Herzfrequenz-Daten.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Pace Gap — target vs. predicted */}
                  {targetPaceSec && predictedPaceSec && (() => {
                    const gapSec = Math.round(predictedPaceSec - targetPaceSec)
                    const absGap = Math.abs(gapSec)
                    const faster = gapSec <= 0
                    // Color scale: ≤10s green, ≤30s yellow, ≤60s orange, >60s red
                    const gapColor = absGap <= 10 ? '#22c55e' : absGap <= 30 ? '#f59e0b' : absGap <= 60 ? '#f97316' : '#ef4444'
                    const MAX_GAP = 90
                    const progressPct = faster
                      ? 100
                      : Math.max(0, Math.round(((MAX_GAP - gapSec) / MAX_GAP) * 100))
                    return (
                      <div className="card">
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--c-text-3)', marginBottom: 12 }}>
                          🎯 Pace-Lücke
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 2 }}>Zielpace</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text)' }}>{formatPaceSec(targetPaceSec)}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 800, color: gapColor, lineHeight: 1 }}>
                              {faster ? '✓ Erreicht' : `−${Math.floor(absGap / 60)}:${String(absGap % 60).padStart(2, '0')}`}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>
                              {faster ? 'Ziel erreichbar' : 'noch aufzuholen'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 12, color: 'var(--c-text-3)', marginBottom: 2 }}>Aktuell</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: gapColor }}>{formatPaceSec(predictedPaceSec)}</div>
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div style={{ height: 6, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${progressPct}%`,
                            background: gapColor, borderRadius: 4,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 6 }}>
                          {faster
                            ? `Du bist ${formatPaceSec(Math.abs(gapSec))}/km schneller als dein Ziel — top!`
                            : `Noch ${formatPaceSec(gapSec)}/km bis zum Ziel · ${progressPct}% erreicht`}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Trend */}
                  {trend !== null && (
                    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                        background: trend >= 0 ? 'var(--c-primary-dim)' : 'var(--c-error-dim)',
                        border: `1px solid ${trend >= 0 ? 'var(--c-primary)' : 'var(--c-error)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                      }}>
                        {trend >= 0 ? '📈' : '📉'}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--c-text)' }}>
                          Aerobe Effizienz {trend >= 0 ? '+' : ''}{trend}%
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--c-text-2)' }}>
                          {trend >= 2 ? 'Klare Verbesserung — du wirst fitter!' :
                           trend >= 0 ? 'Stabil — weiter so.' :
                           'Leichter Rückgang — mehr Schlaf & Erholung helfen.'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Weekly Mileage */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                      <h3 style={{ fontSize: '1rem' }}>Wochenkilometer</h3>
                      <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>{runs.length} Läufe gesamt</span>
                    </div>

                    {/* Summary stats */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                      {[
                        { v: mileage.last4avg, l: 'Ø letzte 4 Wo.' },
                        { v: mileage.avg, l: 'Ø gesamt' },
                        { v: mileage.peak, l: 'Peak-Woche' },
                      ].map(({ v, l }) => (
                        <div key={l} style={{
                          flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)',
                          borderRadius: 12, padding: '10px 12px', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>{v} km</div>
                          <div style={{ fontSize: 11, color: 'var(--c-text-3)', marginTop: 2 }}>{l}</div>
                        </div>
                      ))}
                    </div>

                    {/* Bar chart: last 8 weeks */}
                    {mileage.weeklyBreakdown && mileage.weeklyBreakdown.length > 0 && (() => {
                      const maxKm = Math.max(...mileage.weeklyBreakdown.map(w => w.km), 1)
                      return (
                        <div style={{
                          background: 'var(--c-card)', border: '1px solid var(--c-border)',
                          borderRadius: 12, padding: '16px 12px 10px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                            {mileage.weeklyBreakdown.map((w, i) => {
                              const heightPct = (w.km / maxKm) * 100
                              const isLast = i === mileage.weeklyBreakdown.length - 1
                              const date = new Date(w.week)
                              const label = date.toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })
                              return (
                                <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                  <div style={{ fontSize: 10, color: 'var(--c-text-3)', fontWeight: 600 }}>{w.km}</div>
                                  <div style={{
                                    width: '100%', borderRadius: 4,
                                    background: isLast ? 'var(--c-primary)' : 'var(--c-border)',
                                    height: `${Math.max(heightPct, 6)}%`,
                                    minHeight: 4,
                                  }} />
                                  <div style={{ fontSize: 9, color: 'var(--c-text-3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%' }}>
                                    {label}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Pace Trend — line chart (last 8 weeks) */}
                  {paceTrend.filter(p => p.pace !== null).length >= 2 && (() => {
                    const data = paceTrend
                    const validPaces = data.filter(d => d.pace !== null).map(d => d.pace)
                    const minP = Math.min(...validPaces) - 15
                    const maxP = Math.max(...validPaces) + 15
                    const W = 320, H = 90
                    const PAD = { l: 44, r: 8, t: 10, b: 22 }
                    const cW = W - PAD.l - PAD.r
                    const cH = H - PAD.t - PAD.b
                    const xOf = (i) => PAD.l + (i / (data.length - 1)) * cW
                    const yOf = (pace) => PAD.t + ((pace - minP) / (maxP - minP)) * cH

                    // Build polyline path, split on null gaps
                    let pathD = ''
                    let inSeg = false
                    data.forEach((pt, i) => {
                      if (pt.pace !== null) {
                        pathD += inSeg ? ` L ${xOf(i).toFixed(1)} ${yOf(pt.pace).toFixed(1)}` : `M ${xOf(i).toFixed(1)} ${yOf(pt.pace).toFixed(1)}`
                        inSeg = true
                      } else { inSeg = false }
                    })

                    // Y-axis guide labels (top = fast, bottom = slow since pace is inverted)
                    const midP = (minP + maxP) / 2
                    return (
                      <div>
                        <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>Pace-Trend (8 Wochen)</h3>
                        <div style={{
                          background: 'var(--c-card)', border: '1px solid var(--c-border)',
                          borderRadius: 12, padding: '12px 8px 4px',
                        }}>
                          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
                            {/* Grid lines */}
                            {[minP + (maxP - minP) * 0.25, midP, minP + (maxP - minP) * 0.75].map((p, idx) => (
                              <g key={idx}>
                                <line x1={PAD.l} y1={yOf(p)} x2={W - PAD.r} y2={yOf(p)}
                                  stroke="var(--c-border)" strokeWidth="1" strokeDasharray="3,3" />
                                <text x={PAD.l - 4} y={yOf(p) + 3.5} textAnchor="end" fontSize="8" fill="var(--c-text-3)">
                                  {formatPaceSec(Math.round(p))}
                                </text>
                              </g>
                            ))}
                            {/* Line */}
                            <path d={pathD} fill="none" stroke="var(--c-primary)" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round" />
                            {/* Dots + X labels */}
                            {data.map((pt, i) => (
                              <g key={i}>
                                {pt.pace !== null && (
                                  <circle cx={xOf(i)} cy={yOf(pt.pace)} r="3"
                                    fill="var(--c-primary)" stroke="var(--c-bg)" strokeWidth="1.5" />
                                )}
                                {(i % 2 === 0 || i === data.length - 1) && (
                                  <text x={xOf(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--c-text-3)">
                                    {new Date(pt.week).toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}
                                  </text>
                                )}
                              </g>
                            ))}
                          </svg>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Training Load Card */}
                  <TrainingLoadCard mileage={mileage} loadHistory={loadHistory} />

                  {/* Personal Records */}
                  <PersonalRecordsCard runs={runs} />

                  {/* Recent runs */}
                  <div>
                    <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>Letzte Läufe</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {runs.slice(0, 8).map(run => {
                        const km = Math.round(run.distance / 100) / 10
                        const paceS = run.average_speed ? 1000 / run.average_speed : null
                        return (
                          <div key={run.strava_id} style={{
                            background: 'var(--c-card)', border: '1px solid var(--c-border)',
                            borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
                          }}>
                            <div style={{ width: 40, textAlign: 'center', flexShrink: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase' }}>
                                {new Date(run.start_date).toLocaleDateString('de-AT', { month: 'short' })}
                              </div>
                              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)', lineHeight: 1 }}>
                                {new Date(run.start_date).getDate()}
                              </div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {run.name}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--c-text-2)' }}>
                                {km} km · {paceS ? formatPaceSec(paceS) + '/km' : ''}
                                {run.average_heartrate ? ` · ♥ ${Math.round(run.average_heartrate)} bpm` : ''}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Training Load Card ─────────────────────────────────────────────────────────
// Uses weighted training load (km × intensity) instead of raw km.
// Qualitative assessment based on load trend, not just volume.
function TrainingLoadCard({ mileage, loadHistory = [] }) {
  const breakdown = mileage.weeklyBreakdown || []
  if (breakdown.length < 5 || loadHistory.length < 5) return null

  const thisWeekKm   = breakdown[breakdown.length - 1]?.km || 0
  const thisWeekLoad = loadHistory[loadHistory.length - 1]?.load || 0

  // Previous 4 completed weeks
  const prev4Loads = loadHistory.slice(-5, -1).filter(w => w.load > 0)
  const prev4KmArr = breakdown.slice(-5, -1)

  if (prev4Loads.length < 2 || thisWeekLoad === 0) return null

  const prev4avgLoad = prev4Loads.reduce((s, w) => s + w.load, 0) / prev4Loads.length
  const prev4avgKm   = prev4KmArr.reduce((s, w) => s + w.km, 0) / 4

  // How far through the week are we?
  const dayOfWeek    = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
  const weekProgress = (dayOfWeek + 1) / 7
  const weekInProgress = dayOfWeek < 6

  const loadChangePct = Math.round(((thisWeekLoad - prev4avgLoad) / prev4avgLoad) * 100)
  const kmChangePct   = Math.round(((thisWeekKm   - prev4avgKm)   / Math.max(prev4avgKm, 1)) * 100)

  // Qualitative assessment based on weighted load
  const { color, icon, label, hint } =
    loadChangePct > 25 ? {
      color: '#ef4444', icon: '⚠️',
      label: `+${loadChangePct}% Last — Achtung`,
      hint: `Deine Intensität ist diese Woche stark erhöht. Das Verletzungsrisiko steigt — plane morgen bewusst leichter.`,
    } : loadChangePct > 12 ? {
      color: '#f97316', icon: '📊',
      label: `+${loadChangePct}% Last — erhöht`,
      hint: `Etwas intensiver als gewohnt. Achte auf guten Schlaf und Ernährung.`,
    } : loadChangePct < -20 ? {
      color: '#4a9eff', icon: '💤',
      label: `${loadChangePct}% Last — Erholungswoche`,
      hint: `Deutlich weniger Belastung als sonst — perfekte Regenerationswoche. Lass die Muskeln sich erholen.`,
    } : {
      color: '#22c55e', icon: '✅',
      label: loadChangePct >= 0 ? `+${loadChangePct}% Last — gut` : `${loadChangePct}% Last — ausgewogen`,
      hint: `Deine Belastung ist im optimalen Bereich. Intensität und Volumen passen zusammen — weiter so!`,
    }

  return (
    <div style={{ background: 'var(--c-card)', border: `1px solid ${color}44`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px 8px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ⚡ Trainingsbelastung
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color }}>
          {icon} {label}
        </div>
      </div>
      <div style={{ padding: '12px 16px' }}>
        {/* Weighted load comparison */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{thisWeekLoad.toFixed(1)}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 2 }}>Diese Woche</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{thisWeekKm} km</div>
          </div>
          <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--c-border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 999, background: color,
              width: `${Math.min(100, Math.max(5, (thisWeekLoad / Math.max(prev4avgLoad * 1.35, thisWeekLoad)) * 100))}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text-3)', lineHeight: 1 }}>{prev4avgLoad.toFixed(1)}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)', marginTop: 2 }}>Ø 4 Wochen</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{Math.round(prev4avgKm * 10) / 10} km</div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--c-text-2)', margin: 0, lineHeight: 1.5 }}>{hint}</p>

        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--c-text-3)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>Last = km × Intensität (Easy ×1, Tempo ×1.5, Intervall ×2)</span>
        </div>

        {weekInProgress && (
          <p style={{ fontSize: 11, color: 'var(--c-text-3)', margin: '4px 0 0', fontStyle: 'italic' }}>
            Woche noch nicht abgeschlossen ({Math.round(weekProgress * 100)}% der Woche vorbei)
          </p>
        )}
      </div>
    </div>
  )
}

// ── Personal Records Card ──────────────────────────────────────────────────────
function PersonalRecordsCard({ runs }) {
  if (!runs || runs.length < 1) return null

  const longestRun = runs.reduce((best, r) =>
    r.distance > (best?.distance || 0) ? r : best, null)
  const fastestPaceRun = runs.filter(r => r.average_speed && r.distance > 5000).reduce((best, r) =>
    r.average_speed > (best?.average_speed || 0) ? r : best, null)
  const peakWeekKm = (() => {
    const byWeek = {}
    for (const r of runs) {
      const d = new Date(r.start_date)
      d.setDate(d.getDate() - d.getDay())
      const k = d.toISOString().split('T')[0]
      byWeek[k] = (byWeek[k] || 0) + r.distance / 1000
    }
    return Math.max(...Object.values(byWeek), 0)
  })()

  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

  const records = [
    longestRun && {
      icon: '🛣️',
      label: 'Längster Lauf',
      value: `${(longestRun.distance / 1000).toFixed(1)} km`,
      sub: new Date(longestRun.start_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    fastestPaceRun && {
      icon: '⚡',
      label: 'Schnellste Pace',
      value: `${fmt(1000 / fastestPaceRun.average_speed)} /km`,
      sub: `${(fastestPaceRun.distance / 1000).toFixed(1)} km · ${new Date(fastestPaceRun.start_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}`,
    },
    peakWeekKm > 0 && {
      icon: '📅',
      label: 'Beste Woche',
      value: `${Math.round(peakWeekKm * 10) / 10} km`,
      sub: 'Höchste Wochenkilometer',
    },
  ].filter(Boolean)

  if (records.length === 0) return null

  return (
    <div>
      <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>🏆 Persönliche Bestleistungen</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        {records.map(r => (
          <div key={r.label} style={{
            flex: 1, background: 'var(--c-card)', border: '1px solid var(--c-border)',
            borderRadius: 12, padding: '12px 10px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{r.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--c-primary)', lineHeight: 1.1, marginBottom: 3 }}>{r.value}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{r.label}</div>
            <div style={{ fontSize: 10, color: 'var(--c-text-3)' }}>{r.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
