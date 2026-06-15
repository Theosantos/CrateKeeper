import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'

/**
 * SoundCloud-style waveform preview, served via the cratekeeper:// custom
 * protocol registered in Plan 04-01 (folder-allowlist + AUDIO_EXTS gated).
 *
 * Plan 04-03 post-checkpoint fix v3:
 *   - The custom <audio>+slider was replaced with wavesurfer.js. The amplitude
 *     waveform makes breaks (quiet → short bars) and drops (loud → tall bars)
 *     immediately visible, and click/drag on the waveform seeks. wavesurfer
 *     fetches the file once to draw peaks and plays through its own media
 *     element (our protocol's Range support keeps playback seek smooth).
 *   - Autoplay on ready; loop by replaying on finish.
 *
 * Pitfall 6: AIFF is not reliably decodable by Chromium across platforms, so
 * we short-circuit at the renderer with a French fallback message.
 */
interface AudioPreviewProps {
  filePath: string
}

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

/**
 * Resolve a CSS custom property to its computed value so wavesurfer's canvas
 * fills use the same design tokens as the rest of the UI.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v === '' ? fallback : v
}

export function AudioPreview({ filePath }: AudioPreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const src = 'cratekeeper://audio/' + encodeURIComponent(filePath)
  const aiff = isAiff(filePath)

  useEffect(() => {
    if (aiff) return
    const container = containerRef.current
    if (container === null) return

    const ws = WaveSurfer.create({
      container,
      url: src,
      height: 72,
      // SoundCloud-style bars; normalize so a quiet track still shows its full
      // dynamic range (relative break/drop contrast stays legible).
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      cursorWidth: 1,
      waveColor: cssVar('--color-text-muted', '#888'),
      progressColor: cssVar('--color-accent', '#e8a23d'),
      cursorColor: cssVar('--color-accent-strong', '#f0b050')
    })
    wsRef.current = ws

    const onDecode = (d: number): void => setDuration(d)
    const onTime = (t: number): void => setCurrentTime(t)
    const onPlay = (): void => setIsPlaying(true)
    const onPause = (): void => setIsPlaying(false)
    const onReady = (): void => {
      setIsReady(true)
      // Autoplay (BrowserWindow sets autoplayPolicy:'no-user-gesture-required').
      const p = ws.play()
      if (p !== undefined && typeof (p as Promise<void>).catch === 'function') {
        ;(p as Promise<void>).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[tagger] waveform autoplay rejected — click Play', err)
        })
      }
    }
    // Manual loop: replay from the start when the track finishes.
    const onFinish = (): void => {
      ws.play().catch(() => {
        /* ignore */
      })
    }
    const onError = (err: unknown): void => {
      // eslint-disable-next-line no-console
      console.error('[tagger] wavesurfer error', { src, err })
    }

    ws.on('decode', onDecode)
    ws.on('timeupdate', onTime)
    ws.on('play', onPlay)
    ws.on('pause', onPause)
    ws.on('ready', onReady)
    ws.on('finish', onFinish)
    ws.on('error', onError)

    return () => {
      // destroy() removes listeners, aborts the in-flight fetch, and tears
      // down the audio element + Web Audio graph.
      wsRef.current = null
      setIsReady(false)
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      try {
        ws.destroy()
      } catch {
        /* destroy can throw if fetch was aborted mid-decode; ignore */
      }
    }
  }, [src, aiff])

  if (aiff) {
    return (
      <div className="tagger-preview tagger-preview--unsupported">
        <p className="tagger-preview__message">Aperçu indisponible pour ce format</p>
      </div>
    )
  }

  const onPlayPauseClick = (): void => {
    const ws = wsRef.current
    if (ws === null) return
    ws.playPause()
  }

  return (
    <div className="tagger-preview">
      <button
        type="button"
        className="tagger-preview__playpause"
        onClick={onPlayPauseClick}
        disabled={!isReady}
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
      <div
        ref={containerRef}
        className="tagger-preview__waveform"
        data-testid="tagger-waveform"
        aria-label="Forme d'onde — cliquer pour naviguer"
      />
      <span className="tagger-preview__time" aria-live="off">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
