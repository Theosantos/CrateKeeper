import { useEffect, useRef, useState } from 'react'

/**
 * Looping audio preview, served via the cratekeeper:// custom protocol
 * registered in Plan 04-01 (folder-allowlist + AUDIO_EXTS gated).
 *
 * Plan 04-03 post-checkpoint fix v2:
 *   - Full-track scrubbing via a range slider; seek works because the
 *     protocol now serves Content-Length + Range requests.
 *   - Mute toggle replaced with a real Play/Pause control (with ▶/⏸
 *     icons). Mute remains in the store for muteEnabled persistence but
 *     is no longer surfaced as a button here.
 *
 * Pitfall 6: AIFF is not reliably playable by Chromium across platforms,
 * so we short-circuit at the renderer with a French fallback message.
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

export function AudioPreview({
  filePath
}: AudioPreviewProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // Track whether the user is actively dragging the slider — while true,
  // we stop syncing `currentTime` state from `timeupdate` so the thumb
  // doesn't fight the user's input.
  const seekingRef = useRef(false)
  const src = 'cratekeeper://audio/' + encodeURIComponent(filePath)

  useEffect(() => {
    const el = audioRef.current
    if (el === null) return
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    const onTime = (): void => {
      if (!seekingRef.current) setCurrentTime(el.currentTime)
    }
    const onLoaded = (): void => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    }
    const onPlay = (): void => setIsPlaying(true)
    const onPause = (): void => setIsPlaying(false)
    const onError = (): void => {
      const mediaErr = el.error
      // eslint-disable-next-line no-console
      console.error('[tagger] audio element error', {
        src: el.currentSrc || el.src,
        code: mediaErr?.code,
        message: mediaErr?.message
      })
    }
    const onStalled = (): void => {
      // eslint-disable-next-line no-console
      console.warn('[tagger] audio stalled', el.currentSrc || el.src)
    }
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('durationchange', onLoaded)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('error', onError)
    el.addEventListener('stalled', onStalled)

    let cancelled = false

    try {
      el.load()
    } catch {
      /* jsdom */
    }
    try {
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          // AbortError just means play() was interrupted by a follow-up pause()
          // (StrictMode double-mount or fast src change). Next effect run retries.
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
            return
          }
          // Real autoplay rejection (NotAllowedError etc.) — surface it so the
          // user can hit the Play button. We deliberately do NOT silently mute
          // and retry: there is no mute UI, so muting would strand the user.
          // eslint-disable-next-line no-console
          console.warn('[tagger] audio autoplay rejected — click Play to start', err)
        })
      }
    } catch {
      /* sync throw */
    }
    return () => {
      cancelled = true
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('durationchange', onLoaded)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('error', onError)
      el.removeEventListener('stalled', onStalled)
      try {
        el.pause()
      } catch {
        /* ignore */
      }
    }
  }, [filePath])

  if (isAiff(filePath)) {
    return (
      <div className="tagger-preview tagger-preview--unsupported">
        <p className="tagger-preview__message">
          Aperçu indisponible pour ce format
        </p>
      </div>
    )
  }

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const el = audioRef.current
    if (el === null) return
    const next = Number(e.target.value)
    if (!Number.isFinite(next)) return
    el.currentTime = next
    setCurrentTime(next)
  }

  const onSeekStart = (): void => {
    seekingRef.current = true
  }

  const onSeekEnd = (): void => {
    seekingRef.current = false
  }

  const onPlayPauseClick = (): void => {
    const el = audioRef.current
    if (el === null) return
    if (el.paused) {
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[tagger] play() rejected on user click', err)
        })
      }
    } else {
      el.pause()
    }
  }

  // Until metadata loads, give the slider a tiny non-zero max so the thumb
  // stays draggable; once duration is known we switch to the real value.
  const sliderMax = duration > 0 ? duration : 1

  return (
    <div className="tagger-preview">
      <audio
        ref={audioRef}
        src={src}
        loop
        preload="auto"
        data-testid="tagger-audio"
      />
      <div className="tagger-preview__transport">
        <button
          type="button"
          className="tagger-preview__playpause"
          onClick={onPlayPauseClick}
          aria-label={isPlaying ? 'Pause' : 'Lecture'}
          aria-pressed={isPlaying}
          data-testid="tagger-playpause"
        >
          {isPlaying ? (
            // ⏸ pause icon
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            // ▶ play icon
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3.5 2.2v11.6a.7.7 0 0 0 1.06.6l9.6-5.8a.7.7 0 0 0 0-1.2L4.56 1.6A.7.7 0 0 0 3.5 2.2z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          type="range"
          className="tagger-preview__seek"
          min={0}
          max={sliderMax}
          step={0.1}
          value={Math.min(currentTime, sliderMax)}
          onChange={onSeek}
          onPointerDown={onSeekStart}
          onPointerUp={onSeekEnd}
          onPointerCancel={onSeekEnd}
          onKeyDown={onSeekStart}
          onKeyUp={onSeekEnd}
          aria-label="Position dans la piste"
          data-testid="tagger-seek"
        />
        <span className="tagger-preview__time" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
