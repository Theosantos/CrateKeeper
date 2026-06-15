import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { pcmToPeaks, extractWaveform } from './waveform'

/** Build a Buffer of s16le samples from an array of signed 16-bit ints. */
function s16le(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => buf.writeInt16LE(v, i * 2))
  return buf
}

describe('pcmToPeaks', () => {
  it('returns [] for empty PCM', () => {
    expect(pcmToPeaks(Buffer.alloc(0), 10)).toEqual([])
  })

  it('returns [] when bars <= 0', () => {
    expect(pcmToPeaks(s16le([1, 2, 3]), 0)).toEqual([])
  })

  it('normalizes peaks to 0..1 with the loudest bar at 1', () => {
    // 4 samples, 2 bars → bar0 = max(|100|,|200|)=200, bar1 = max(|50|,|25|)=50
    const peaks = pcmToPeaks(s16le([100, 200, 50, 25]), 2)
    expect(peaks).toHaveLength(2)
    expect(peaks[0]).toBeCloseTo(1) // 200/200
    expect(peaks[1]).toBeCloseTo(0.25) // 50/200
  })

  it('uses absolute value (negative samples count)', () => {
    const peaks = pcmToPeaks(s16le([-300, 10]), 1)
    expect(peaks[0]).toBeCloseTo(1) // |−300| dominates
  })
})

/** Minimal fake child process for extractWaveform's spawn injection. */
function fakeChild(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = (): void => {}
  return child
}

describe('extractWaveform', () => {
  it('reduces ffmpeg PCM stdout to normalized peaks', async () => {
    const child = fakeChild()
    const spawnFn = (() => child) as unknown as typeof import('node:child_process').spawn

    const promise = extractWaveform({
      ffmpegPath: '/x/ffmpeg',
      filePath: '/Music/a.mp3',
      bars: 2,
      spawnFn
    })

    // Emit PCM then close.
    child.stdout.emit('data', s16le([100, 200, 50, 25]))
    child.emit('close', 0)

    const res = await promise
    expect(res.peaks).toHaveLength(2)
    expect(res.peaks[0]).toBeCloseTo(1)
    // 2000 Hz analysis rate, 4 mono samples → 4/2000 s duration.
    expect(res.durationSec).toBeCloseTo(4 / 2000)
  })

  it('resolves empty (never rejects) when ffmpeg errors', async () => {
    const child = fakeChild()
    const spawnFn = (() => child) as unknown as typeof import('node:child_process').spawn
    const promise = extractWaveform({
      ffmpegPath: '/x/ffmpeg',
      filePath: '/Music/a.mp3',
      bars: 10,
      spawnFn
    })
    child.emit('error', new Error('ENOENT'))
    const res = await promise
    expect(res).toEqual({ peaks: [], durationSec: null })
  })

  it('resolves empty when spawn itself throws', async () => {
    const spawnFn = (() => {
      throw new Error('spawn failed')
    }) as unknown as typeof import('node:child_process').spawn
    const res = await extractWaveform({
      ffmpegPath: '/x/ffmpeg',
      filePath: '/Music/a.mp3',
      bars: 10,
      spawnFn
    })
    expect(res).toEqual({ peaks: [], durationSec: null })
  })

  it('kills ffmpeg and still resolves when output exceeds maxBytes', async () => {
    const child = fakeChild()
    let killed = false
    child.kill = (): void => {
      killed = true
    }
    const spawnFn = (() => child) as unknown as typeof import('node:child_process').spawn
    const promise = extractWaveform({
      ffmpegPath: '/x/ffmpeg',
      filePath: '/Music/a.mp3',
      bars: 4,
      spawnFn,
      maxBytes: 4
    })
    child.stdout.emit('data', s16le([1, 2, 3, 4, 5])) // 10 bytes > 4
    child.emit('close', null)
    const res = await promise
    expect(killed).toBe(true)
    // Nothing was buffered past the cap, so peaks are empty.
    expect(res.peaks).toEqual([])
  })
})
