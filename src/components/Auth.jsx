import { useState } from 'react'
import { supabase } from '../supabase'

export default function Auth() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (signUpError) throw signUpError
        setSuccessMsg('Account created! Check your email to confirm, then log in.')
        setMode('login')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
        // App.jsx will react to auth state change
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--sp-5)',
      background: 'var(--c-bg)',
    }}>
      {/* Logo / Header */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--sp-8)' }} className="fade-up">
        <div style={{
          width: 72, height: 72,
          borderRadius: 'var(--r-xl)',
          background: 'var(--c-primary-dim)',
          border: '2px solid var(--c-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2rem',
          margin: '0 auto var(--sp-5)',
        }}>
          🏃
        </div>
        <h1 style={{ fontSize: '1.625rem', marginBottom: 'var(--sp-2)' }}>Marathon AI Coach</h1>
        <p style={{ color: 'var(--c-text-2)', fontSize: '0.9375rem' }}>
          Your personal AI-powered training companion
        </p>
      </div>

      {/* Card */}
      <div className="card fade-up" style={{ width: '100%', maxWidth: 420 }}>
        {/* Mode Toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--c-surface)',
          borderRadius: 'var(--r-md)',
          padding: '3px',
          marginBottom: 'var(--sp-6)',
        }}>
          {['login', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setSuccessMsg('') }}
              style={{
                flex: 1,
                padding: 'var(--sp-2)',
                borderRadius: 'calc(var(--r-md) - 2px)',
                border: 'none',
                background: mode === m ? 'var(--c-card)' : 'transparent',
                color: mode === m ? 'var(--c-text)' : 'var(--c-text-3)',
                fontWeight: mode === m ? 600 : 400,
                fontSize: '0.9375rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
                fontFamily: 'var(--font)',
              }}
            >
              {m === 'login' ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="off"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Your password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              disabled={loading}
            />
          </div>

          {error && (
            <div className="alert alert-error">
              <span>⚠</span> {error}
            </div>
          )}
          {successMsg && (
            <div className="alert alert-success">
              <span>✓</span> {successMsg}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            style={{ marginTop: 'var(--sp-2)' }}
          >
            {loading ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              {mode === 'signup' ? 'Creating account…' : 'Logging in…'}</>
            ) : (
              mode === 'signup' ? 'Create Account' : 'Log In'
            )}
          </button>
        </form>
      </div>

      <p style={{ marginTop: 'var(--sp-6)', color: 'var(--c-text-3)', fontSize: '0.8125rem', textAlign: 'center' }}>
        By continuing, you agree to train hard and rest well.
      </p>
    </div>
  )
}
