import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// wavesurfer.js needs canvas + Web Audio, neither of which jsdom provides.
// Mock it with a controllable fake instance so we can drive events.
interface FakeWs {
  on: (event: string, cb: (arg?: unknown) => void) => void
  emit: (event: string, arg?: unknown) => void
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
  playPause: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

const created: FakeWs[] = []
const lastCreateOptions: Record<string, unknown>[] = []

function makeFakeWs(): FakeWs {
  const handlers: Record<string, ((arg?: unknown) => void)[]> = {}
  return {
    on(event, cb) {
      ;(handlers[event] ??= []).push(cb)
    },
    emit(event, arg) {
      ;(handlers[event] ?? []).forEach((cb) => cb(arg))
    },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    playPause: vi.fn(),
    destroy: vi.fn()
  }
}

vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn((opts: Record<string, unknown>) => {
      const ws = makeFakeWs()
      created.push(ws)
      lastCreateOptions.push(opts)
      return ws
    })
  }
}))

import WaveSurfer from 'wavesurfer.js'
import { AudioPreview } from './AudioPreview'

beforeEach(() => {
  created.length = 0
  lastCreateOptions.length = 0
  vi.clearAllMocks()
})

describe('AudioPreview (wavesurfer)', () => {
  it('creates a wavesurfer instance with the cratekeeper:// url', () => {
    render(<AudioPreview filePath="/Users/test/A track.mp3" />)
    expect(WaveSurfer.create).toHaveBeenCalledTimes(1)
    const opts = lastCreateOptions[0]
    expect(opts.url).toBe(
      'cratekeeper://audio/' + encodeURIComponent('/Users/test/A track.mp3')
    )
    // SoundCloud-style bar config present.
    expect(opts.barWidth).toBeGreaterThan(0)
    expect(opts.normalize).toBe(true)
  })

  it('renders the waveform container', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    expect(screen.getByTestId('tagger-waveform')).toBeInTheDocument()
  })

  it('renders fallback for .aiff and does NOT create wavesurfer', () => {
    render(<AudioPreview filePath="/m/track.aiff" />)
    expect(screen.getByText('Aperçu indisponible pour ce format')).toBeInTheDocument()
    expect(screen.queryByTestId('tagger-waveform')).toBeNull()
    expect(WaveSurfer.create).not.toHaveBeenCalled()
  })

  it('renders fallback for .aif (case-insensitive)', () => {
    render(<AudioPreview filePath="/m/track.AIF" />)
    expect(screen.getByText('Aperçu indisponible pour ce format')).toBeInTheDocument()
    expect(WaveSurfer.create).not.toHaveBeenCalled()
  })

  it('play/pause button is disabled until ready, then enabled', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    const btn = screen.getByTestId('tagger-playpause') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    act(() => {
      created[0].emit('ready')
    })
    expect(btn.disabled).toBe(false)
  })

  it('autoplays on ready', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    act(() => {
      created[0].emit('ready')
    })
    expect(created[0].play).toHaveBeenCalledTimes(1)
  })

  it('play/pause button calls ws.playPause and reflects play/pause events', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    act(() => {
      created[0].emit('ready')
    })
    const btn = screen.getByTestId('tagger-playpause')
    btn.click()
    expect(created[0].playPause).toHaveBeenCalledTimes(1)

    act(() => {
      created[0].emit('play')
    })
    expect(btn.getAttribute('aria-label')).toBe('Pause')
    expect(btn.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      created[0].emit('pause')
    })
    expect(btn.getAttribute('aria-label')).toBe('Lecture')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('updates the time readout from decode + timeupdate events', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    act(() => {
      created[0].emit('decode', 185)
      created[0].emit('timeupdate', 42)
    })
    expect(screen.getByText('0:42 / 3:05')).toBeInTheDocument()
  })

  it('loops by replaying on finish', () => {
    render(<AudioPreview filePath="/m/a.mp3" />)
    act(() => {
      created[0].emit('ready')
      created[0].emit('finish')
    })
    // play() called once for autoplay + once for the loop replay.
    expect(created[0].play).toHaveBeenCalledTimes(2)
  })

  it('destroys wavesurfer on unmount', () => {
    const { unmount } = render(<AudioPreview filePath="/m/a.mp3" />)
    const ws = created[0]
    unmount()
    expect(ws.destroy).toHaveBeenCalledTimes(1)
  })

  it('recreates wavesurfer when filePath changes', () => {
    const { rerender } = render(<AudioPreview filePath="/m/a.mp3" />)
    expect(WaveSurfer.create).toHaveBeenCalledTimes(1)
    rerender(<AudioPreview filePath="/m/b.mp3" />)
    expect(WaveSurfer.create).toHaveBeenCalledTimes(2)
    // The first instance was destroyed during cleanup.
    expect(created[0].destroy).toHaveBeenCalledTimes(1)
  })
})
