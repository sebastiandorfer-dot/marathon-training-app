import { useState, useEffect } from 'react'

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showBanner, setShowBanner] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    // Already installed as PWA — don't show
    if (window.matchMedia('(display-mode: standalone)').matches) return
    // User already dismissed this session
    if (sessionStorage.getItem('pwa-dismissed')) return

    // iOS Safari: no beforeinstallprompt, show manual hint
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    if (ios && safari) {
      setIsIOS(true)
      setTimeout(() => setShowBanner(true), 3000) // delay so app loads first
      return
    }

    // Android / Chrome: listen for native install prompt
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowBanner(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setShowBanner(false)
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    sessionStorage.setItem('pwa-dismissed', '1')
    setShowBanner(false)
  }

  if (!showBanner) return null

  return (
    <div style={{
      position: 'fixed', bottom: 76, left: 12, right: 12, zIndex: 999,
      background: 'var(--c-card)', border: '1px solid var(--c-primary)',
      borderRadius: 16, padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'slideUp 0.3s ease',
    }}>
      <div style={{ fontSize: 26, flexShrink: 0 }}>📱</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--c-text)' }}>App installieren</div>
        <div style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 2, lineHeight: 1.4 }}>
          {isIOS
            ? <>Tippe auf <strong style={{ color: 'var(--c-primary)' }}>Teilen ↑</strong> → "Zum Home-Bildschirm"</>
            : 'Zum Homescreen hinzufügen für schnelleren Zugriff'}
        </div>
      </div>
      {!isIOS && deferredPrompt && (
        <button
          onClick={handleInstall}
          style={{
            background: 'var(--c-primary)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 14px', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0,
          }}
        >
          Installieren
        </button>
      )}
      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent', border: 'none', color: 'var(--c-text-3)',
          cursor: 'pointer', fontSize: 20, padding: '2px 4px', flexShrink: 0,
          lineHeight: 1,
        }}
      >×</button>
      <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  )
}
