/**
 * Quick check-ins — the tiny, intentional "chat". Five fixed presets only:
 * no free text means zero moderation surface and zero distraction rabbit hole.
 */
export const QUICK_MESSAGES = [
  { key: 'are-you-there', text: 'Are you there? 👀' },
  { key: 'still-studying', text: 'Still studying? 🙂' },
  { key: 'take-a-break', text: 'Take a short break ☕' },
  { key: 'you-got-this', text: 'You’ve got this! 💪' },
  { key: 'nice-focus', text: 'Nice focus today 🔥' }
] as const

/** One note per sender → classmate so check-ins never become spam. */
export const MESSAGE_RATE_LIMIT_MS = 45_000

export function isQuickMessage(text: string): boolean {
  return QUICK_MESSAGES.some((m) => m.text === text)
}
