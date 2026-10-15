// Small shared bits for page chrome.
export const chevronLeft = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3L5 8l5 5" />
  </svg>
)

export function friendlyJoinError(message: string): string {
  if (message.includes('full') || message.includes('ROOM_FULL'))
    return 'That classroom is full (10 seats). Try again when a seat frees up.'
  if (message.includes('not be found') || message.includes('No classroom'))
    return 'No classroom uses that code — double-check and try again.'
  if (message.includes('no longer active')) return 'This classroom is no longer active.'
  return message
}
