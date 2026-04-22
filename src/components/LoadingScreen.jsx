export default function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--c-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--sp-5)',
    }}>
      <div style={{ fontSize: '2rem' }}>🏃</div>
      <div className="spinner spinner-lg" />
      <p style={{ color: 'var(--c-text-3)', fontSize: '0.875rem' }}>{message}</p>
    </div>
  )
}
