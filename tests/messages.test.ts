import { describe, expect, it, beforeEach } from 'vitest'
import { LocalBackend } from '../src/services/backend/local'
import { memoryStorage, TestChannelHub, type StorageLike } from '../src/services/backend/localStore'
import { randomAvatar } from '../src/lib/avatars'
import { QUICK_MESSAGES, MESSAGE_RATE_LIMIT_MS } from '../src/lib/quickMessages'
import type { Identity, RoomEvent } from '../src/types'

function makeIdentity(n: number): Identity {
  return { id: `student-${n}`, displayName: `Student ${n}`, classLabel: 'Class 10', avatar: randomAvatar(() => 0.4) }
}

function makeWorld() {
  const storage: StorageLike = memoryStorage()
  const hub = new TestChannelHub()
  let now = 1_000_000_000_000
  const mk = () =>
    new LocalBackend({
      storage,
      channel: hub.makeChannel(),
      now: () => now,
      random: () => 0.5
    })
  return {
    a: mk(),
    b: mk(),
    advance(ms: number) {
      now += ms
    }
  }
}

describe('Quick check-in notes (preset messages)', () => {
  let w: ReturnType<typeof makeWorld>
  let roomId: string
  let arjun: Identity
  let meena: Identity

  beforeEach(async () => {
    w = makeWorld()
    arjun = makeIdentity(1)
    meena = makeIdentity(2)
    const room = await w.a.createClassroom({ name: 'Notes Hall' }, arjun)
    await w.a.joinClassroom({ code: room.joinCode }, arjun)
    await w.b.joinClassroom({ code: room.joinCode }, meena)
    roomId = room.id
  })

  it('delivers a preset note to the target classmate across “tabs”', async () => {
    const events: RoomEvent[] = []
    const stop = w.b.subscribeRoom(roomId, (e) => events.push(e))
    await w.a.sendMessage(roomId, arjun, meena.id, QUICK_MESSAGES[0].text)
    stop()
    const msg = events.find((e) => e.kind === 'message')
    expect(msg).toBeDefined()
    expect(msg).toMatchObject({
      kind: 'message',
      targetStudentId: meena.id,
      text: QUICK_MESSAGES[0].text
    })
    if (msg?.kind === 'message') {
      expect(msg.by.studentId).toBe(arjun.id)
      expect(msg.by.displayName).toBe(arjun.displayName)
    }
  })

  it('enforces the sender→classmate rate limit', async () => {
    await w.a.sendMessage(roomId, arjun, meena.id, QUICK_MESSAGES[1].text)
    await expect(w.a.sendMessage(roomId, arjun, meena.id, QUICK_MESSAGES[2].text)).rejects.toThrow(/moment/i)

    // after the cooldown window, the next note goes through
    w.advance(MESSAGE_RATE_LIMIT_MS + 1000)
    await expect(w.a.sendMessage(roomId, arjun, meena.id, QUICK_MESSAGES[2].text)).resolves.toBeUndefined()
  })

  it('rejects free text, self-notes, and non-members', async () => {
    await expect(w.a.sendMessage(roomId, arjun, meena.id, 'long custom essay about stuff')).rejects.toThrow(/preset/i)
    await expect(w.a.sendMessage(roomId, arjun, arjun.id, QUICK_MESSAGES[0].text)).rejects.toThrow(/yourself/i)
    const outsider = makeIdentity(9)
    await expect(w.a.sendMessage(roomId, arjun, outsider.id, QUICK_MESSAGES[0].text)).rejects.toThrow()
  })

  it('notes are ephemeral — never stored anywhere', async () => {
    await w.a.sendMessage(roomId, arjun, meena.id, QUICK_MESSAGES[3].text)
    const state = await w.b.getRoomState(roomId, meena)
    // no message content leaks into durable state
    expect(JSON.stringify(state)).not.toContain(QUICK_MESSAGES[3].text)
  })
})
