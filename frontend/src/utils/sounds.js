const preferenceKey = 'team_tasks_sounds_enabled'
let context
let master
let nextStart = 0
const played = new Set()
const lastPlayed = new Map()

export function soundsEnabled() {
  try { return localStorage.getItem(preferenceKey) !== 'off' } catch { return true }
}

export function setSoundsEnabled(enabled) {
  try { localStorage.setItem(preferenceKey, enabled ? 'on' : 'off') } catch { /* Storage can be unavailable in private browsing. */ }
  if (master) master.gain.setTargetAtTime(enabled ? 1 : 0, context.currentTime, 0.02)
}

export function enableAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    if (!context || context.state === 'closed') {
      context = new AudioContext()
      master = context.createGain()
      master.gain.value = soundsEnabled() ? 1 : 0
      master.connect(context.destination)
      nextStart = 0
      lastPlayed.clear()
    }
    if (context.state === 'suspended') context.resume().catch(() => {})
  } catch { /* Sound support must never interrupt the task workflow. */ }
}

const melodies = {
  notification: [[1046.5, 0, 0.42], [1318.5, 0.19, 0.42]],
  message: [[880, 0, 0.16], [1174.7, 0.14, 0.24]],
  success: [[523.3, 0, 0.13], [659.3, 0.1, 0.13], [784, 0.2, 0.13], [1046.5, 0.3, 0.28]],
}

export function playSound(kind, key) {
  if (key) {
    if (played.has(key)) return false
    played.add(key)
    if (played.size > 500) played.delete(played.values().next().value)
  }
  if (!soundsEnabled() || !melodies[kind] || context?.state !== 'running') return false
  const now = context.currentTime
  if (now - (lastPlayed.get(kind) ?? -Infinity) < 0.65) return false
  try {
    const start = Math.max(now + 0.02, Math.min(nextStart, now + 0.7))
    for (const [frequency, offset, duration] of melodies[kind]) {
      const tone = context.createOscillator()
      const volume = context.createGain()
      tone.type = 'sine'
      tone.frequency.setValueAtTime(frequency, start + offset)
      volume.gain.setValueAtTime(0.0001, start + offset)
      volume.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.015)
      volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration)
      tone.connect(volume)
      volume.connect(master)
      tone.onended = () => { tone.disconnect(); volume.disconnect() }
      tone.start(start + offset)
      tone.stop(start + offset + duration + 0.02)
    }
    nextStart = start + Math.max(...melodies[kind].map(([, offset, duration]) => offset + duration))
    lastPlayed.set(kind, now)
    return true
  } catch { return false }
}

export function playMessageSound(senderId, recipientId, createdAt) {
  return playSound('message', `message:${senderId}:${recipientId}:${Date.parse(createdAt)}`)
}
