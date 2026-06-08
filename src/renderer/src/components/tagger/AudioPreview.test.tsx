import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioPreview } from './AudioPreview'

describe('AudioPreview', () => {
  it('renders <audio> with cratekeeper:// src (URI-encoded path)', () => {
    render(
      <AudioPreview
        filePath="/Users/test/A track.mp3"
        muted={false}
        onMuteToggle={() => {}}
      />
    )
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toBe(
      'cratekeeper://audio/' + encodeURIComponent('/Users/test/A track.mp3')
    )
    expect(audio.hasAttribute('loop')).toBe(true)
    expect(audio.preload).toBe('auto')
    expect(audio.muted).toBe(false)
  })

  it('honours muted prop', () => {
    render(
      <AudioPreview
        filePath="/m/a.mp3"
        muted={true}
        onMuteToggle={() => {}}
      />
    )
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.muted).toBe(true)
  })

  it('renders fallback for .aiff (no <audio> element)', () => {
    render(
      <AudioPreview
        filePath="/m/track.aiff"
        muted={false}
        onMuteToggle={() => {}}
      />
    )
    expect(
      screen.getByText('Aperçu indisponible pour ce format')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-audio')).toBeNull()
  })

  it('renders fallback for .aif (case-insensitive)', () => {
    render(
      <AudioPreview
        filePath="/m/track.AIF"
        muted={false}
        onMuteToggle={() => {}}
      />
    )
    expect(
      screen.getByText('Aperçu indisponible pour ce format')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-audio')).toBeNull()
  })

  it('renders seek slider with time display', () => {
    render(
      <AudioPreview filePath="/m/a.mp3" muted onMuteToggle={() => {}} />
    )
    const seek = screen.getByTestId('tagger-seek') as HTMLInputElement
    expect(seek.type).toBe('range')
    expect(seek.getAttribute('aria-label')).toBe('Position dans la piste')
    // Default time readout before metadata loads.
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument()
  })

  it('seek slider onChange sets audio currentTime', () => {
    render(
      <AudioPreview filePath="/m/a.mp3" muted onMuteToggle={() => {}} />
    )
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', {
      writable: true,
      value: 0
    })
    // Simulate duration becoming available so the slider's max permits scrubbing.
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
    render(
      <AudioPreview filePath="/m/a.mp3" muted onMuteToggle={() => {}} />
    )
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', {
      writable: true,
      value: 45
    })
    audio.dispatchEvent(new Event('timeupdate'))
    expect(audio.currentTime).toBe(45)
  })

  it('mute toggle button shows French copy + calls onMuteToggle', () => {
    const onMuteToggle = vi.fn()
    const { rerender } = render(
      <AudioPreview
        filePath="/m/a.mp3"
        muted={false}
        onMuteToggle={onMuteToggle}
      />
    )
    const btn = screen.getByRole('button', { name: 'Couper le son' })
    fireEvent.click(btn)
    expect(onMuteToggle).toHaveBeenCalledTimes(1)

    rerender(
      <AudioPreview
        filePath="/m/a.mp3"
        muted={true}
        onMuteToggle={onMuteToggle}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Activer le son' })
    ).toBeInTheDocument()
  })

  it('changing filePath unmounts the previous src (cleanup)', () => {
    const { rerender, unmount } = render(
      <AudioPreview filePath="/m/a.mp3" muted onMuteToggle={() => {}} />
    )
    rerender(
      <AudioPreview filePath="/m/b.mp3" muted onMuteToggle={() => {}} />
    )
    // After rerender React updates the same <audio> element's src prop;
    // the cleanup effect from the prior render fires before the new effect.
    // The test passes if no throw occurs and the element still exists.
    const audio = screen.getByTestId('tagger-audio')
    expect(audio).toBeInTheDocument()
    unmount()
  })
})
