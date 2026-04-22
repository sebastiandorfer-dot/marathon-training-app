import { useEffect, useState } from 'react'

const MESSAGES = [
  'Analysing your athlete profile…',
  'Calculating weekly mileage progression…',
  'Designing your long run schedule…',
  'Adding tempo and interval sessions…',
  'Building your taper plan…',
  'Personalising workout descriptions…',
  'Finalising your 18-week plan…',
]

export default function GeneratingPlan({ error, onRetry }) {
  const [msgIdx, setMsgIdx] = useState(0)
  const [dots, setDots] = useState(1)

  useEffect(() => {
    if (error) return
    const msgTimer = setInterval(() => {
      setMsgIdx(i => (i + 1) % MESSAGES.length)
    }, 2800)
    const dotsTimer = setInterval(() => {
      setDots(d => d === 3 ? 1 : d + 1)
    }, 500)
    return () => { clearInterval(msgTimer); clearInterval(dotsTimer) }
  }, [error])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--c-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--sp-8)',
      gap: 'var(--sp-8)',
    }}>
      {/* Animated ring */}
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--c-border)" strokeWidth="6" />
          <circle
            cx="60" cy="60" r="50"
            fill="none"
            stroke="var(--c-primary)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 50}`}
            strokeDashoffset={`${2 * Math.PI * 50 * 0.25}`}
            style={{ animation: 'spin 1.4s linear infinite' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2.5rem',
        }}>
          🏃
        </div>
      </div>

      <div style={{ textAlign: 'center', maxWidth: 300 }}>
        <h2 style={{ marginBottom: 'var(--sp-3)', fontSize: '1.375rem' }}>
          {error ? 'Something went wrong' : 'Building your plan'}
        </h2>
        {error ? (
          <>
            <p style={{ color: 'var(--c-error)', marginBottom: 'var(--sp-6)', fontSize: '0.875rem' }}>{error}</p>
            <button className="btn btn-primary" onClick={onRetry}>Try Again</button>
          </>
        ) : (
          <p style={{ color: 'var(--c-text-2)', minHeight: '3em', fontSize: '0.9375rem' }}>
            {MESSAGES[msgIdx]}{'.'.repeat(dots)}
          </p>
        )}
      </div>

      {!error && (
        <p style={{ color: 'var(--c-text-3)', fontSize: '0.8125rem', textAlign: 'center', maxWidth: 260 }}>
          Claude is crafting a personalised 18-week marathon plan. This takes about 30–60 seconds.
        </p>
      )}
    </div>
  )
}
