import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../supabase'
import { getStravaAuthUrl, fetchAllStravaRuns, getValidToken } from '../../utils/stravaUtils'
import {
  deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max,
  formatPaceSec, formatMarathonTime, calculateFitnessTrend,
  vo2maxCategory, weeklyMileageStats, computePaceTrend,
} from '../../utils/fitnessUtils'
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
  const paceTrend = useMemo(() => computePaceTrend(runs), [runs])

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
            {isConnected ? `${runs.length} runs analysed` : 'Connect Strava to start'}
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
            {syncing ? 'Syncing…' : 'Sync'}
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
              <h3 style={{ marginBottom: 'var(--sp-2)' }}>Connect Strava</h3>
              <p style={{ marginBottom: 'var(--sp-5)', fontSize: '0.9rem' }}>
                Connect your Strava account to analyse your runs and get a scientific marathon pace prediction — powered by your real heart rate and pace data.
              </p>
              <button
                style={{
                  background: '#FC4C02', color: '#fff', border: 'none', borderRadius: 12,
                  padding: '14px 24px', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                  fontFamily: 'inherit', width: '100%',
                }}
                onClick={handleConnectStrava}
              >
                Connect with Strava
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-text)' }}>Strava Connected</div>
                  {lastSync && (
                    <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                      Last sync: {new Date(lastSync).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {syncError && <div style={{ fontSize: 12, color: 'var(--c-error)' }}>⚠ {syncError}</div>}
              </div>

              {runs.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🏃</div>
                  <h3>No runs yet</h3>
                  <p>Press Sync to load your Strava runs.</p>
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

                    {vo2max ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                          <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1 }}>
                            {formatMarathonTime(predictedPaceSec)}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, color: 'var(--c-text-2)', marginBottom: 20 }}>
                          Predicted finish · {formatPaceSec(predictedPaceSec)} min/km
                        </div>

                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: category?.color }}>{Math.round(vo2max)}</div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>VO₂max (ml/kg/min)</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: category?.color }}>{category?.label}</div>
                            <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Fitness Level</div>
                          </div>
                          {maxHR && (
                            <div>
                              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-text)' }}>{maxHR}</div>
                              <div style={{ fontSize: 12, color: 'var(--c-text-3)' }}>Max HR (bpm)</div>
                            </div>
                          )}
                        </div>

                        {!inRaceWindow && daysLeft !== null && (
                          <div style={{
                            marginTop: 20, padding: '12px 16px', background: 'rgba(29,158,117,0.1)',
                            border: '1px solid var(--c-primary)', borderRadius: 10, fontSize: 13, color: 'var(--c-text-2)',
                          }}>
                            <strong style={{ color: 'var(--c-primary)' }}>📈 Aufbauphase</strong> — Du bist noch <strong>{daysLeft}</strong> Tage vom Rennen entfernt.
                            In {daysLeft - 126} Tagen startet dein 18-Wochen-Marathonplan. Bis dahin: Fitness aufbauen, Pace verbessern.
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
                          Aerobic Efficiency {trend >= 0 ? '+' : ''}{trend}%
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
