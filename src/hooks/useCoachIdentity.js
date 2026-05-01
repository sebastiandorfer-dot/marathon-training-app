export function useCoachIdentity(user) {
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name || ''
  const firstName = fullName.split(' ')[0] || 'Seb'
  const coachName = `Coach ${firstName}`
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '/coach-avatar.gif'
  return { coachName, firstName, avatarUrl }
}
