import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { generateTrainingPlan, getTotalPlanWeeks } from './utils/planUtils'
import { deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max } from './utils/fitnessUtils'

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
import { exchangeStravaCode } from './utils/stravaUtils'

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

      setProfile(profileData)

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
      if (logsRes.data) setWorkoutLogs(logsRes.data)
      if (chatRes.data) setChatMessages(chatRes.data)
      if (runsRes.data) setStravaRuns(runsRes.data)

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
  // Called both when a new log is created AND when an existing log is
  // updated (e.g. RPE added via the post-log modal). We upsert by ID
  // so an RPE update doesn't create a duplicate entry in state.
  const handleLogAdded = useCallback((newLog) => {
    setWorkoutLogs(prev => {
      const idx = prev.findIndex(l => l.id === newLog.id)
      if (idx >= 0) {
        // Replace the existing entry in-place
        const updated = [...prev]
        updated[idx] = newLog
        return updated
      }
      // New log — prepend and keep sorted desc by date
      return [newLog, ...prev]
    })
  }, [])

  // ── Delete workout log ─────────────────────────────────────────
  const handleLogDeleted = useCallback(async (logId) => {
    setWorkoutLogs(prev => prev.filter(l => l.id !== logId))
    try {
      await supabase.from('workout_logs').delete().eq('id', logId).eq('user_id', user.id)
    } catch (err) {
      console.error('Failed to delete log:', err)
      // Reload logs on failure
      const { data } = await supabase.from('workout_logs').select('*').eq('user_id', user.id).order('workout_date', { ascending: false })
      if (data) setWorkoutLogs(data)
    }
  }, [user])

  // ── Update profile ─────────────────────────────────────────────
  const handleProfileUpdate = useCallback((updatedProfile) => {
    setProfile(updatedProfile)
  }, [])

  // ── Update chat messages ───────────────────────────────────────
  const handleMessagesUpdate = useCallback((updaterOrMessages) => {
    setChatMessages(prev =>
      typeof updaterOrMessages === 'function'
        ? updaterOrMessages(prev)
        : updaterOrMessages
    )
  }, [])

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
            />
          )}
          {activeTab === 'fitness' && (
            <FitnessTab
              user={user}
              profile={profile}
              onProfileUpdate={handleProfileUpdate}
              onRunsUpdate={setStravaRuns}
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
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
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
