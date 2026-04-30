import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from './supabase'
import { generateTrainingPlan, getTotalPlanWeeks, getCurrentPlanPosition } from './utils/planUtils'
import { deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max } from './utils/fitnessUtils'
import { shouldRegeneratePlan, generateAIPlan } from './utils/aiPlanService'

import PWAInstallBanner from './components/PWAInstallBanner'
import Auth from './components/Auth'
import Onboarding from './components/Onboarding'
import GeneratingPlan from './components/GeneratingPlan'
import LoadingScreen from './components/LoadingScreen'
import TabBar from './components/TabBar'
import TodayTab from './components/tabs/TodayTab'
import PlanTab from './components/tabs/PlanTab'
import CoachTab from './components/tabs/CoachTab'
import ProfileTab from './components/tabs/ProfileTab'
import FitnessTab from './components/tabs/FitnessTab'
import StatsTab from './components/tabs/StatsTab'
import { exchangeStravaCode, getValidToken, fetchAllStravaRuns, makeStravaLogRow, filterNewStravaRuns, classifyRunType } from './utils/stravaUtils'

/**
 * Persist a detected PR into profiles.personal_records (jsonb).
 * Keys: pr_5k | pr_10k | pr_half | pr_marathon — value: pace in sec/km.
 */
async function savePR(pr, userId) {
  const keyMap = { '5 km': 'pr_5k', '10 km': 'pr_10k', 'Halbmarathon': 'pr_half', 'Marathon': 'pr_marathon' }
  const key = keyMap[pr.category]
  if (!key) return
  try {
    const { data } = await supabase.from('profiles').select('personal_records').eq('id', userId).single()
    const existing = data?.personal_records || {}
    if (!existing[key] || pr.pace < existing[key]) {
      await supabase.from('profiles').update({ personal_records: { ...existing, [key]: Math.round(pr.pace) } }).eq('id', userId)
    }
  } catch (err) {
    console.warn('Failed to save PR:', err)
  }
}

/**
 * Detect if a new Strava run is a personal record for its distance category.
 * Returns { category, pace, prevPace, distKm } or null.
 * pace is sec/km — lower = faster.
 */
function detectPR(newRun, allRuns) {
  const distKm = newRun.distance / 1000
  const pace = newRun.average_speed ? 1000 / newRun.average_speed : null
  if (!pace) return null

  let category, minKm, maxKm
  if      (distKm >= 3  && distKm < 8)  { category = '5 km';          minKm = 3;  maxKm = 8   }
  else if (distKm >= 8  && distKm < 16) { category = '10 km';         minKm = 8;  maxKm = 16  }
  else if (distKm >= 16 && distKm < 32) { category = 'Halbmarathon';  minKm = 16; maxKm = 32  }
  else if (distKm >= 32)                { category = 'Marathon';       minKm = 32; maxKm = 999 }
  else return null // < 3km — too short for meaningful PR

  const newId = String(newRun.id ?? newRun.strava_id)
  const existing = allRuns.filter(r => {
    const rKm = r.distance / 1000
    return String(r.strava_id) !== newId && r.average_speed && rKm >= minKm && rKm < maxKm
  })

  if (existing.length === 0) return null // no baseline — first run in category

  const bestExisting = Math.min(...existing.map(r => 1000 / r.average_speed))
  return pace < bestExisting ? { category, pace, prevPace: bestExisting, distKm } : null
}

/**
 * Build an RPE feedback queue from a batch of newly inserted Strava runs.
 * Only includes runs from the last 14 days, sorted newest first, max 3.
 */
function buildFeedbackQueue(stravaRuns, insertedLogs) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const recent = [...stravaRuns]
    .filter(r => new Date(r.start_date).getTime() > cutoff)
    .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
    .slice(0, 3)

  return recent.map(r => {
    const stravaId = String(r.strava_id ?? r.id)
    const log = insertedLogs.find(l => l.notes === `strava:${stravaId}`)
    return log ? { log, run: r } : null
  }).filter(Boolean)
}

// Views: 'loading' | 'auth' | 'onboarding' | 'generating' | 'app'
export default function App() {
  const [view, setView] = useState('loading')
  const [activeTab, setActiveTab] = useState('today')

  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [trainingPlan, setTrainingPlan] = useState(null)
  const [completedWorkoutIds, setCompletedWorkoutIds] = useState([])
  const [workoutLogs, setWorkoutLogs] = useState([])
  const [chatMessages, setChatMessages] = useState([])
  const [stravaRuns, setStravaRuns] = useState([])

  const [generateError, setGenerateError] = useState('')
  const [onboardingData, setOnboardingData] = useState(null)
  const [stravaError, setStravaError] = useState(null) // null | 'token' | 'network'
  const [pendingPR, setPendingPR] = useState(null) // { category, pace, prevPace, distKm }

  // AI-generated adaptive plan
  const [aiPlan, setAiPlan] = useState(null)
  const [aiPlanGenerating, setAiPlanGenerating] = useState(false)
  const [lastPlanChange, setLastPlanChange] = useState(null) // reason shown as toast
  const aiPlanRef = useRef(null)       // mirrors aiPlan, avoids stale closures
  const workoutLogsRef = useRef([])    // mirrors workoutLogs, for AI check after upsert
  const [pendingStravaQueue, setPendingStravaQueue] = useState([]) // [{log, run}] queue awaiting RPE

  // ── Merge strava runs into workout logs (single source of truth for all tabs) ──
  const allWorkoutLogs = useMemo(() => {
    const loggedStravaIds = new Set(
      workoutLogs.map(l => l.notes?.match(/strava:(\d+)/)?.[1]).filter(Boolean)
    )
    const stravaAsLogs = stravaRuns
      .filter(r => !loggedStravaIds.has(String(r.strava_id)))
      .map(r => {
        const distKm = r.distance / 1000
        return {
          id: `strava-${r.strava_id}`,
          workout_date: r.start_date.slice(0, 10),
          distance_km: parseFloat(distKm.toFixed(2)),
          duration_min: Math.round(r.moving_time / 60),
          workout_type: classifyRunType(r, profile),
          notes: `strava:${r.strava_id}`,
          rpe: null,
          _fromStrava: true,
        }
      })
    return [...workoutLogs, ...stravaAsLogs]
      .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
  }, [workoutLogs, stravaRuns, profile])

  // ── Generate weekly KI feedback (Sunday ≥22:00) ───────────────
  const weeklyFeedbackRef = useRef(false)

  const generateWeeklyFeedback = useCallback(async (currentProfile, logs, runs) => {
    const now = new Date()
    const isSunday = now.getDay() === 0
    const isEvening = now.getHours() >= 22
    if (!isSunday || !isEvening) return

    // Compute Monday of current week
    const monday = new Date(now)
    monday.setDate(now.getDate() - 6)
    monday.setHours(0, 0, 0, 0)
    const weekStart = monday.toISOString().split('T')[0]

    // Skip if already generated for this week
    if (currentProfile.weekly_feedback?.weekStart === weekStart) return
    if (weeklyFeedbackRef.current) return
    weeklyFeedbackRef.current = true

    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const weekLogs = logs.filter(l => l.workout_date >= weekStart && l.workout_date <= sunday.toISOString().split('T')[0])
    if (weekLogs.length === 0) { weeklyFeedbackRef.current = false; return }

    const totalKm = weekLogs.reduce((s, l) => s + (l.distance_km || 0), 0).toFixed(1)
    const avgRpe = weekLogs.filter(l => l.rpe).length > 0
      ? (weekLogs.filter(l => l.rpe).reduce((s, l) => s + l.rpe, 0) / weekLogs.filter(l => l.rpe).length).toFixed(1)
      : null
    const planned = currentProfile.sessions_per_week || 3
    const logsText = weekLogs.map(l =>
      `${l.workout_date}: ${l.workout_type}${l.distance_km ? ` ${l.distance_km}km` : ''}${l.duration_min ? ` ${l.duration_min}min` : ''}${l.rpe ? ` RPE ${l.rpe}/10` : ''}`
    ).join('\n')

    try {
      const { data } = await supabase.functions.invoke('ai-proxy', {
        body: {
          model: 'claude-haiku-4-5',
          max_tokens: 250,
          messages: [{
            role: 'user',
            content: `Du bist ein Marathontrainer. Gib ein kurzes, ehrliches Wochenfeedback auf Deutsch (2-3 Sätze, direkt, kein Smalltalk).

Woche ${weekStart}:
${logsText}

Gesamt: ${totalKm}km, ${weekLogs.length}/${planned} geplante Einheiten${avgRpe ? `, Ø RPE ${avgRpe}/10` : ''}.
Level: ${currentProfile.level || 'unbekannt'}

Antworte mit JSON: {"text": "...", "emoji": "✅|⚠️|🔥|💪|😤"}`,
          }],
        },
      })
      const raw = data?.content?.[0]?.text || ''
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return
      const parsed = JSON.parse(match[0])
      const feedback = { ...parsed, weekStart, generatedAt: now.toISOString() }
      await supabase.from('profiles').update({ weekly_feedback: feedback }).eq('id', currentProfile.id)
      setProfile(p => p ? { ...p, weekly_feedback: feedback } : p)
    } catch (err) {
      console.warn('Weekly feedback generation failed:', err)
    } finally {
      weeklyFeedbackRef.current = false
    }
  }, [])

  // ── Persist AI plan to profiles.ai_plan ───────────────────────
  const saveAiPlan = useCallback(async (plan, userId) => {
    try {
      await supabase.from('profiles').update({ ai_plan: plan }).eq('id', userId)
    } catch (err) {
      console.warn('Failed to save AI plan:', err)
    }
  }, [])

  // ── Boot: check auth session + Strava OAuth callback ─────────
  useEffect(() => {
    // Handle Strava OAuth callback (?code=xxx in URL)
    const params = new URLSearchParams(window.location.search)
    const stravaCode = params.get('code')
    if (stravaCode) {
      // Remove code from URL immediately
      window.history.replaceState({}, '', window.location.pathname)
      // We'll handle the exchange after auth loads
      window._pendingStravaCode = stravaCode
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        loadUserData(session.user)
      } else {
        setView('auth')
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
        loadUserData(session.user)
      } else if (event === 'SIGNED_OUT') {
        setUser(null); setProfile(null); setTrainingPlan(null)
        setCompletedWorkoutIds([]); setWorkoutLogs([]); setChatMessages([])
        setView('auth')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load all user data ─────────────────────────────────────────
  async function loadUserData(authUser) {
    try {
      // Load or create profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      if (profileError) throw profileError

      if (!profileData || !profileData.onboarding_completed) {
        setProfile(profileData)
        setView('onboarding')
        return
      }

      // Backfill schedule_since for existing users who don't have it set yet.
      // Without this, buildPhaseUtils marks ALL past days as "missed".
      let activeProfile = profileData
      if (!profileData.schedule_since) {
        const today = new Date().toISOString().split('T')[0]
        const { data: patched } = await supabase
          .from('profiles')
          .update({ schedule_since: today })
          .eq('id', authUser.id)
          .select()
          .single()
        if (patched) activeProfile = patched
      }

      setProfile(activeProfile)

      // Handle pending Strava OAuth code
      if (window._pendingStravaCode) {
        const code = window._pendingStravaCode
        window._pendingStravaCode = null
        try {
          const tokenData = await exchangeStravaCode(code)
          const { data: updatedProfile } = await supabase
            .from('profiles')
            .update({
              strava_access_token: tokenData.access_token,
              strava_refresh_token: tokenData.refresh_token,
              strava_token_expires_at: tokenData.expires_at,
            })
            .eq('id', authUser.id)
            .select()
            .single()
          if (updatedProfile) setProfile(updatedProfile)
        } catch (err) {
          console.error('Strava token exchange failed:', err)
        }
      }

      // Load training plan, completions, logs, chat — in parallel
      const [planRes, completionsRes, logsRes, chatRes, runsRes] = await Promise.all([
        supabase.from('training_plans').select('*').eq('user_id', authUser.id).maybeSingle(),
        supabase.from('completed_workouts').select('workout_id').eq('user_id', authUser.id),
        supabase.from('workout_logs').select('*').eq('user_id', authUser.id).order('workout_date', { ascending: false }),
        supabase.from('chat_messages').select('*').eq('user_id', authUser.id).order('created_at', { ascending: true }).limit(100),
        supabase.from('strava_runs').select('*').eq('user_id', authUser.id).order('start_date', { ascending: false }),
      ])

      if (planRes.data) setTrainingPlan(planRes.data)
      if (completionsRes.data) setCompletedWorkoutIds(completionsRes.data.map(c => c.workout_id))
      if (chatRes.data) setChatMessages(chatRes.data)
      if (runsRes.data) setStravaRuns(runsRes.data)

      // ── Bridge: auto-import Strava runs into workout_logs ─────────────────
      const existingLogs = logsRes.data || []
      const stravaRunsData = runsRes.data || []
      let mergedLogs = existingLogs

      const toInsert = filterNewStravaRuns(stravaRunsData, existingLogs)
      if (toInsert.length > 0) {
        const newRows = toInsert.map(r => makeStravaLogRow(r, authUser.id, activeProfile))
        const { data: inserted, error: insertError } = await supabase
          .from('workout_logs').insert(newRows).select()
        if (insertError) console.warn('Strava→workout_logs bridge failed:', insertError)
        if (inserted?.length) {
          mergedLogs = [...existingLogs, ...inserted]
            .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
          setPendingStravaQueue(buildFeedbackQueue(toInsert, inserted))
        }
      }

      setWorkoutLogs(mergedLogs)
      workoutLogsRef.current = mergedLogs

      // Load stored AI plan — use it directly, skip generation if still valid
      const storedPlan = activeProfile.ai_plan || null
      if (storedPlan) {
        setAiPlan(storedPlan)
        aiPlanRef.current = storedPlan
      }

      // Only regenerate if no stored plan or training significantly deviated
      const logs = mergedLogs
      const runs = runsRes.data || []
      const { should } = shouldRegeneratePlan(null, logs, storedPlan, activeProfile)
      if (should) {
        setAiPlanGenerating(true)
        generateAIPlan(activeProfile, logs, runs, supabase)
          .then(plan => {
            const enriched = { ...plan, lastChangeReason: null }
            setAiPlan(enriched)
            aiPlanRef.current = enriched
            saveAiPlan(enriched, activeProfile.id)
          })
          .catch(err => console.warn('Initial AI plan failed:', err))
          .finally(() => setAiPlanGenerating(false))
      }

      setView('app')

      // Trigger weekly feedback if it's Sunday ≥22:00
      generateWeeklyFeedback(activeProfile, mergedLogs, runsRes.data || [])
    } catch (err) {
      console.error('Failed to load user data:', err)
      setView('auth')
    }
  }

  // ── Onboarding complete: save profile + (optionally) generate plan
  async function handleOnboardingComplete(formData) {
    const mode = formData.training_mode || 'race'

    if (mode === 'race') {
      // Race mode: save profile + generate 18-week plan
      setOnboardingData(formData)
      setView('generating')
      setGenerateError('')

      try {
        const profilePayload = {
          id: user.id,
          email: user.email,
          ...formData,
          onboarding_completed: true,
          // Set schedule_since so days before today aren't marked as "missed"
          schedule_since: formData.schedule_since || new Date().toISOString().split('T')[0],
        }
        const { data: savedProfile, error: profileError } = await supabase
          .from('profiles')
          .upsert(profilePayload)
          .select()
          .single()
        if (profileError) throw profileError
        setProfile(savedProfile)

        const planData = await generateTrainingPlan(savedProfile, {}, supabase)
        const { data: savedPlan, error: planError } = await supabase
          .from('training_plans')
          .upsert({ user_id: user.id, plan_data: planData }, { onConflict: 'user_id' })
          .select()
          .single()
        if (planError) throw planError
        setTrainingPlan(savedPlan)

        // Save initial goal if user set one during onboarding
        if (formData.initial_goal) {
          await supabase.from('goals').insert({ ...formData.initial_goal, user_id: user.id })
        }

        setView('app')
      } catch (err) {
        console.error('Error generating plan:', err)
        setGenerateError(err.message || 'Failed to generate your training plan.')
      }
    } else {
      // Fitness / Tracking: just save profile, no plan generation needed
      try {
        const profilePayload = {
          id: user.id,
          email: user.email,
          ...formData,
          onboarding_completed: true,
          schedule_since: formData.schedule_since || new Date().toISOString().split('T')[0],
        }
        const { data: savedProfile, error: profileError } = await supabase
          .from('profiles')
          .upsert(profilePayload)
          .select()
          .single()
        if (profileError) throw profileError
        setProfile(savedProfile)

        // Save initial goal if user set one during onboarding
        if (formData.initial_goal) {
          await supabase.from('goals').insert({ ...formData.initial_goal, user_id: user.id })
        }

        setView('app')
      } catch (err) {
        console.error('Error saving profile:', err)
        setGenerateError(err.message || 'Fehler beim Speichern deines Profils.')
      }
    }
  }

  async function retryGenerate() {
    if (!onboardingData || !profile) return
    setGenerateError('')
    try {
      const planData = await generateTrainingPlan(profile, {}, supabase)
      const { data: savedPlan, error } = await supabase
        .from('training_plans')
        .upsert({ user_id: user.id, plan_data: planData }, { onConflict: 'user_id' })
        .select()
        .single()
      if (error) throw error
      setTrainingPlan(savedPlan)
      setView('app')
    } catch (err) {
      setGenerateError(err.message || 'Failed to generate training plan.')
    }
  }

  // ── Toggle workout completion ──────────────────────────────────
  const handleToggleComplete = useCallback(async (workoutId) => {
    const isDone = completedWorkoutIds.includes(workoutId)
    // Optimistic update
    setCompletedWorkoutIds(prev =>
      isDone ? prev.filter(id => id !== workoutId) : [...prev, workoutId]
    )
    try {
      if (isDone) {
        const { error } = await supabase
          .from('completed_workouts')
          .delete()
          .eq('user_id', user.id)
          .eq('workout_id', workoutId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('completed_workouts')
          .insert({ user_id: user.id, workout_id: workoutId })
        if (error) throw error
      }
    } catch (err) {
      // Revert on failure
      setCompletedWorkoutIds(prev =>
        isDone ? [...prev, workoutId] : prev.filter(id => id !== workoutId)
      )
      console.error('Toggle completion failed:', err)
    }
  }, [completedWorkoutIds, user])

  // ── Shift today's workout to tomorrow (or swap if tomorrow is occupied) ──────
  const handleShiftWorkout = useCallback(async (workoutId) => {
    if (!trainingPlan?.plan_data?.weeks || !profile?.marathon_date) return
    const pos = getCurrentPlanPosition(profile.marathon_date)
    if (pos.status !== 'active') return

    const todayDow = pos.dayOfWeek                         // 0=Mon…6=Sun
    const tomorrowDow = (todayDow + 1) % 7

    const newWeeks = trainingPlan.plan_data.weeks.map(week => {
      if (week.week !== pos.week) return week
      const workouts = week.workouts ? [...week.workouts] : []
      const todayIdx    = workouts.findIndex(w => w.id === workoutId)
      const tomorrowIdx = workouts.findIndex(w => w.day_of_week === tomorrowDow)
      if (todayIdx === -1) return week
      const newWorkouts = workouts.map((w, i) => {
        if (i === todayIdx)    return { ...w, day_of_week: tomorrowDow }
        if (tomorrowIdx !== -1 && i === tomorrowIdx) return { ...w, day_of_week: todayDow }
        return w
      })
      return { ...week, workouts: newWorkouts }
    })

    const newPlanData = { ...trainingPlan.plan_data, weeks: newWeeks }
    const { data, error } = await supabase
      .from('training_plans').update({ plan_data: newPlanData })
      .eq('user_id', user.id).select().single()
    if (!error && data) setTrainingPlan(data)
  }, [trainingPlan, profile, user])

  // ── Add / update workout log ───────────────────────────────────
  // Upsert by ID so an RPE update doesn't duplicate. After each upsert,
  // check if the AI plan needs regeneration (significant changes only).
  const handleLogAdded = useCallback((newLog) => {
    // Compute updated logs once — used for both state update and AI check
    const prev = workoutLogsRef.current
    const idx = prev.findIndex(l => l.id === newLog.id)
    const updatedLogs = idx >= 0
      ? prev.map((l, i) => i === idx ? newLog : l)
      : [newLog, ...prev]

    // 1. Update state + ref together
    workoutLogsRef.current = updatedLogs
    setWorkoutLogs(updatedLogs)

    // 2. AI plan regeneration check
    // Guard against concurrent generation — second call would overwrite first with stale context
    if (aiPlanRef.current?._generating) return

    const { should, reason } = shouldRegeneratePlan(newLog, updatedLogs, aiPlanRef.current, profile)
    if (should) {
      aiPlanRef.current = { ...aiPlanRef.current, _generating: true }
      setAiPlanGenerating(true)
      generateAIPlan(profile, updatedLogs, stravaRuns, supabase)
        .then(plan => {
          const enriched = { ...plan, lastChangeReason: reason }
          setAiPlan(enriched)
          aiPlanRef.current = enriched
          setLastPlanChange(reason) // trigger toast
          saveAiPlan(enriched, user.id)
        })
        .catch(err => {
          // Clear generating flag so next log can retry
          if (aiPlanRef.current?._generating) {
            aiPlanRef.current = { ...aiPlanRef.current, _generating: false }
          }
          console.warn('AI plan generation failed:', err)
        })
        .finally(() => setAiPlanGenerating(false))
    }
  }, [profile, stravaRuns])

  // ── Update existing workout log (inline edit) ─────────────────
  const handleLogUpdated = useCallback((updatedLog) => {
    const updated = workoutLogsRef.current.map(l => l.id === updatedLog.id ? updatedLog : l)
    workoutLogsRef.current = updated
    setWorkoutLogs(updated)
  }, [])

  // ── Delete workout log ─────────────────────────────────────────
  const handleLogDeleted = useCallback(async (logId) => {
    // Update both state and ref together so AI checks don't use stale data
    const updated = workoutLogsRef.current.filter(l => l.id !== logId)
    workoutLogsRef.current = updated
    setWorkoutLogs(updated)
    try {
      await supabase.from('workout_logs').delete().eq('id', logId).eq('user_id', user.id)
    } catch (err) {
      console.error('Failed to delete log:', err)
      // Reload logs on failure — keep ref in sync too
      const { data } = await supabase.from('workout_logs').select('*').eq('user_id', user.id).order('workout_date', { ascending: false })
      if (data) { setWorkoutLogs(data); workoutLogsRef.current = data }
    }
  }, [user])

  // ── Update profile ─────────────────────────────────────────────
  // When key training fields change, also regenerate the AI plan.
  const REGEN_FIELDS = ['training_days', 'sessions_per_week', 'flexibility_mode', 'marathon_date', 'target_pace_min', 'target_pace_sec']
  const handleProfileUpdate = useCallback((updatedProfile) => {
    setProfile(prev => {
      // Check if any planning-relevant field changed
      const changed = prev && REGEN_FIELDS.some(f => JSON.stringify(updatedProfile[f]) !== JSON.stringify(prev[f]))
      if (changed) {
        setAiPlanGenerating(true)
        generateAIPlan(updatedProfile, workoutLogsRef.current, stravaRuns, supabase)
          .then(plan => {
            const enriched = { ...plan, lastChangeReason: 'Profil aktualisiert — Plan neu berechnet' }
            setAiPlan(enriched)
            aiPlanRef.current = enriched
            setLastPlanChange('Profil aktualisiert — Plan neu berechnet')
            saveAiPlan(enriched, updatedProfile.id)
          })
          .catch(err => console.warn('AI plan regen after profile update failed:', err))
          .finally(() => setAiPlanGenerating(false))
      }
      return updatedProfile
    })
  }, [stravaRuns])

  // ── Update chat messages ───────────────────────────────────────
  const handleMessagesUpdate = useCallback((updaterOrMessages) => {
    setChatMessages(prev =>
      typeof updaterOrMessages === 'function'
        ? updaterOrMessages(prev)
        : updaterOrMessages
    )
  }, [])

  // ── Update Strava runs: auto-log new runs + trigger AI regen ──
  const handleRunsUpdate = useCallback(async (newRuns) => {
    setStravaRuns(newRuns)

    // Auto-import any new runs that aren't in workout_logs yet
    const toInsert = filterNewStravaRuns(newRuns, workoutLogsRef.current)
    if (toInsert.length > 0) {
      const newRows = toInsert.map(r => makeStravaLogRow(r, profile?.id, profile))
      const { data: inserted } = await supabase.from('workout_logs').insert(newRows).select()
      if (inserted?.length) {
        const merged = [...workoutLogsRef.current, ...inserted]
          .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
        workoutLogsRef.current = merged
        setWorkoutLogs(merged)
        setPendingStravaQueue(buildFeedbackQueue(toInsert, inserted))
        // PR detection for manually triggered Strava syncs (FitnessTab)
        const allRuns = newRuns
        for (const run of toInsert) {
          const pr = detectPR(run, allRuns)
          if (pr) {
            setPendingPR(pr)
            if (profile?.id) savePR(pr, profile.id)
            break
          }
        }
      }
    }

    if (!profile) return
    setAiPlanGenerating(true)
    generateAIPlan(profile, workoutLogsRef.current, newRuns, supabase)
      .then(plan => {
        const enriched = { ...plan, lastChangeReason: 'Strava synchronisiert — Plan aktualisiert' }
        setAiPlan(enriched)
        aiPlanRef.current = enriched
        setLastPlanChange('Neue Strava-Daten — Plan angepasst')
        saveAiPlan(enriched, profile.id)
      })
      .catch(err => console.warn('AI plan regen after Strava sync failed:', err))
      .finally(() => setAiPlanGenerating(false))
  }, [profile])

  // ── Global Strava auto-sync (on app load + on visibility change) ─
  const stravaAutoSyncRef = useRef(false)
  const performStravaSync = useCallback(async (currentProfile) => {
    if (!currentProfile?.strava_access_token) return
    const lastSyncTime = currentProfile.strava_last_sync
      ? new Date(currentProfile.strava_last_sync).getTime() : 0
    if (Date.now() - lastSyncTime < 30 * 60 * 1000) return // skip if synced <30min ago
    try {
      const token = await getValidToken(currentProfile, supabase)
      if (!token) {
        setStravaError('token') // token expired / revoked — user needs to reconnect
        return
      }
      const runs = await fetchAllStravaRuns(token)
      if (!runs.length) return
      const rows = runs.map(r => ({
        user_id: currentProfile.id,
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
      const { data: allRuns } = await supabase
        .from('strava_runs').select('*')
        .eq('user_id', currentProfile.id)
        .order('start_date', { ascending: false })
      const merged = allRuns || rows
      // Find truly new runs (not yet in workoutLogs) — auto-log them
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000 // only last 7 days
      const recentRuns = runs.filter(r => new Date(r.start_date).getTime() > cutoff)
      const newRuns = filterNewStravaRuns(recentRuns, workoutLogsRef.current)
      const syncInserted = []
      const syncRuns = []
      for (const r of newRuns) {
        const row = makeStravaLogRow(r, currentProfile.id, currentProfile)
        const { data: inserted } = await supabase.from('workout_logs').insert(row).select().single()
        if (inserted) {
          workoutLogsRef.current = [inserted, ...workoutLogsRef.current]
          setWorkoutLogs(prev => [inserted, ...prev])
          syncInserted.push(inserted)
          syncRuns.push(r)
        }
      }
      if (syncInserted.length > 0) {
        setPendingStravaQueue(buildFeedbackQueue(syncRuns, syncInserted))
        // Check for personal records among newly synced runs
        for (const run of syncRuns) {
          const pr = detectPR(run, merged)
          if (pr) {
            setPendingPR(pr)
            savePR(pr, currentProfile.id)
            break // show one PR at a time
          }
        }
      }
      setStravaRuns(merged)
      setStravaError(null) // sync succeeded — clear any previous error
      const now = new Date().toISOString()
      await supabase.from('profiles').update({ strava_last_sync: now }).eq('id', currentProfile.id)
      setProfile(p => p ? { ...p, strava_last_sync: now } : p)
      // Trigger AI plan regen with fresh data
      generateAIPlan(currentProfile, workoutLogsRef.current, merged, supabase)
        .then(plan => {
          const enriched = { ...plan, lastChangeReason: 'Strava synchronisiert — Plan aktualisiert' }
          setAiPlan(enriched)
          aiPlanRef.current = enriched
          saveAiPlan(enriched, currentProfile.id)
        })
        .catch(() => {})
    } catch (err) {
      console.warn('Auto Strava sync failed:', err)
      setStravaError('network')
    }
  }, [])

  // Run on app load (after profile is set) + on tab visibility change
  useEffect(() => {
    if (view !== 'app' || !profile) return
    if (!stravaAutoSyncRef.current) {
      stravaAutoSyncRef.current = true
      performStravaSync(profile)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        performStravaSync(profile)
        generateWeeklyFeedback(profile, workoutLogsRef.current, stravaRuns)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [view, profile, performStravaSync])

  // ── Regenerate plan (with Strava-calibrated pace if available) ─
  const handleRegeneratePlan = useCallback(() => {
    setView('generating')
    setGenerateError('')
    const maxHR           = deriveMaxHR(stravaRuns)
    const vo2max          = calculateVO2max(stravaRuns, maxHR)
    const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
    generateTrainingPlan(profile, { overridePaceSec: predictedPaceSec || null }, supabase)
      .then(planData => supabase.from('training_plans')
        .upsert({ user_id: user.id, plan_data: planData }, { onConflict: 'user_id' })
        .select().single())
      .then(({ data, error }) => {
        if (error) throw error
        setTrainingPlan(data)
        setCompletedWorkoutIds([])
        setView('app')
      })
      .catch(err => setGenerateError(err.message || 'Failed to generate plan.'))
  }, [profile, user, stravaRuns])

  // ── Confirm race plan transition: calibrate with actual fitness ─
  // Called when user clicks "Rennplan jetzt starten" in BuildPhaseToday.
  // Regenerates the plan using predicted pace from Strava/VO2max so intensity
  // reflects what the user is actually capable of after the build phase.
  const handleConfirmRacePlan = useCallback(async () => {
    setView('generating')
    setGenerateError('')
    const maxHR            = deriveMaxHR(stravaRuns)
    const vo2max           = calculateVO2max(stravaRuns, maxHR)
    const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
    try {
      const planData = await generateTrainingPlan(profile, { overridePaceSec: predictedPaceSec || null }, supabase)
      const { data, error } = await supabase.from('training_plans')
        .upsert({ user_id: user.id, plan_data: planData }, { onConflict: 'user_id' })
        .select().single()
      if (error) throw error
      setTrainingPlan(data)
      setCompletedWorkoutIds([])
      setView('app')
      setActiveTab('plan')
    } catch (err) {
      setGenerateError(err.message || 'Fehler beim Generieren des Rennplans.')
    }
  }, [profile, user, stravaRuns])

  // ── Delete plan ────────────────────────────────────────────────
  const handleDeletePlan = useCallback(async () => {
    await supabase.from('training_plans').delete().eq('user_id', user.id)
    await supabase.from('completed_workouts').delete().eq('user_id', user.id)
    setTrainingPlan(null)
    setCompletedWorkoutIds([])
    setView('generating')
    setGenerateError('')
  }, [user])

  // ── Sign out ───────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  // ── Render ─────────────────────────────────────────────────────
  if (view === 'loading') return <LoadingScreen message="Loading…" />
  if (view === 'auth') return <Auth />
  if (view === 'onboarding') return <Onboarding user={user} onComplete={handleOnboardingComplete} />
  if (view === 'generating') return (
    <GeneratingPlan error={generateError} onRetry={retryGenerate} />
  )

  // Main app
  const isNonRaceMode = profile?.training_mode && profile.training_mode !== 'race'
  if (view === 'app' && profile && (trainingPlan || isNonRaceMode)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'today' && (
            <TodayTab
              user={user}
              profile={profile}
              trainingPlan={trainingPlan}
              completedWorkoutIds={completedWorkoutIds}
              onToggleComplete={handleToggleComplete}
              workoutLogs={allWorkoutLogs}
              onLogAdded={handleLogAdded}
              onLogDeleted={handleLogDeleted}
              onLogUpdated={handleLogUpdated}
              stravaRuns={stravaRuns}
              onConfirmRacePlan={handleConfirmRacePlan}
              aiPlan={aiPlan}
              aiPlanGenerating={aiPlanGenerating}
              lastPlanChange={lastPlanChange}
              onPlanChangeDismiss={() => setLastPlanChange(null)}
              pendingStravaQueue={pendingStravaQueue}
              pendingPR={pendingPR}
              onPRDismiss={() => setPendingPR(null)}
              onShiftWorkout={handleShiftWorkout}
              onStravaFeedback={async (rpe, notes, paceFeedback) => {
                const current = pendingStravaQueue[0]
                if (!current) return
                // rpe=null means the user dismissed — just advance the queue, no DB write
                if (rpe != null) {
                  const { log } = current
                  const updateFields = { rpe, notes: notes || log.notes }
                  if (paceFeedback) updateFields.pace_feedback = paceFeedback
                  const { data: updated } = await supabase
                    .from('workout_logs').update(updateFields)
                    .eq('id', log.id).select().single()
                  if (updated) {
                    workoutLogsRef.current = workoutLogsRef.current.map(l => l.id === updated.id ? updated : l)
                    setWorkoutLogs(prev => prev.map(l => l.id === updated.id ? updated : l))
                    // Regenerate plan only after the last item in the queue
                    if (pendingStravaQueue.length <= 1) {
                      generateAIPlan(profile, workoutLogsRef.current, stravaRuns, supabase)
                        .then(plan => {
                          const enriched = { ...plan, lastChangeReason: 'Einheiten bewertet — Plan angepasst' }
                          setAiPlan(enriched); aiPlanRef.current = enriched
                          saveAiPlan(enriched, user.id)
                        }).catch(() => {})
                    }
                  }
                }
                // Advance the queue
                setPendingStravaQueue(q => q.slice(1))
              }}
            />
          )}
          {activeTab === 'plan' && (
            <PlanTab
              profile={profile}
              trainingPlan={trainingPlan}
              completedWorkoutIds={completedWorkoutIds}
              onToggleComplete={handleToggleComplete}
              workoutLogs={allWorkoutLogs}
              stravaRuns={stravaRuns}
              onTabChange={setActiveTab}
              onProfileUpdate={handleProfileUpdate}
              onLogAdded={handleLogAdded}
              aiPlan={aiPlan}
            />
          )}
          {activeTab === 'coach' && (
            <CoachTab
              user={user}
              profile={profile}
              trainingPlan={trainingPlan}
              workoutLogs={allWorkoutLogs}
              chatMessages={chatMessages}
              onMessagesUpdate={handleMessagesUpdate}
              aiPlan={aiPlan}
              stravaRuns={stravaRuns}
            />
          )}
          {activeTab === 'fitness' && (
            <FitnessTab
              user={user}
              profile={profile}
              onProfileUpdate={handleProfileUpdate}
              onRunsUpdate={handleRunsUpdate}
              workoutLogs={allWorkoutLogs}
            />
          )}
          {activeTab === 'stats' && (
            <StatsTab
              user={user}
              profile={profile}
              workoutLogs={allWorkoutLogs}
              stravaRuns={stravaRuns}
              trainingPlan={trainingPlan}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab
              user={user}
              profile={profile}
              trainingPlan={trainingPlan}
              workoutLogs={allWorkoutLogs}
              completedWorkoutIds={completedWorkoutIds}
              stravaRuns={stravaRuns}
              stravaError={stravaError}
              onStravaErrorDismiss={() => setStravaError(null)}
              onProfileUpdate={handleProfileUpdate}
              onSignOut={handleSignOut}
              onRegeneratePlan={handleRegeneratePlan}
              onDeletePlan={handleDeletePlan}
            />
          )}
        </div>
        <PWAInstallBanner />
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} trainingMode={profile.training_mode} />
      </div>
    )
  }

  // Edge case: race mode but no plan (e.g. plan generation failed on first load)
  if (view === 'app' && profile && !trainingPlan && !isNonRaceMode) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-5)', padding: 'var(--sp-8)', background: 'var(--c-bg)' }}>
        <div style={{ fontSize: '2.5rem' }}>📋</div>
        <h2>No training plan found</h2>
        <p style={{ textAlign: 'center', color: 'var(--c-text-2)' }}>
          Something went wrong loading your plan. Let's generate a new one.
        </p>
        <button
          className="btn btn-primary btn-lg"
          style={{ maxWidth: 300, width: '100%' }}
          onClick={() => {
            setView('generating')
            setGenerateError('')
            handleOnboardingComplete({
              level: profile.level,
              target_pace_min: profile.target_pace_min,
              target_pace_sec: profile.target_pace_sec,
              cross_training_sports: profile.cross_training_sports,
              training_days: profile.training_days,
              marathon_date: profile.marathon_date,
              marathon_name: profile.marathon_name,
              context: profile.context,
            })
          }}
        >
          Generate Training Plan
        </button>
      </div>
    )
  }

  return <LoadingScreen />
}
