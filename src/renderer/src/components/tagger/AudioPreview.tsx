import { useEffect, useRef } from 'react'

/**
 * 30-second looping audio preview, served via the cratekeeper:// custom
 * protocol registered in Plan 04-01 (folder-allowlist + AUDIO_EXTS gated).
 *
 * Pitfall 3: HTML <audio> cannot natively loop a sub-segment. We listen to
 * `timeupdate` and reset currentTime to 0 when it crosses 30s.
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

export function AudioPreview({
  filePath,
  muted,
  onMuteToggle
}: AudioPreviewProps): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const src = 'cratekeeper://audio/' + encodeURIComponent(filePath)

  useEffect(() => {
    const el = audioRef.current
    if (el === null) return
    const onTime = (): void => {
      if (el.currentTime >= 30) {
        el.currentTime = 0
      }
    }
    el.addEventListener('timeupdate', onTime)
    // Autoplay policy is unlocked at the main bootstrap (Plan 04-01).
    // jsdom's HTMLMediaElement.play() returns undefined; guard accordingly.
    try {
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') {
        p.catch(() => {
          /* autoplay rejected — surface elsewhere if needed */
        })
      }
    } catch {
      /* play() threw synchronously (rare); ignore — user can trigger via UI */
    }
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.pause()
      el.removeAttribute('src')
      el.load()
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
      <button type="button" onClick={onMuteToggle} aria-pressed={muted}>
        {muted ? 'Activer le son' : 'Couper le son'}
      </button>
    </div>
  )
}
