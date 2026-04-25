import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { generateTrainingPlan, getTotalPlanWeeks } from './utils/planUtils'
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
import { exchangeStravaCode, getValidToken, fetchAllStravaRuns } from './utils/stravaUtils'

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

  // AI-generated adaptive plan
  const [aiPlan, setAiPlan] = useState(null)
  const [aiPlanGenerating, setAiPlanGenerating] = useState(false)
  const [lastPlanChange, setLastPlanChange] = useState(null) // reason shown as toast
  const aiPlanRef = useRef(null)       // mirrors aiPlan, avoids stale closures
  const workoutLogsRef = useRef([])    // mirrors workoutLogs, for AI check after upsert
  const [pendingStravaFeedback, setPendingStravaFeedback] = useState(null) // {log, run} awaiting RPE

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
      if (logsRes.data) { setWorkoutLogs(logsRes.data); workoutLogsRef.current = logsRes.data }
      if (chatRes.data) setChatMessages(chatRes.data)
      if (runsRes.data) setStravaRuns(runsRes.data)

      // Generate initial AI plan in the background (non-blocking)
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
      const logs = logsRes.data || []
      const runs = runsRes.data || []
      if (apiKey && activeProfile) {
        const { should } = shouldRegeneratePlan(null, logs, null, activeProfile)
        if (should) {
          setAiPlanGenerating(true)
          generateAIPlan(activeProfile, logs, runs, apiKey)
            .then(plan => {
              const enriched = { ...plan, lastChangeReason: null } // initial plan — no prior change
              setAiPlan(enriched)
              aiPlanRef.current = enriched
            })
            .catch(err => console.warn('Initial AI plan failed:', err))
            .finally(() => setAiPlanGenerating(false))
        }
      }

      setView('app')
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

        const planData = await generateTrainingPlan(savedProfile)
        const { data: savedPlan, error: planError } = await supabase
          .from('training_plans')
          .upsert({ user_id: user.id, plan_data: planData }, { onConflict: 'user_id' })
          .select()
          .single()
        if (planError) throw planError
        setTrainingPlan(savedPlan)

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
      const planData = await generateTrainingPlan(profile)
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
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) return

    // Guard against concurrent generation — second call would overwrite first with stale context
    if (aiPlanRef.current?._generating) return

    const { should, reason } = shouldRegeneratePlan(newLog, updatedLogs, aiPlanRef.current, profile)
    if (should) {
      aiPlanRef.current = { ...aiPlanRef.current, _generating: true }
      setAiPlanGenerating(true)
      generateAIPlan(profile, updatedLogs, stravaRuns, apiKey)
        .then(plan => {
          const enriched = { ...plan, lastChangeReason: reason }
          setAiPlan(enriched)
          aiPlanRef.current = enriched
          setLastPlanChange(reason) // trigger toast
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
        const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
        if (apiKey) {
          setAiPlanGenerating(true)
          generateAIPlan(updatedProfile, workoutLogsRef.current, stravaRuns, apiKey)
            .then(plan => {
              const enriched = { ...plan, lastChangeReason: 'Profil aktualisiert — Plan neu berechnet' }
              setAiPlan(enriched)
              aiPlanRef.current = enriched
              setLastPlanChange('Profil aktualisiert — Plan neu berechnet')
            })
            .catch(err => console.warn('AI plan regen after profile update failed:', err))
            .finally(() => setAiPlanGenerating(false))
        }
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

  // ── Update Strava runs + trigger AI plan regen with new data ──
  const handleRunsUpdate = useCallback((newRuns) => {
    setStravaRuns(newRuns)
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey || !profile) return
    // Regenerate AI plan with newly synced Strava data
    setAiPlanGenerating(true)
    generateAIPlan(profile, workoutLogsRef.current, newRuns, apiKey)
      .then(plan => {
        const enriched = { ...plan, lastChangeReason: 'Strava synchronisiert — Plan aktualisiert' }
        setAiPlan(enriched)
        aiPlanRef.current = enriched
        setLastPlanChange('Neue Strava-Daten — Plan angepasst')
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
      if (!token) return
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
      const existingStravaIds = new Set(
        workoutLogsRef.current.map(l => l.notes).filter(Boolean)
          .map(n => { const m = n.match(/strava:(\d+)/); return m ? m[1] : null })
          .filter(Boolean)
      )
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000 // only last 7 days
      const newRuns = runs.filter(r =>
        new Date(r.start_date).getTime() > cutoff &&
        !existingStravaIds.has(String(r.id))
      )
      let newestLog = null
      for (const r of newRuns) {
        const dateStr = r.start_date.slice(0, 10)
        const distKm  = r.distance / 1000
        const durMin  = Math.round(r.moving_time / 60)
        const paceSecKm = distKm > 0 ? r.moving_time / distKm : null
        // Guess workout type from pace
        let wType = 'easy'
        if (paceSecKm && paceSecKm < 270) wType = 'interval'
        else if (paceSecKm && paceSecKm < 310) wType = 'tempo'
        else if (distKm >= 18) wType = 'long'
        const { data: inserted } = await supabase.from('workout_logs').insert({
          user_id: currentProfile.id,
          workout_date: dateStr,
          workout_type: wType,
          distance_km: parseFloat(distKm.toFixed(2)),
          duration_min: durMin,
          notes: `strava:${r.id}`,  // sentinel for dedup
          rpe: null,
        }).select().single()
        if (inserted) {
          workoutLogsRef.current = [inserted, ...workoutLogsRef.current]
          setWorkoutLogs(prev => [inserted, ...prev])
          if (!newestLog || new Date(r.start_date) > new Date(newestLog.run.start_date)) {
            newestLog = { log: inserted, run: r }
          }
        }
      }
      if (newestLog) setPendingStravaFeedback(newestLog)
      setStravaRuns(merged)
      const now = new Date().toISOString()
      await supabase.from('profiles').update({ strava_last_sync: now }).eq('id', currentProfile.id)
      setProfile(p => p ? { ...p, strava_last_sync: now } : p)
      // Trigger AI plan regen with fresh data
      const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
      if (apiKey) {
        generateAIPlan(currentProfile, workoutLogsRef.current, merged, apiKey)
          .then(plan => {
            const enriched = { ...plan, lastChangeReason: 'Strava synchronisiert — Plan aktualisiert' }
            setAiPlan(enriched)
            aiPlanRef.current = enriched
          })
          .catch(() => {})
      }
    } catch (err) {
      console.warn('Auto Strava sync failed:', err)
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
      if (document.visibilityState === 'visible') performStravaSync(profile)
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
    generateTrainingPlan(profile, { overridePaceSec: predictedPaceSec || null })
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
      const planData = await generateTrainingPlan(profile, { overridePaceSec: predictedPaceSec || null })
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
              workoutLogs={workoutLogs}
              onLogAdded={handleLogAdded}
              onLogDeleted={handleLogDeleted}
              stravaRuns={stravaRuns}
              onConfirmRacePlan={handleConfirmRacePlan}
              aiPlan={aiPlan}
              aiPlanGenerating={aiPlanGenerating}
              lastPlanChange={lastPlanChange}
              onPlanChangeDismiss={() => setLastPlanChange(null)}
              pendingStravaFeedback={pendingStravaFeedback}
              onStravaFeedback={async (rpe, notes) => {
                if (!pendingStravaFeedback) return
                const { log } = pendingStravaFeedback
                const { data: updated } = await supabase
                  .from('workout_logs').update({ rpe, notes: notes || log.notes })
                  .eq('id', log.id).select().single()
                if (updated) {
                  workoutLogsRef.current = workoutLogsRef.current.map(l => l.id === updated.id ? updated : l)
                  setWorkoutLogs(prev => prev.map(l => l.id === updated.id ? updated : l))
                  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
                  if (apiKey && profile) {
                    generateAIPlan(profile, workoutLogsRef.current, stravaRuns, apiKey)
                      .then(plan => {
                        const enriched = { ...plan, lastChangeReason: 'Einheit bewertet — Plan angepasst' }
                        setAiPlan(enriched); aiPlanRef.current = enriched
                      }).catch(() => {})
                  }
                }
                setPendingStravaFeedback(null)
              }}
            />
          )}
          {activeTab === 'plan' && (
            <PlanTab
              profile={profile}
              trainingPlan={trainingPlan}
              completedWorkoutIds={completedWorkoutIds}
              onToggleComplete={handleToggleComplete}
              workoutLogs={workoutLogs}
              stravaRuns={stravaRuns}
              onTabChange={setActiveTab}
              onProfileUpdate={handleProfileUpdate}
            />
          )}
          {activeTab === 'coach' && (
            <CoachTab
              user={user}
              profile={profile}
              trainingPlan={trainingPlan}
              workoutLogs={workoutLogs}
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
              workoutLogs={workoutLogs}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab
              user={user}
              profile={profile}
              trainingPlan={trainingPlan}
              workoutLogs={workoutLogs}
              completedWorkoutIds={completedWorkoutIds}
              stravaRuns={stravaRuns}
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
