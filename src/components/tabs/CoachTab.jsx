import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatPace, getCurrentPlanPosition, daysUntilMarathon } from '../../utils/planUtils'
import {
  deriveMaxHR, calculateVO2max, predictMarathonPaceFromVO2max,
  formatPaceSec, formatMarathonTime, vo2maxCategory, weeklyMileageStats,
} from '../../utils/fitnessUtils'

export default function CoachTab({ user, profile, trainingPlan, workoutLogs, chatMessages, onMessagesUpdate }) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [stravaRuns, setStravaRuns] = useState([])
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, streamingText])

  // Load Strava runs for fitness context
  useEffect(() => {
    supabase.from('strava_runs').select('*').eq('user_id', user.id)
      .order('start_date', { ascending: false })
      .then(({ data }) => { if (data) setStravaRuns(data) })
  }, [user.id])

  function buildSystemPrompt() {
    const trainingMode = profile.training_mode || 'race'
    const hasMarathon = !!profile.marathon_date
    const pos = hasMarathon ? getCurrentPlanPosition(profile.marathon_date) : { status: 'active', week: 1, totalWeeks: 0 }
    const daysLeft = hasMarathon ? daysUntilMarathon(profile.marathon_date) : null
    const pace = profile.target_pace_min != null ? formatPace(profile.target_pace_min, profile.target_pace_sec) : null

    // Fitness data from Strava
    const maxHR = deriveMaxHR(stravaRuns)
    const vo2max = calculateVO2max(stravaRuns, maxHR)
    const predictedPaceSec = predictMarathonPaceFromVO2max(vo2max)
    const category = vo2max ? vo2maxCategory(vo2max) : null
    const mileage = weeklyMileageStats(stravaRuns)

    let fitnessSection = ''
    if (stravaRuns.length > 0) {
      fitnessSection = `
FITNESS-DATEN (aus Strava, ${stravaRuns.length} Läufe analysiert):
- VO2max (geschätzt): ${vo2max ? Math.round(vo2max) + ' ml/kg/min (' + category?.label + ')' : 'nicht genug HR-Daten'}
- Maximale Herzfrequenz: ${maxHR ? maxHR + ' bpm' : 'nicht verfügbar'}
- Vorhergesagte Marathonzeit: ${predictedPaceSec ? formatMarathonTime(predictedPaceSec) + ' (' + formatPaceSec(predictedPaceSec) + '/km)' : 'nicht berechenbar'}
- Wochenkilometer Ø (letzte 4 Wochen): ${mileage.last4avg} km
- Wochenkilometer Ø gesamt: ${mileage.avg} km
- Peak-Woche: ${mileage.peak} km
- Letzte Läufe: ${stravaRuns.slice(0, 5).map(r => {
    const km = Math.round(r.distance / 100) / 10
    const pace = r.average_speed ? Math.round(1000 / r.average_speed) : null
    const hr = r.average_heartrate ? Math.round(r.average_heartrate) : null
    return `${new Date(r.start_date).toLocaleDateString('de-AT', { day: 'numeric', month: 'short' })}: ${km}km${pace ? ' @' + Math.floor(pace/60) + ':' + String(pace%60).padStart(2,'0') + '/km' : ''}${hr ? ' ♥' + hr + 'bpm' : ''}`
  }).join(', ')}`
    } else {
      fitnessSection = `\nFITNESS-DATEN: Noch keine Strava-Läufe synchronisiert.`
    }

    // Recent logs summary
    const recentLogs = [...workoutLogs]
      .sort((a, b) => new Date(b.workout_date) - new Date(a.workout_date))
      .slice(0, 10)
      .map(l => `  - ${l.workout_date}: ${l.workout_type}${l.distance_km ? `, ${l.distance_km}km` : ''}${l.duration_min ? `, ${l.duration_min}min` : ''}${l.notes ? ` (${l.notes})` : ''}`)
      .join('\n')

    // Current week plan
    let currentWeekSummary = ''
    if (trainingPlan?.plan_data?.weeks && pos.status === 'active') {
      const week = trainingPlan.plan_data.weeks.find(w => w.week === pos.week)
      if (week) {
        currentWeekSummary = `\nAktuelle Woche ${pos.week} — "${week.theme}" (${week.total_km ?? '?'} km gesamt):\n` +
          (week.workouts || []).map(w =>
            `  - ${['Mo','Di','Mi','Do','Fr','Sa','So'][w.day_of_week]}: ${w.title} (${w.type})${w.distance_km ? `, ${w.distance_km}km` : ''}${w.duration_min ? `, ${w.duration_min}min` : ''}`
          ).join('\n')
      }
    }

    const modeLabel = trainingMode === 'fitness' ? 'Fitness-Modus (kein Zielrennen)' : trainingMode === 'tracking' ? 'Tracking-Modus (eigener Plan)' : 'Marathon-Modus'

    return `Du bist ein erfahrener Lauftrainer-KI. Du kennst den Athleten sehr gut und hast Zugriff auf alle seine Trainingsdaten. Antworte immer auf Deutsch, direkt und motivierend.

ATHLETENPROFIL:
- Trainingsmodus: ${modeLabel}
- Erfahrungsstufe: ${profile.level || 'nicht angegeben'}
${pace ? `- Ziel-Lauftempo: ${pace} min/km` : ''}
- Trainingstage: ${(profile.training_days || []).map(d => ['Mo','Di','Mi','Do','Fr','Sa','So'][d]).join(', ') || 'nicht angegeben'}
- Cross-Training: ${profile.cross_training_sports?.join(', ') || 'keines'}
${hasMarathon ? `- Marathon: "${profile.marathon_name}" — ${new Date(profile.marathon_date).toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Tage bis zum Marathon: ${daysLeft}
- Trainingsstatus: ${pos.status === 'active' ? `Woche ${pos.week} von ${pos.totalWeeks}` : pos.status === 'not_started' ? 'Plan noch nicht gestartet' : 'Plan abgeschlossen'}` : ''}
${trainingMode === 'fitness' && profile.target_weekly_km ? `- Wochenziel: ${profile.target_weekly_km} km/Woche` : ''}
- Persönliche Notizen: ${profile.context || 'keine'}
${currentWeekSummary}
${fitnessSection}

LETZTE TRAININGSEINHEITEN (aus App):
${recentLogs || 'Noch keine Einheiten eingetragen'}

COACHING-RICHTLINIEN:
- Antworte immer auf Deutsch
- Sei direkt, konkret und motivierend — verwende echte Daten aus dem Profil
- Gib umsetzbare Ratschläge basierend auf dem tatsächlichen Plan und Fortschritt
- Beziehe VO2max und Strava-Daten ein wenn relevant
- Berücksichtige immer Verletzungsprävention und Erholung
- Halte Antworten fokussiert, aber ausführlich wenn nötig
- Nutze Markdown für Struktur (fett für Schlüsselpunkte, Listen für Schritte)`
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError('')

    const userMsg = { id: `tmp-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }
    const updatedMessages = [...chatMessages, userMsg]
    onMessagesUpdate(updatedMessages)

    try {
      const { data: savedUser } = await supabase.from('chat_messages').insert({
        user_id: user.id, role: 'user', content: text,
      }).select().single()
      if (savedUser) {
        onMessagesUpdate(prev => prev.map(m => m.id === userMsg.id ? savedUser : m))
      }
    } catch { /* non-blocking */ }

    const historyMessages = updatedMessages.slice(-20).map(m => ({
      role: m.role, content: m.content,
    }))

    setStreaming(true)
    setStreamingText('')

    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) {
      setError('Anthropic API Key fehlt.')
      setStreaming(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          system: buildSystemPrompt(),
          messages: historyMessages,
          stream: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData?.error?.message || `API Fehler ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                fullText += parsed.delta.text
                setStreamingText(fullText)
              }
            } catch { /* ignore */ }
          }
        }
      }

      setStreamingText('')
      const assistantMsg = { id: `tmp-a-${Date.now()}`, role: 'assistant', content: fullText, created_at: new Date().toISOString() }
      onMessagesUpdate(prev => [...prev, assistantMsg])

      try {
        const { data: savedAssistant } = await supabase.from('chat_messages').insert({
          user_id: user.id, role: 'assistant', content: fullText,
        }).select().single()
        if (savedAssistant) {
          onMessagesUpdate(prev => prev.map(m => m.id === assistantMsg.id ? savedAssistant : m))
        }
      } catch { /* non-blocking */ }

    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Antwort vom Coach konnte nicht geladen werden.')
        setStreamingText('')
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  async function clearHistory() {
    if (!confirm('Chat-Verlauf löschen?')) return
    await supabase.from('chat_messages').delete().eq('user_id', user.id)
    onMessagesUpdate([])
  }

  const showStreaming = streaming && streamingText

  return (
    <div className="screen">
      <div className="screen-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 'var(--r-full)',
            background: 'var(--c-primary-dim)', border: '2px solid var(--c-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
            flexShrink: 0,
          }}>🤖</div>
          <div>
            <h2 style={{ fontSize: '1rem' }}>KI-Coach</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--c-text-3)', marginTop: 1 }}>
              {streaming
                ? <span style={{ color: 'var(--c-primary)' }}>Schreibt…</span>
                : stravaRuns.length > 0
                  ? `${stravaRuns.length} Läufe analysiert`
                  : 'Stell mir alles über dein Training'}
            </p>
          </div>
        </div>
        {chatMessages.length > 0 && (
          <button className="btn-icon" onClick={clearHistory} title="Chat löschen">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        )}
      </div>

      <div className="screen-scroll" style={{ padding: 'var(--sp-4)' }}>
        {chatMessages.length === 0 && !showStreaming ? (
          <div style={{ padding: 'var(--sp-8) var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--sp-4)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 'var(--sp-3)' }}>🤖</div>
              <h3>Dein KI-Marathoncoach</h3>
              <p style={{ fontSize: '0.875rem', marginTop: 'var(--sp-2)', color: 'var(--c-text-2)' }}>
                Ich kenne deinen Trainingsplan, deine Läufe und deine Fitness. Frag mich alles.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {[
                'Wie läuft mein Training gerade?',
                'Was soll ich diese Woche beachten?',
                'Wie laufe ich meinen langen Lauf richtig?',
                'Ich bin müde — soll ich das Training heute auslassen?',
                'Was ist mein realistisches Marathonziel?',
                'Wie vermeide ich einen Einbruch beim Marathon?',
              ].map(p => (
                <button
                  key={p}
                  onClick={() => { setInput(p); inputRef.current?.focus() }}
                  style={{
                    background: 'var(--c-card)', border: '1px solid var(--c-border)',
                    borderRadius: 'var(--r-md)', padding: 'var(--sp-3) var(--sp-4)',
                    color: 'var(--c-text-2)', cursor: 'pointer', textAlign: 'left',
                    fontSize: '0.875rem', fontFamily: 'var(--font)', transition: 'all 0.15s',
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = 'var(--c-primary)'}
                  onMouseOut={e => e.currentTarget.style.borderColor = 'var(--c-border)'}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', padding: '0 0 var(--sp-2)' }}>
            {chatMessages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'assistant' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: 'var(--r-full)',
                    background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.875rem', flexShrink: 0, marginRight: 'var(--sp-2)', marginTop: 4,
                  }}>🤖</div>
                )}
                <div className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}>
                  <MarkdownText text={msg.content} isUser={msg.role === 'user'} />
                </div>
              </div>
            ))}

            {showStreaming && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 'var(--r-full)',
                  background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.875rem', flexShrink: 0, marginRight: 'var(--sp-2)', marginTop: 4,
                }}>🤖</div>
                <div className="chat-bubble chat-bubble-assistant">
                  <MarkdownText text={streamingText} isUser={false} />
                  <span style={{
                    display: 'inline-block', width: 6, height: 14,
                    background: 'var(--c-primary)', marginLeft: 2,
                    animation: 'blink 1s step-end infinite',
                    borderRadius: 1, verticalAlign: 'text-bottom',
                  }} />
                </div>
              </div>
            )}

            {streaming && !streamingText && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 'var(--r-full)',
                  background: 'var(--c-primary-dim)', border: '1px solid var(--c-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.875rem', flexShrink: 0, marginRight: 'var(--sp-2)',
                }}>🤖</div>
                <div className="chat-bubble chat-bubble-assistant" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '12px 16px' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: 7, height: 7, borderRadius: '50%', background: 'var(--c-primary)',
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ margin: 'var(--sp-3) 0' }}>
            <span>⚠</span> {error}
          </div>
        )}
      </div>

      <div style={{
        padding: 'var(--sp-3) var(--sp-4)',
        borderTop: '1px solid var(--c-border)',
        background: 'var(--c-bg)', flexShrink: 0,
        paddingBottom: 'max(var(--sp-3), env(safe-area-inset-bottom, 0px))',
      }}>
        <div style={{
          display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end',
          background: 'var(--c-card)', border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          padding: 'var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4)',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Frag deinen Coach…"
            rows={1}
            disabled={streaming}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--c-text)', fontSize: '0.9375rem', fontFamily: 'var(--font)',
              resize: 'none', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
              padding: 'var(--sp-2) 0',
            }}
            onInput={e => {
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={streaming ? () => abortRef.current?.abort() : sendMessage}
            disabled={!streaming && !input.trim()}
            style={{
              width: 36, height: 36, borderRadius: 'var(--r-md)',
              background: streaming ? 'var(--c-error-dim)' : input.trim() ? 'var(--c-primary)' : 'var(--c-border)',
              border: 'none', cursor: streaming || input.trim() ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'background 0.15s',
            }}
          >
            {streaming ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--c-error)' }}>
                <rect x="6" y="6" width="12" height="12" rx="1"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            )}
          </button>
        </div>
        <p style={{ fontSize: '0.6875rem', color: 'var(--c-text-3)', textAlign: 'center', marginTop: 6 }}>
          Enter zum Senden · Shift+Enter für neue Zeile
        </p>
      </div>

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; } 40% { transform: scale(1.2); opacity: 1; } }
      `}</style>
    </div>
  )
}

function MarkdownText({ text, isUser }) {
  if (!text) return null
  if (isUser) return <span>{text}</span>
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, fontSize: '0.9375rem', marginTop: i > 0 ? 8 : 0 }}>{renderInline(line.slice(4))}</div>
        if (line.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, fontSize: '1rem', marginTop: i > 0 ? 10 : 0 }}>{renderInline(line.slice(3))}</div>
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 4, paddingLeft: 4 }}>
              <span style={{ color: 'var(--c-primary)', flexShrink: 0, marginTop: 2 }}>•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          )
        }
        const numMatch = line.match(/^(\d+)\.\s+(.*)/)
        if (numMatch) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 4, paddingLeft: 4 }}>
              <span style={{ color: 'var(--c-primary)', flexShrink: 0, fontWeight: 600, minWidth: 18 }}>{numMatch[1]}.</span>
              <span>{renderInline(numMatch[2])}</span>
            </div>
          )
        }
        if (line.trim() === '') return <div key={i} style={{ height: 8 }} />
        return <span key={i}>{renderInline(line)}<br/></span>
      })}
    </>
  )
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 700, color: 'var(--c-text)' }}>{part.slice(2, -2)}</strong>
    }
    return <span key={i}>{part}</span>
  })
}
