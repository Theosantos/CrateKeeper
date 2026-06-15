import { spawn } from 'node:child_process'

/**
 * Waveform peak extraction in the MAIN process via ffmpeg.
 *
 * Decoding audio in the renderer (Web Audio `decodeAudioData` of full tracks)
 * crashed the renderer process natively under repeated track changes. Instead
 * we decode here: ffmpeg downsamples the file to mono low-rate PCM (so we move
 * a few hundred KB, not the whole song), and we reduce that to a small set of
 * normalized amplitude bars. The renderer only ever receives ~hundreds of
 * floats — no audio decoding, no large buffers, no native crash surface.
 */

// Low analysis sample rate: enough to capture the energy envelope (breaks vs
// drops) while keeping the PCM tiny. 2 kHz mono → ~4 KB/sec.
const ANALYSIS_SAMPLE_RATE = 2000

export interface ExtractWaveformOpts {
  ffmpegPath: string
  filePath: string
  bars: number
  /** Injected for tests; defaults to child_process.spawn. */
  spawnFn?: typeof spawn
  /** Hard cap to avoid unbounded memory if ffmpeg misbehaves (bytes). */
  maxBytes?: number
}

export interface ExtractWaveformResult {
  peaks: number[]
  durationSec: number | null
}

/**
 * Reduce signed-16-bit mono PCM to `bars` normalized (0..1) max-abs peaks.
 */
export function pcmToPeaks(pcm: Buffer, bars: number): number[] {
  const sampleCount = Math.floor(pcm.length / 2)
  if (bars <= 0 || sampleCount === 0) return []
  const block = Math.max(1, Math.floor(sampleCount / bars))
  const peaks = new Array<number>(bars).fill(0)
  let max = 0
  for (let b = 0; b < bars; b++) {
    const start = b * block
    const end = Math.min(start + block, sampleCount)
    let peak = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(pcm.readInt16LE(i * 2))
      if (v > peak) peak = v
    }
    peaks[b] = peak
    if (peak > max) max = peak
  }
  if (max > 0) {
    for (let b = 0; b < bars; b++) peaks[b] /= max
  }
  return peaks
}

/**
 * Spawn ffmpeg to decode `filePath` to low-rate mono s16le PCM on stdout,
 * collect it, and reduce to normalized peaks. Resolves with empty peaks (never
 * rejects) on ffmpeg failure so the renderer degrades gracefully.
 */
export function extractWaveform(
  opts: ExtractWaveformOpts
): Promise<ExtractWaveformResult> {
  const spawnFn = opts.spawnFn ?? spawn
  const bars = Math.max(1, Math.floor(opts.bars))
  const maxBytes = opts.maxBytes ?? 64 * 1024 * 1024 // 64 MB hard ceiling

  return new Promise((resolve) => {
    const args = [
      '-v',
      'error',
      '-i',
      opts.filePath,
      '-ac',
      '1',
      '-ar',
      String(ANALYSIS_SAMPLE_RATE),
      '-f',
      's16le',
      '-'
    ]

    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(opts.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      resolve({ peaks: [], durationSec: null })
      return
    }

    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    let stderr = ''

    const finish = (result: ExtractWaveformResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        child.kill('SIGKILL')
        return
      }
      chunks.push(chunk)
    })

    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    child.on('error', () => finish({ peaks: [], durationSec: null }))

    child.on('close', () => {
      const pcm = Buffer.concat(chunks)
      const peaks = pcmToPeaks(pcm, bars)
      const samples = Math.floor(pcm.length / 2)
      const durationSec =
        samples > 0 ? samples / ANALYSIS_SAMPLE_RATE : parseDurationFromStderr(stderr)
      finish({ peaks, durationSec })
    })
  })
}

/** Best-effort parse of an ffmpeg "Duration: HH:MM:SS.xx" line (fallback). */
function parseDurationFromStderr(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  if (m === null) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
