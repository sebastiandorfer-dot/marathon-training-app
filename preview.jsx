import { useState } from "react"

const colors = {
  bg: "#0a0e1a",
  surface: "#111827",
  card: "#151d2e",
  cardHover: "#1a2438",
  border: "#1e2a3d",
  borderLight: "#253350",
  primary: "#1D9E75",
  primaryDark: "#158a63",
  primaryDim: "rgba(29,158,117,0.15)",
  text: "#e8edf5",
  text2: "#9ba8be",
  text3: "#5c6a82",
  easy: "#4a9eff",
  easyDim: "rgba(74,158,255,0.15)",
  tempo: "#ff8c42",
  tempoDim: "rgba(255,140,66,0.15)",
  long: "#c77dff",
  longDim: "rgba(199,125,255,0.15)",
  interval: "#ff5252",
  recovery: "#78909c",
  cross: "#26c6da",
}

const s = {
  app: {
    width: 390, height: 780, borderRadius: 40, overflow: "hidden",
    background: colors.bg, color: colors.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif",
    display: "flex", flexDirection: "column", position: "relative",
    boxShadow: "0 40px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.07)",
  },
  header: {
    background: colors.bg, borderBottom: `1px solid ${colors.border}`,
    padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
  },
  scroll: { flex: 1, overflowY: "auto", overscrollBehavior: "contain" },
  content: { padding: "20px 16px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 600, margin: "0 auto", width: "100%" },
  card: {
    background: colors.card, border: `1px solid ${colors.border}`,
    borderRadius: 16, padding: 20,
  },
  tabBar: {
    display: "flex", background: colors.surface, borderTop: `1px solid ${colors.border}`,
    flexShrink: 0,
  },
  tabBtn: (active) => ({
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3, padding: "8px 4px 12px", border: "none", background: "transparent",
    color: active ? colors.primary : colors.text3, cursor: "pointer", transition: "color 0.15s",
    minHeight: 60, fontFamily: "inherit",
  }),
  tabLabel: { fontSize: 11, fontWeight: 600, letterSpacing: "0.02em" },
}

// ── Today Tab ──────────────────────────────────────────────────
function TodayTab() {
  const [logOpen, setLogOpen] = useState(false)
  const [isDone, setIsDone] = useState(false)

  return (
    <>
      <div style={s.header}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 18, color: colors.text }}>Monday, April 20</div>
          <div style={{ fontSize: 13, color: colors.text2, marginTop: 2 }}>Training Week 8 of 18</div>
        </div>
        <div style={{
          background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12,
          padding: "8px 12px", textAlign: "center",
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>63</div>
          <div style={{ fontSize: 11, color: colors.text3, fontWeight: 600, lineHeight: 1.2 }}>days to<br/>race</div>
        </div>
      </div>

      <div style={s.scroll}>
        <div style={s.content}>
          {/* Hero workout card */}
          <div style={{
            background: `linear-gradient(135deg, ${colors.card} 0%, ${colors.cardHover} 100%)`,
            border: `1px solid ${colors.easy}`, borderRadius: 20, padding: 24, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", background: colors.easyDim, pointerEvents: "none" }} />
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: colors.easy, marginBottom: 12 }}>
              Today's Workout
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: colors.easy, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Easy Run</div>
                <div style={{ fontWeight: 600, fontSize: 20, marginBottom: 12, color: colors.text }}>Recovery Easy Run</div>
                <div style={{ fontSize: 14, color: colors.text2, lineHeight: 1.55, marginBottom: 16 }}>
                  Keep a comfortable, conversational pace. Focus on form and easy breathing. This run builds your aerobic base.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
              {[["12", "km"], ["1h 15m", "duration"], ["5:30/km", "target pace"]].map(([val, label]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                  <div style={{ fontSize: 12, color: colors.text3 }}>{label}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setIsDone(d => !d)}
              style={{
                width: "100%", padding: 12, borderRadius: 12, cursor: "pointer", fontWeight: 600, fontSize: 15,
                border: `1.5px solid ${isDone ? colors.primary : colors.borderLight}`,
                background: isDone ? colors.primary : "transparent",
                color: isDone ? "#fff" : colors.text2,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                fontFamily: "inherit", transition: "all 0.2s",
              }}
            >
              {isDone ? "✓ Completed" : "✓ Mark Complete"}
            </button>
          </div>

          {/* Log Workout card */}
          <div style={s.card}>
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
              onClick={() => setLogOpen(o => !o)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12, background: colors.primaryDim,
                  border: `1px solid ${colors.primary}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                }}>✏️</div>
                <div>
                  <div style={{ fontWeight: 600, color: colors.text }}>Log a Workout</div>
                  <div style={{ fontSize: 13, color: colors.text2 }}>Record today's training</div>
                </div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transition: "transform 0.2s", transform: logOpen ? "rotate(180deg)" : "none" }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </div>
            {logOpen && (
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                {[["Workout Type", "select"], ["Distance (km)", "number"], ["Duration (min)", "number"]].map(([label, type]) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, fontWeight: 500, color: colors.text2 }}>{label}</label>
                    {type === "select" ? (
                      <select style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.text, fontSize: 15, padding: "12px 16px", outline: "none", width: "100%", fontFamily: "inherit" }}>
                        <option>Easy Run</option><option>Tempo Run</option><option>Interval</option><option>Long Run</option>
                      </select>
                    ) : (
                      <input type={type} placeholder={label === "Distance (km)" ? "12.0" : "75"} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, color: colors.text, fontSize: 15, padding: "12px 16px", outline: "none", width: "100%", fontFamily: "inherit" }} />
                    )}
                  </div>
                ))}
                <button style={{ background: colors.primary, color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontWeight: 600, fontSize: 16, cursor: "pointer", width: "100%", fontFamily: "inherit" }}>
                  Save Workout
                </button>
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, color: colors.text, marginBottom: 12 }}>Recent Activity</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { type: "Long Run", icon: "🛣️", color: colors.long, dim: colors.longDim, dist: "32 km", dur: "3h 12m", when: "Yesterday" },
                { type: "Tempo Run", icon: "⚡", color: colors.tempo, dim: colors.tempoDim, dist: "10 km", dur: "47m", when: "3d ago" },
                { type: "Easy Run", icon: "🏃", color: colors.easy, dim: colors.easyDim, dist: "8 km", dur: "48m", when: "4d ago" },
              ].map((log) => (
                <div key={log.type + log.when} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: log.dim, border: `1px solid ${log.color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                    {log.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: colors.text }}>{log.type}</div>
                    <div style={{ fontSize: 13, color: colors.text2 }}>{log.dist} · {log.dur}</div>
                  </div>
                  <div style={{ fontSize: 12, color: colors.text3, flexShrink: 0 }}>{log.when}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Plan Tab ───────────────────────────────────────────────────
function PlanTab() {
  const [week, setWeek] = useState(8)
  const weeks = {
    8: [
      { day: "Mon", type: "easy", color: colors.easy, title: "Recovery Easy Run", km: 12, done: true },
      { day: "Tue", type: "rest", color: colors.text3, title: "Rest Day", km: null, done: false },
      { day: "Wed", type: "tempo", color: colors.tempo, title: "Tempo Run", km: 10, done: false },
      { day: "Thu", type: "easy", color: colors.easy, title: "Easy Run", km: 8, done: false },
      { day: "Fri", type: "rest", color: colors.text3, title: "Rest Day", km: null, done: false },
      { day: "Sat", type: "interval", color: colors.interval, title: "Track Intervals", km: 12, done: false },
      { day: "Sun", type: "long", color: colors.long, title: "Long Run", km: 29, done: false },
    ],
  }
  const days = weeks[8]

  return (
    <>
      <div style={s.header}>
        <button onClick={() => setWeek(w => Math.max(1, w - 1))} style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${colors.border}`, background: colors.card, color: colors.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: colors.text }}>Week {week}</div>
          <div style={{ fontSize: 13, color: colors.text2 }}>of 18</div>
        </div>
        <button onClick={() => setWeek(w => Math.min(18, w + 1))} style={{ width: 36, height: 36, borderRadius: "50%", border: `1px solid ${colors.border}`, background: colors.card, color: colors.text2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      {/* Progress bar */}
      <div style={{ height: 3, background: colors.border, flexShrink: 0 }}>
        <div style={{ height: "100%", width: `${(week / 18) * 100}%`, background: colors.primary, transition: "width 0.4s ease" }} />
      </div>
      <div style={s.scroll}>
        <div style={s.content}>
          {/* Weekly summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {[["71 km", "Total"], ["1 / 7", "Done"], ["Sun", "Long Run"]].map(([val, label]) => (
              <div key={label} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>{val}</div>
                <div style={{ fontSize: 12, color: colors.text3, marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {days.map((d) => (
            <div key={d.day} style={{
              background: colors.card, border: `1px solid ${d.done ? colors.primary : colors.border}`,
              borderRadius: 12, padding: 14, display: "flex", gap: 12, alignItems: "center",
              opacity: d.done ? 0.6 : 1,
            }}>
              <div style={{ width: 36, flexShrink: 0, textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.text3, textTransform: "uppercase" }}>{d.day}</div>
              </div>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
                {d.km && <div style={{ fontSize: 12, color: colors.text2, marginTop: 2 }}>{d.km} km</div>}
              </div>
              {d.done && (
                <div style={{ width: 22, height: 22, borderRadius: 6, background: colors.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Coach Tab ──────────────────────────────────────────────────
function CoachTab() {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi Sebastian! 👋 I'm your AI marathon coach. I've reviewed your Week 8 plan. How are you feeling after yesterday's long run?" },
    { role: "user", text: "Legs feel a bit tired but I finished the 32 km. Pace was around 5:40/km." },
    { role: "assistant", text: "That's a great effort! 5:40/km for 32 km in Week 8 is solid. The fatigue is totally normal — that's your body adapting. Today's easy run at 5:30/km will help flush out lactic acid. Keep it truly easy, even if that means slowing to 6:00/km. How did your sleep look last night?" },
  ])

  function send() {
    if (!input.trim()) return
    setMessages(m => [...m, { role: "user", text: input }])
    setInput("")
    setTimeout(() => {
      setMessages(m => [...m, { role: "assistant", text: "Great question! Based on your current training load and the fact that you're in Week 8, I'd recommend keeping your easy runs truly easy. Your target pace for today's recovery run should be around 5:45–6:00/km. Listen to your body! 💪" }])
    }, 1000)
  }

  return (
    <>
      <div style={s.header}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 18, color: colors.text }}>AI Coach</div>
          <div style={{ fontSize: 13, color: colors.primary, marginTop: 2 }}>● Online</div>
        </div>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: colors.primaryDim, border: `1px solid ${colors.primary}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
      </div>
      <div style={{ ...s.scroll, padding: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "85%", padding: "12px 16px", borderRadius: 16, fontSize: 15, lineHeight: 1.55,
                background: m.role === "user" ? colors.primary : colors.card,
                color: m.role === "user" ? "#fff" : colors.text,
                border: m.role === "assistant" ? `1px solid ${colors.border}` : "none",
                borderBottomRightRadius: m.role === "user" ? 4 : 16,
                borderBottomLeftRadius: m.role === "assistant" ? 4 : 16,
              }}>{m.text}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 16px", borderTop: `1px solid ${colors.border}`, background: colors.surface, display: "flex", gap: 10, flexShrink: 0 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask your coach…"
          style={{ flex: 1, background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 24, color: colors.text, fontSize: 15, padding: "10px 16px", outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={send} style={{ width: 42, height: 42, borderRadius: "50%", background: colors.primary, border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </>
  )
}

// ── Profile Tab ────────────────────────────────────────────────
function ProfileTab() {
  return (
    <>
      <div style={s.header}>
        <div style={{ fontWeight: 600, fontSize: 18, color: colors.text }}>Profil</div>
        <button style={{ background: "transparent", border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 12px", color: colors.text2, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
          Bearbeiten
        </button>
      </div>
      <div style={s.scroll}>
        <div style={s.content}>
          {/* Avatar */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: colors.primaryDim, border: `2px solid ${colors.primary}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36 }}>🏃</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 20, color: colors.text, textAlign: "center" }}>Sebastian</div>
              <div style={{ fontSize: 14, color: colors.primary, textAlign: "center" }}>Intermediate Runner</div>
            </div>
          </div>

          {/* Marathon */}
          <div style={{ ...s.card, background: `linear-gradient(135deg, ${colors.card} 0%, ${colors.cardHover} 100%)`, borderColor: colors.primary }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: colors.primary, marginBottom: 8 }}>🎯 Zielrennen</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: colors.text }}>Vienna City Marathon 2026</div>
            <div style={{ fontSize: 14, color: colors.text2, marginTop: 4 }}>22. Juni 2026 · Zielpace: 5:30/km</div>
          </div>

          {/* Stats */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12, color: colors.text }}>Trainingsstatistiken</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["247 km", "Gesamt km"], ["32", "Trainings"], ["5:42/km", "Ø Pace"], ["63", "Tage bis Rennen"]].map(([val, label]) => (
                <div key={label} style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>{val}</div>
                  <div style={{ fontSize: 12, color: colors.text3, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Settings */}
          <div style={s.card}>
            <div style={{ fontWeight: 600, fontSize: 15, color: colors.text, marginBottom: 16 }}>Einstellungen</div>
            {["Trainingstage anpassen", "Plan neu generieren", "Benachrichtigungen"].map((item, i) => (
              <div key={item}>
                {i > 0 && <div style={{ height: 1, background: colors.border, margin: "12px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontSize: 14, color: colors.text }}>{item}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.text3} strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              </div>
            ))}
          </div>

          <button style={{ width: "100%", padding: "14px", borderRadius: 12, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444", fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
            Abmelden
          </button>
        </div>
      </div>
    </>
  )
}

// ── Tab Icons ──────────────────────────────────────────────────
const TabIcon = ({ id, active }) => {
  const icons = {
    today: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    plan: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    coach: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    profile: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  }
  return icons[id]
}

// ── Main ───────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("today")
  const tabs = [
    { id: "today", label: "Heute" },
    { id: "plan", label: "Plan" },
    { id: "coach", label: "Coach" },
    { id: "profile", label: "Profil" },
  ]

  return (
    <div style={{ minHeight: "100vh", background: "#060912", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={s.app}>
        {/* Status bar */}
        <div style={{ background: colors.bg, padding: "14px 24px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>9:41</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <svg width="16" height="12" viewBox="0 0 24 18" fill={colors.text}><rect x="0" y="6" width="4" height="12" rx="1"/><rect x="6" y="3" width="4" height="15" rx="1"/><rect x="12" y="0" width="4" height="18" rx="1"/><rect x="18" y="0" width="4" height="18" rx="1" opacity="0.3"/></svg>
            <svg width="16" height="12" viewBox="0 0 24 18" fill={colors.text}><path d="M12 4C7.5 4 3.5 6 0.5 9.5l3 2.5C5.5 9 8.5 7 12 7s6.5 2 8.5 5l3-2.5C20.5 6 16.5 4 12 4z"/><path d="M12 10c-2.5 0-4.5 1-6 2.5l3 2.5c.8-.8 1.8-1.3 3-1.3s2.2.5 3 1.3l3-2.5c-1.5-1.5-3.5-2.5-6-2.5z"/><circle cx="12" cy="16" r="2"/></svg>
            <div style={{ width: 24, height: 12, borderRadius: 3, border: `1.5px solid ${colors.text}`, display: "flex", alignItems: "center", padding: 2, gap: 1 }}>
              <div style={{ flex: "0 0 16px", height: "100%", background: colors.primary, borderRadius: 1 }} />
              <div style={{ width: 2, height: 6, background: colors.text, borderRadius: 1, marginLeft: 1 }} />
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {tab === "today" && <TodayTab />}
          {tab === "plan" && <PlanTab />}
          {tab === "coach" && <CoachTab />}
          {tab === "profile" && <ProfileTab />}
        </div>

        {/* Tab bar */}
        <nav style={s.tabBar}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={s.tabBtn(tab === t.id)}>
              <TabIcon id={t.id} active={tab === t.id} />
              <span style={s.tabLabel}>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
