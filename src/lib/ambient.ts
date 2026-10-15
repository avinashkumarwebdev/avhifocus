/**
 * Optional quiet ambience — soft generated rain (no audio assets to download).
 * Created only from an explicit user gesture; never autoplays.
 * Browsers suspend/resume AudioContext with tab visibility automatically.
 */

let ctx: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let gain: GainNode | null = null

function makeNoiseBuffer(audio: AudioContext): AudioBuffer {
  const length = audio.sampleRate * 3
  const buffer = audio.createBuffer(1, length, audio.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i++) {
    // brown-ish noise → gentle rain
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.2
  }
  return buffer
}

export function startAmbient(): boolean {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    stopAmbient()
    source = ctx.createBufferSource()
    source.buffer = makeNoiseBuffer(ctx)
    source.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    gain = ctx.createGain()
    gain.gain.value = 0
    source.connect(filter).connect(gain).connect(ctx.destination)
    source.start()
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 1.6)
    return true
  } catch {
    return false
  }
}

/** Presence-pulse chime: two soft notes + gentle haptic where supported. */
let chimeCtx: AudioContext | null = null

export function playPulseChime(): void {
  try {
    if (!chimeCtx) chimeCtx = new AudioContext()
    if (chimeCtx.state === 'suspended') void chimeCtx.resume()
    const now = chimeCtx.currentTime
    ;[0, 0.22].forEach((offset, i) => {
      const osc = (chimeCtx as AudioContext).createOscillator()
      const g = (chimeCtx as AudioContext).createGain()
      osc.type = 'sine'
      osc.frequency.value = i === 0 ? 784 : 988
      g.gain.setValueAtTime(0, now + offset)
      g.gain.linearRampToValueAtTime(0.12, now + offset + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5)
      osc.connect(g).connect((chimeCtx as AudioContext).destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.55)
    })
  } catch {
    /* audio blocked — the modal is still visible */
  }
  try {
    navigator.vibrate?.([80, 40, 80])
  } catch {
    /* unsupported */
  }
}

export function stopAmbient(): void {
  try {
    if (gain && ctx) gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4)
    const s = source
    if (s) {
      window.setTimeout(() => {
        try {
          s.stop()
        } catch {
          /* already stopped */
        }
      }, 500)
    }
  } finally {
    source = null
    gain = null
  }
}
