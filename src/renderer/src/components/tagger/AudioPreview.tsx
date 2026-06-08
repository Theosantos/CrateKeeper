import { useEffect, useRef, useState } from 'react'

/**
 * Looping audio preview, served via the cratekeeper:// custom protocol
 * registered in Plan 04-01 (folder-allowlist + AUDIO_EXTS gated).
 *
 * Plan 04-03 post-checkpoint fix: full-track scrubbing via a range slider
 * with current-time / duration readout. The 30s sub-segment loop was
 * removed — `loop` on the <audio> restarts from 0 at the natural end.
 *
 * Pitfall 6: AIFF is not reliably playable by Chromium across platforms,
 * so we short-circuit at the renderer with a French fallback message.
 */
interface AudioPreviewProps {
  filePath: string
  muted: boolean
  onMuteToggle: () => void
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
  filePath,
  muted,
  onMuteToggle
}: AudioPreviewProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const src = 'cratekeeper://audio/' + encodeURIComponent(filePath)

  // Sync mute imperatively without re-running the load/play cycle. Putting
  // `muted` in the main effect deps caused the cycle to restart on every
  // toggle, which aborted in-flight play() promises (#audio-silent).
  useEffect(() => {
    const el = audioRef.current
    if (el !== null) el.muted = muted
  }, [muted])

  useEffect(() => {
    const el = audioRef.current
    if (el === null) return
    setCurrentTime(0)
    setDuration(0)
    const onTime = (): void => {
      setCurrentTime(el.currentTime)
    }
    const onLoaded = (): void => {
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    }
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
    el.addEventListener('error', onError)
    el.addEventListener('stalled', onStalled)

    // Track whether this effect's lifetime is still current. React StrictMode
    // (and any parent re-render) tears the effect down and recreates it; we
    // must NOT touch the element from a stale closure.
    let cancelled = false

    // Force an explicit load after src changes — without this Chromium can
    // defer loading the new media until the next user gesture.
    try {
      el.load()
    } catch {
      /* load() may throw in jsdom; ignore */
    }
    try {
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          // AbortError just means the play() was interrupted by a follow-up
          // pause() (typical of StrictMode double-mount or a fast src change).
          // The next effect run will issue a fresh play(); do NOT mute as a
          // fallback in this case — muting on AbortError is what made the
          // audio appear silent.
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) {
            return
          }
          // Real autoplay rejection (NotAllowedError etc.): fall back to muted
          // so the timeline still progresses; the user can unmute via the UI.
          if (!el.muted) {
            el.muted = true
            const retry = el.play()
            if (retry !== undefined && typeof retry.catch === 'function') {
              retry.catch(() => {
                /* still rejected — user can trigger via UI */
              })
            }
          }
          // eslint-disable-next-line no-console
          console.warn('[tagger] audio autoplay rejected', err)
        })
      }
    } catch {
      /* play() threw synchronously (rare); ignore */
    }
    return () => {
      cancelled = true
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('durationchange', onLoaded)
      el.removeEventListener('error', onError)
      el.removeEventListener('stalled', onStalled)
      // Only pause — do NOT clear src/load(). The next effect run (with the
      // same or new filePath) will issue its own load()+play(); clearing src
      // here just creates pointless network thrash and was contributing to
      // the AbortError loop.
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
        <button type="button" onClick={onMuteToggle} aria-pressed={muted}>
          {muted ? 'Activer le son' : 'Couper le son'}
        </button>
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

  // Max defaults to a small positive value when duration is still 0 so the
  // slider thumb stays draggable; once metadata loads it switches to real dur.
  const sliderMax = duration > 0 ? duration : 1

  return (
    <div className="tagger-preview">
      <audio
        ref={audioRef}
        src={src}
        loop
        muted={muted}
        preload="auto"
        data-testid="tagger-audio"
      />
      <div className="tagger-preview__transport">
        <input
          type="range"
          className="tagger-preview__seek"
          min={0}
          max={sliderMax}
          step={0.1}
          value={Math.min(currentTime, sliderMax)}
          onChange={onSeek}
          aria-label="Position dans la piste"
          data-testid="tagger-seek"
        />
        <span className="tagger-preview__time" aria-live="off">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <button type="button" onClick={onMuteToggle} aria-pressed={muted}>
        {muted ? 'Activer le son' : 'Couper le son'}
      </button>
    </div>
  )
}
