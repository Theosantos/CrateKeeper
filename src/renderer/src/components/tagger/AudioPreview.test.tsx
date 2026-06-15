import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AudioPreview } from './AudioPreview'

// jsdom has no AudioContext / canvas 2d context, so the waveform-decode effect
// is a guarded no-op here. These tests cover the playback contract: the
// <audio> element, the canplay-gated autoplay + play button, and the time
// readout — none of which depend on the waveform rendering.

describe('AudioPreview', () => {
  it('renders <audio> with cratekeeper:// src (URI-encoded path)', () => {
    render(<AudioPreview filePath="/Users/test/A track.mp3" />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toBe(
      'cratekeeper://audio/' + encodeURIComponent('/Users/test/A track.mp3')
    )
    expect(audio.hasAttribute('loop')).toBe(true)
    expect(audio.preload).toBe('auto')
  })

  it('renders the waveform canvas', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    expect(screen.getByTestId('tagger-waveform')).toBeInTheDocument()
  })

  it('renders fallback for .aiff (no audio, no canvas)', () => {
    render(<AudioPreview filePath="/m/track.aiff" />)
    expect(screen.getByText('Aperçu indisponible pour ce format')).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-audio')).toBeNull()
    expect(screen.queryByTestId('tagger-waveform')).toBeNull()
  })

  it('renders fallback for .aif (case-insensitive)', () => {
    render(<AudioPreview filePath="/m/track.AIF" />)
    expect(screen.getByText('Aperçu indisponible pour ce format')).toBeInTheDocument()
  })

  it('play button is disabled until the audio can play', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    const btn = screen.getByTestId('tagger-playpause') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    act(() => {
      audio.dispatchEvent(new Event('canplay'))
    })
    expect(btn.disabled).toBe(false)
  })

  it('play/pause label + aria-pressed follow the audio play/pause events', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    act(() => {
      audio.dispatchEvent(new Event('canplay'))
    })
    const btn = screen.getByTestId('tagger-playpause')
    expect(btn.getAttribute('aria-label')).toBe('Lecture')

    act(() => {
      audio.dispatchEvent(new Event('play'))
    })
    expect(btn.getAttribute('aria-label')).toBe('Pause')
    expect(btn.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      audio.dispatchEvent(new Event('pause'))
    })
    expect(btn.getAttribute('aria-label')).toBe('Lecture')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('updates the time readout from loadedmetadata + timeupdate', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, get: () => 185 })
    Object.defineProperty(audio, 'currentTime', { writable: true, value: 42 })
    act(() => {
      audio.dispatchEvent(new Event('loadedmetadata'))
      audio.dispatchEvent(new Event('timeupdate'))
    })
    expect(screen.getByText('0:42 / 3:05')).toBeInTheDocument()
  })

  it('clicking the waveform does not throw (seek guard)', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    const canvas = screen.getByTestId('tagger-waveform')
    // duration is 0 in jsdom → seek is a guarded no-op; just assert no throw.
    expect(() => canvas.click()).not.toThrow()
  })

  it('changing filePath updates the src and does not throw', () => {
    const { rerender } = render(<AudioPreview filePath="/m/a.mp3" />)
    rerender(<AudioPreview filePath="/m/b.mp3" />)
    const audio = screen.getByTestId('tagger-audio') as HTMLAudioElement
    expect(audio.getAttribute('src')).toBe(
      'cratekeeper://audio/' + encodeURIComponent('/m/b.mp3')
    )
  })
})
