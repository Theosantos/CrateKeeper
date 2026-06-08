import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AudioPreview } from './AudioPreview'

describe('AudioPreview', () => {
  it('renders <audio> with cratekeeper:// src (URI-encoded path)', () => {
    render(<AudioPreview filePath="/Users/test/A track.mp3" muted={false} />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toBe(
      'cratekeeper://audio/' + encodeURIComponent('/Users/test/A track.mp3')
    )
    expect(audio.hasAttribute('loop')).toBe(true)
    expect(audio.preload).toBe('auto')
    expect(audio.muted).toBe(false)
  })

  it('honours muted prop', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted={true} />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.muted).toBe(true)
  })

  it('renders fallback for .aiff (no <audio> element)', () => {
    render(<AudioPreview filePath="/m/track.aiff" muted={false} />)
    expect(
      screen.getByText('Aperçu indisponible pour ce format')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-audio')).toBeNull()
  })

  it('renders fallback for .aif (case-insensitive)', () => {
    render(<AudioPreview filePath="/m/track.AIF" muted={false} />)
    expect(
      screen.getByText('Aperçu indisponible pour ce format')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-audio')).toBeNull()
  })

  it('renders seek slider with time display', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted />)
    const seek = screen.getByTestId('tagger-seek') as HTMLInputElement
    expect(seek.type).toBe('range')
    expect(seek.getAttribute('aria-label')).toBe('Position dans la piste')
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument()
  })

  it('seek slider onChange sets audio currentTime', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { writable: true, value: 0 })
    Object.defineProperty(audio, 'duration', {
      configurable: true,
      get: () => 180
    })
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
    })
    const seek = screen.getByTestId('tagger-seek') as HTMLInputElement
    fireEvent.change(seek, { target: { value: '42.5' } })
    expect(audio.currentTime).toBe(42.5)
  })

  it('does NOT reset currentTime at 30s (full-track scrubbing)', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { writable: true, value: 45 })
    audio.dispatchEvent(new Event('timeupdate'))
    expect(audio.currentTime).toBe(45)
  })

  it('renders a play/pause button (Lecture label when paused)', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted />)
    const btn = screen.getByTestId('tagger-playpause')
    // jsdom doesn't auto-play, so element starts paused → label is "Lecture".
    expect(btn.getAttribute('aria-label')).toBe('Lecture')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('play/pause button flips label and aria-pressed when audio plays', () => {
    render(<AudioPreview filePath="/m/a.mp3" muted />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    act(() => {
      audio.dispatchEvent(new Event('play'))
    })
    const btn = screen.getByTestId('tagger-playpause')
    expect(btn.getAttribute('aria-label')).toBe('Pause')
    expect(btn.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      audio.dispatchEvent(new Event('pause'))
    })
    expect(btn.getAttribute('aria-label')).toBe('Lecture')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('changing filePath does not throw (cleanup runs cleanly)', () => {
    const { rerender, unmount } = render(
      <AudioPreview filePath="/m/a.mp3" muted />
    )
    rerender(<AudioPreview filePath="/m/b.mp3" muted />)
    const audio = screen.getByTestId('tagger-audio')
    expect(audio).toBeInTheDocument()
    unmount()
  })
})
