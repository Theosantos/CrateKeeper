import { useEffect, useRef, useState } from 'react'

/**
 * SoundCloud-style waveform preview, served via the cratekeeper:// custom
 * protocol registered in Plan 04-01 (folder-allowlist + AUDIO_EXTS gated).
 *
 * Plan 04-03 post-checkpoint fix v4 — robust, dependency-free:
 *   - Playback runs on a plain <audio> element (the proven-working path).
 *     The Play button enables on `canplay` and autoplays; it is NEVER gated
 *     on the waveform being ready, so sound works even if peak decoding fails.
 *   - The waveform is drawn on a <canvas> from peaks we decode ourselves via
 *     Web Audio (fetch the bytes → decodeAudioData → max-abs per bar). Drops
 *     render as tall bars, breaks as short bars. Click the canvas to seek.
 *   - The two concerns are fully decoupled: a waveform-decode failure logs and
 *     leaves the canvas blank but does not break playback.
 *
 * Pitfall 6: AIFF is not reliably decodable by Chromium, so we short-circuit
 * with a French fallback.
 */
interface AudioPreviewProps {
  filePath: string
}

const BAR_WIDTH = 2
const BAR_GAP = 1
const WAVE_HEIGHT = 72

function isAiff(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.aiff') || lower.endsWith('.aif')
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v === '' ? fallback : v
}

/**
 * A single shared AudioContext for waveform decoding across the whole app.
 *
 * Creating a fresh AudioContext per track exhausts Chromium's hard cap (~6
 * concurrent contexts) after a handful of card changes — the constructor then
 * throws and crashes the React tree. decodeAudioData does not require a running
 * context, so one lazily-created, never-closed context is correct and safe.
 * Returns null if Web Audio is unavailable (e.g. jsdom) — callers no-op.
 */
let sharedAudioContext: AudioContext | null = null
let audioContextUnavailable = false

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext !== null) return sharedAudioContext
  if (audioContextUnavailable) return null
  const Ctx: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined
  if (Ctx === undefined) {
    audioContextUnavailable = true
    return null
  }
  try {
    sharedAudioContext = new Ctx()
    return sharedAudioContext
  } catch (err) {
    // Never let context creation crash the render.
    // eslint-disable-next-line no-console
    console.error('[tagger] could not create AudioContext', err)
    audioContextUnavailable = true
    return null
  }
}

/** Downsample mono PCM to `bars` normalized (0..1) max-abs peaks. */
function computePeaks(channel: Float32Array, bars: number): number[] {
  if (bars <= 0 || channel.length === 0) return []
  const block = Math.max(1, Math.floor(channel.length / bars))
  const peaks = new Array<number>(bars)
  let max = 0
  for (let i = 0; i < bars; i++) {
    const start = i * block
    const end = Math.min(start + block, channel.length)
    let peak = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j])
      if (v > peak) peak = v
    }
    peaks[i] = peak
    if (peak > max) max = peak
  }
  if (max > 0) {
    for (let i = 0; i < bars; i++) peaks[i] /= max
  }
  return peaks
}

export function AudioPreview({ filePath }: AudioPreviewProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const channelRef = useRef<Float32Array | null>(null)
  const peaksRef = useRef<number[]>([])
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [canPlay, setCanPlay] = useState(false)
  const src = 'cratekeeper://audio/' + encodeURIComponent(filePath)
  const aiff = isAiff(filePath)

  // ── Playback (proven <audio> path — independent of the waveform) ──────────
  useEffect(() => {
    const el = audioRef.current
    if (el === null || aiff) return
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setCanPlay(false)

    const onTime = (): void => setCurrentTime(el.currentTime)
    const onLoaded = (): void =>
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    const onCanPlay = (): void => {
      setCanPlay(true)
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[tagger] autoplay rejected — click Play', err)
        })
      }
    }
    const onPlay = (): void => setIsPlaying(true)
    const onPause = (): void => setIsPlaying(false)
    const onError = (): void => {
      // eslint-disable-next-line no-console
      console.error('[tagger] audio element error', {
        src: el.currentSrc || el.src,
        code: el.error?.code,
        message: el.error?.message
      })
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('durationchange', onLoaded)
    el.addEventListener('canplay', onCanPlay)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('error', onError)

    try {
      el.load()
    } catch {
      /* jsdom */
    }

    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('durationchange', onLoaded)
      el.removeEventListener('canplay', onCanPlay)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('error', onError)
      try {
        el.pause()
      } catch {
        /* ignore */
      }
    }
  }, [src, aiff])

  // ── Waveform decode (best-effort, never blocks playback) ──────────────────
  useEffect(() => {
    if (aiff || typeof fetch === 'undefined') return
    const ac = getSharedAudioContext()
    if (ac === null) return

    let cancelled = false
    channelRef.current = null
    peaksRef.current = []

    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => ac.decodeAudioData(buf))
      .then((audioBuf) => {
        if (cancelled) return
        channelRef.current = audioBuf.getChannelData(0)
        redrawWaveform()
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.error('[tagger] waveform decode failed (playback unaffected)', err)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, aiff])

  // Recompute peaks for the current canvas width, then paint.
  function redrawWaveform(): void {
    const canvas = canvasRef.current
    const channel = channelRef.current
    if (canvas === null) return
    const cssW = canvas.clientWidth
    if (channel !== null && cssW > 0) {
      const bars = Math.max(1, Math.floor(cssW / (BAR_WIDTH + BAR_GAP)))
      if (peaksRef.current.length !== bars) {
        peaksRef.current = computePeaks(channel, bars)
      }
    }
    paint()
  }

  // Paint the bars + progress overlay onto the canvas.
  function paint(): void {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = WAVE_HEIGHT
    if (cssW === 0) return
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)
    const peaks = peaksRef.current
    if (peaks.length === 0) return
    const waveColor = cssVar('--color-text-muted', '#888')
    const progColor = cssVar('--color-accent', '#e8a23d')
    const progress = duration > 0 ? currentTime / duration : 0
    const mid = cssH / 2
    const step = BAR_WIDTH + BAR_GAP
    for (let i = 0; i < peaks.length; i++) {
      const x = i * step
      const h = Math.max(1, peaks[i] * cssH)
      ctx.fillStyle = x / cssW <= progress ? progColor : waveColor
      ctx.fillRect(x, mid - h / 2, BAR_WIDTH, h)
    }
  }

  // Repaint the progress overlay as playback advances.
  useEffect(() => {
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration])

  // Recompute bars on container resize.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redrawWaveform())
    ro.observe(canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (aiff) {
    return (
      <div className="tagger-preview tagger-preview--unsupported">
        <p className="tagger-preview__message">Aperçu indisponible pour ce format</p>
      </div>
    )
  }

  const onPlayPauseClick = (): void => {
    const el = audioRef.current
    if (el === null) return
    if (el.paused) {
      el.play().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[tagger] play() rejected', err)
      })
    } else {
      el.pause()
    }
  }

  const onWaveformClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const el = audioRef.current
    const canvas = canvasRef.current
    if (el === null || canvas === null || duration <= 0) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    const frac = (e.clientX - rect.left) / rect.width
    el.currentTime = Math.max(0, Math.min(duration, frac * duration))
  }

  return (
    <div className="tagger-preview">
      <audio ref={audioRef} src={src} loop preload="auto" data-testid="tagger-audio" />
      <button
        type="button"
        className="tagger-preview__playpause"
        onClick={onPlayPauseClick}
        disabled={!canPlay}
        aria-label={isPlaying ? 'Pause' : 'Lecture'}
        aria-pressed={isPlaying}
        data-testid="tagger-playpause"
      >
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3.5 2.2v11.6a.7.7 0 0 0 1.06.6l9.6-5.8a.7.7 0 0 0 0-1.2L4.56 1.6A.7.7 0 0 0 3.5 2.2z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
      <canvas
        ref={canvasRef}
        className="tagger-preview__waveform"
        style={{ height: WAVE_HEIGHT }}
        onClick={onWaveformClick}
        aria-label="Forme d'onde — cliquer pour naviguer"
        data-testid="tagger-waveform"
      />
      <span className="tagger-preview__time" aria-live="off">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
