import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { enableAudio, playMessageSound, playSound, setSoundsEnabled, soundsEnabled } from './sounds.js'

const storage = new Map()
let audio
const tones = []
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
}
class TestAudioContext {
  constructor() { audio = this; this.state = 'running'; this.currentTime = 0; this.destination = {} }
  createGain() {
    return { gain: { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }
  }
  createOscillator() {
    const tone = { frequency: 0, start: 0 }
    return {
      frequency: { setValueAtTime(value) { tone.frequency = value } },
      connect() {}, disconnect() {}, stop() {},
      start(time) { tone.start = time; tones.push(tone) },
    }
  }
}
globalThis.window = { AudioContext: TestAudioContext }
beforeEach(() => {
  storage.clear()
  tones.length = 0
  if (audio) audio.state = 'closed'
  enableAudio()
})

test('each event has its own short melody', () => {
  assert.equal(playSound('notification'), true)
  assert.deepEqual(tones.map(tone => tone.frequency), [1046.5, 1318.5])
  tones.length = 0
  audio.currentTime = 1
  assert.equal(playSound('message'), true)
  assert.deepEqual(tones.map(tone => tone.frequency), [880, 1174.7])
  tones.length = 0
  audio.currentTime = 2
  assert.equal(playSound('success'), true)
  assert.deepEqual(tones.map(tone => tone.frequency), [523.3, 659.3, 784, 1046.5])
})

test('mute is stored and suppresses all sound types', () => {
  setSoundsEnabled(false)
  assert.equal(soundsEnabled(), false)
  assert.equal(storage.get('team_tasks_sounds_enabled'), 'off')
  for (const kind of ['notification', 'message', 'success']) assert.equal(playSound(kind), false)
  assert.equal(tones.length, 0)
})

test('message and notification timestamps deduplicate the same event', () => {
  assert.equal(playMessageSound(2, 1, '2026-10-14T10:00:00.123Z'), true)
  audio.currentTime = 1
  assert.equal(playMessageSound(2, 1, '2026-10-14T10:00:00.123+00:00'), false)
  assert.equal(tones.length, 2)
  assert.equal(playMessageSound(2, 1, '2026-10-14T10:00:01.123Z'), true)
})

test('bursts are coalesced and distinct sounds are scheduled in order', () => {
  assert.equal(playSound('notification', 'burst-a'), true)
  assert.equal(playSound('notification', 'burst-b'), false)
  assert.equal(playSound('message', 'burst-c'), true)
  assert.ok(tones[2].start >= tones[1].start + 0.42)
})

test('unsupported or suspended audio remains safe and quiet', () => {
  audio.state = 'suspended'
  assert.equal(playSound('notification'), false)
  assert.equal(tones.length, 0)
})
