/**
 * Sounds for the chat's "team at work" view, synthesised with Web Audio (no audio files).
 *
 *   woof()   Dan says hello when the chat opens
 *   pew()    Dan (the concierge) hands a task to a teammate
 *   thunk()  a teammate's report lands back
 *   tick()   someone looks something up in the database
 *   chime()  the answer is ready
 *
 * Browsers only allow sound after a user gesture, so `unlockSound()` is called
 * from the Send handler. Muting is remembered per browser.
 */

const MUTE_KEY = 'cc-chat-sound-muted'

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null
let muted = readMuted()
const lastPlayed: Record<string, number> = {}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    // Storage blocked (private window): the choice just won't be remembered.
  }
}

function audio(): AudioContext | null {
  const AC =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx ??= new AC()
  return ctx
}

/** Call from a click / keypress so later sounds are allowed to play. */
export async function unlockSound(): Promise<void> {
  try {
    const context = audio()
    if (context?.state === 'suspended') await context.resume()
  } catch {
    // Autoplay quirks: stay silent.
  }
}

/** A context ready to play into, or null when muted / not yet allowed / too soon after the same cue. */
function ready(cue: string, minGapMs: number): AudioContext | null {
  if (muted) return null
  const context = audio()
  if (!context || context.state !== 'running') return null
  const now = performance.now()
  if (now - (lastPlayed[cue] ?? -Infinity) < minGapMs) return null
  lastPlayed[cue] = now
  return context
}

function envelope(context: AudioContext, start: number, peak: number, length: number): GainNode {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  gain.connect(context.destination)
  return gain
}

function whiteNoise(context: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== context.sampleRate) {
    noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.4), context.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
  }
  return noise
}

/** "Pew": a fast downward laser sweep through a tracking band-pass. */
export function pew(): void {
  const context = ready('pew', 60)
  if (!context) return
  const t = context.currentTime + 0.005
  const out = envelope(context, t, 0.12, 0.18)
  const band = context.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = 4
  band.frequency.setValueAtTime(2600, t)
  band.frequency.exponentialRampToValueAtTime(500, t + 0.15)
  band.connect(out)
  const osc = context.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(2300, t)
  osc.frequency.exponentialRampToValueAtTime(360, t + 0.15)
  osc.connect(band)
  osc.start(t)
  osc.stop(t + 0.2)
}

/** "Thunk": a short noise crack over a low thump, for a report landing. Softer when `light`. */
export function thunk(light = false): void {
  const context = ready('thunk', 70)
  if (!context) return
  const t = context.currentTime + 0.005
  const src = context.createBufferSource()
  src.buffer = whiteNoise(context)
  const low = context.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(4200, t)
  low.frequency.exponentialRampToValueAtTime(300, t + 0.18)
  src.connect(low)
  low.connect(envelope(context, t, light ? 0.05 : 0.11, 0.2))
  src.start(t)
  src.stop(t + 0.24)
  const body = context.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(160, t)
  body.frequency.exponentialRampToValueAtTime(55, t + 0.16)
  body.connect(envelope(context, t, light ? 0.07 : 0.15, 0.22))
  body.start(t)
  body.stop(t + 0.24)
}

/** "Tick": a tiny bright blip for a database lookup. */
export function tick(): void {
  const context = ready('tick', 45)
  if (!context) return
  const t = context.currentTime + 0.005
  const osc = context.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1500, t)
  osc.frequency.exponentialRampToValueAtTime(2200, t + 0.05)
  osc.connect(envelope(context, t, 0.05, 0.08))
  osc.start(t)
  osc.stop(t + 0.1)
}

/** "Chime": a quick rising arpeggio when the answer is ready. */
export function chime(): void {
  const context = ready('chime', 300)
  if (!context) return
  const t = context.currentTime + 0.01
  ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = context.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    osc.connect(envelope(context, t + i * 0.07, 0.08, 0.3))
    osc.start(t + i * 0.07)
    osc.stop(t + i * 0.07 + 0.32)
  })
}

/** "Woof woof": two short barks (a falling, growly sawtooth through a vocal-ish formant, plus breath). */
export function woof(): void {
  const context = ready('woof', 800)
  if (!context) return
  const start = context.currentTime + 0.01
  ;[0, 0.22].forEach((offset, i) => {
    const t = start + offset
    const out = envelope(context, t, i === 0 ? 0.16 : 0.13, 0.17)
    const formant = context.createBiquadFilter()
    formant.type = 'bandpass'
    formant.Q.value = 1.6
    formant.frequency.setValueAtTime(1100, t)
    formant.frequency.exponentialRampToValueAtTime(600, t + 0.14)
    formant.connect(out)
    const voice = context.createOscillator()
    voice.type = 'sawtooth'
    voice.frequency.setValueAtTime(i === 0 ? 430 : 470, t)
    voice.frequency.exponentialRampToValueAtTime(170, t + 0.14)
    voice.connect(formant)
    voice.start(t)
    voice.stop(t + 0.18)
    const breath = context.createBufferSource()
    breath.buffer = whiteNoise(context)
    const airy = context.createBiquadFilter()
    airy.type = 'bandpass'
    airy.frequency.value = 1500
    airy.Q.value = 0.8
    breath.connect(airy)
    airy.connect(envelope(context, t, 0.05, 0.1))
    breath.start(t)
    breath.stop(t + 0.12)
  })
}
