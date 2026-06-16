import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrateKeeperApi, ScannedFile } from '../../../../shared/ipc-types'
import { useTaggerStore } from '../../store/useTaggerStore'
import { TaggerCard } from './TaggerCard'

function makeFile(path: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path,
    format: 'mp3',
    bitrate: 320,
    sizeBytes: 1024,
    sampleRate: 44100,
    durationSeconds: 200,
    hasGenre: false,
    hasBpm: false,
    hasKey: false,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

function installMockBridge(): void {
  globalThis.window.crateKeeper = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue(null),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    scan: {
      start: vi.fn(),
      cancel: vi.fn(),
      exportCsv: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => {})
    } as unknown as CrateKeeperApi['scan'],
    conversion: {} as unknown as CrateKeeperApi['conversion'],
    tagger: {
      loadQueue: vi.fn(),
      saveEdit: vi.fn().mockResolvedValue(undefined),
      deleteEdit: vi.fn(),
      getSession: vi.fn(),
      setSession: vi.fn(),
      getGenrePresets: vi.fn(),
      getWaveform: vi.fn().mockResolvedValue({ peaks: [], durationSec: null })
    } as unknown as CrateKeeperApi['tagger']
  }
}

function seedStore(file: ScannedFile): void {
  useTaggerStore.setState({
    queue: [file],
    currentIndex: 0,
    status: 'ready',
    genrePresets: [
      'House',
      'Techno',
      'Afro House',
      'Melodic',
      'Disco',
      'Hip-Hop',
      'Funk',
      'Deep',
      'Electronica'
    ],
    muteEnabled: false,
    dirtyEdits: new Map(),
    pendingEdits: new Map()
  })
}

describe('TaggerCard', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
    installMockBridge()
  })

  it('renders basename as heading and parent dir as subtitle', () => {
    const f = makeFile('/Music/House/track.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('track.mp3')
    expect(screen.getByText('/Music/House')).toBeInTheDocument()
  })

  it('shows tag chips for present flags and format chip always', () => {
    const f = makeFile('/m/a.mp3', { hasGenre: true, hasBpm: false, hasKey: true })
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    expect(screen.getByText('Genre détecté')).toBeInTheDocument()
    expect(screen.queryByText('BPM détecté')).toBeNull()
    expect(screen.getByText('Key détectée')).toBeInTheDocument()
    expect(screen.getByText('mp3')).toBeInTheDocument()
  })

  it('renders editable inputs for Artist/Title/Genre/Commentaire', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    // Use label text matching
    expect(screen.getByText('Artiste')).toBeInTheDocument()
    expect(screen.getByText('Titre')).toBeInTheDocument()
    expect(screen.getByText('Genre')).toBeInTheDocument()
    expect(screen.getByText('Commentaire')).toBeInTheDocument()
  })

  it('does NOT render BPM or Key editable fields (Rekordbox owns those)', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    // The label "BPM détecté" chip may still appear if hasBpm is true, but
    // there must be no editable input labelled exactly "BPM" or "Key".
    expect(screen.queryByText('BPM', { selector: '.tagger-field__label' })).toBeNull()
    expect(screen.queryByText('Key', { selector: '.tagger-field__label' })).toBeNull()
  })

  it('typing in Artist input writes to dirtyEdits.artist', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    const artistLabel = screen.getByText('Artiste').closest('label')!
    const input = artistLabel.querySelector('input')!
    fireEvent.change(input, { target: { value: 'Daft Punk' } })
    expect(useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.artist).toBe('Daft Punk')
  })

  it('GenrePresetBar receives store genrePresets and applies on click', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    const toolbar = screen.getByRole('toolbar', { name: 'Genres rapides' })
    const btns = within(toolbar).getAllByRole('button')
    expect(btns).toHaveLength(9)
    fireEvent.click(btns[1]) // slot 2 → 'Techno'
    expect(useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre).toBe('Techno')
  })

  it('defaults the Titre field to the filename without extension', () => {
    const f = makeFile('/Music/House/Midnight City.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    const titleInput = screen.getByText('Titre').closest('label')!.querySelector('input')!
    expect(titleInput).toHaveValue('Midnight City')
    // Seeded as a real dirty edit so a Keep persists it.
    expect(useTaggerStore.getState().dirtyEdits.get(f.path)?.title).toBe('Midnight City')
  })

  it('does NOT default Titre when an Artist/Title split is proposed', () => {
    const f = makeFile('/m/Daft Punk - Around The World.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    const titleInput = screen.getByText('Titre').closest('label')!.querySelector('input')!
    expect(titleInput).toHaveValue('')
    // The split suggestion is shown instead; no title is pre-seeded.
    expect(screen.getByRole('region', { name: 'Suggestion Artiste / Titre' })).toBeInTheDocument()
    expect(useTaggerStore.getState().dirtyEdits.has(f.path)).toBe(false)
  })

  it('does NOT override an existing saved title with the filename default', () => {
    const f = makeFile('/m/track.mp3')
    seedStore(f)
    useTaggerStore.setState({
      pendingEdits: new Map([
        [
          f.path,
          {
            filePath: f.path,
            genre: null,
            bpm: null,
            key: null,
            artist: null,
            title: 'Real Title',
            comment: null,
            rating: null,
            updatedAt: 1,
            appliedAt: null
          }
        ]
      ])
    })
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    const titleInput = screen.getByText('Titre').closest('label')!.querySelector('input')!
    expect(titleInput).toHaveValue('Real Title')
    expect(useTaggerStore.getState().dirtyEdits.has(f.path)).toBe(false)
  })

  it('ArtistTitleSplit appears when artist empty + title has separator', () => {
    const f = makeFile('/m/Daft Punk - Around The World.mp3')
    seedStore(f)
    // Pre-seed dirtyEdits with title from filename so ArtistTitleSplit sees it
    useTaggerStore.getState().setDirtyEdit('title', 'Daft Punk - Around The World')
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    expect(screen.getByRole('region', { name: 'Suggestion Artiste / Titre' })).toBeInTheDocument()
  })

  it('RatingStars wired to setRating', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '4 étoiles' }))
    expect(useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.rating).toBe(4)
  })

  it('action row: Passer / Annuler (disabled) / Sauver in French', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    expect(screen.getByRole('button', { name: 'Passer' })).toBeInTheDocument()
    const undo = screen.getByRole('button', { name: 'Annuler' })
    expect(undo).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sauver' })).toBeInTheDocument()
  })

  it('clicking Keep calls onKeep; clicking Skip calls onSkip', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    const onKeep = vi.fn()
    const onSkip = vi.fn()
    render(<TaggerCard file={f} onKeep={onKeep} onSkip={onSkip} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('card root element has className tagger-card', () => {
    const f = makeFile('/m/a.mp3')
    seedStore(f)
    const { container } = render(<TaggerCard file={f} onKeep={() => {}} onSkip={() => {}} />)
    expect(container.querySelector('.tagger-card')).not.toBeNull()
  })
})

describe('tagger.css (file content)', () => {
  const cssPath = join(__dirname, 'tagger.css')
  const css = readFileSync(cssPath, 'utf8')

  it('does not declare any new --color-* tokens', () => {
    const declarations = css.split('\n').filter((l) => /^\s*--color-[\w-]+\s*:/.test(l))
    expect(declarations).toEqual([])
  })

  it('exit-left and exit-right use translateX + opacity only', () => {
    expect(css).toMatch(
      /\.tagger-card--exit-left\s*\{[^}]*transform:\s*translateX\(-100vw\)[^}]*opacity:\s*0/
    )
    expect(css).toMatch(
      /\.tagger-card--exit-right\s*\{[^}]*transform:\s*translateX\(100vw\)[^}]*opacity:\s*0/
    )
  })

  it('does not animate layout-bound properties', () => {
    expect(css).not.toMatch(/transition[^;]*width/)
    expect(css).not.toMatch(/transition[^;]*height/)
    expect(css).not.toMatch(/transition[^;]*margin/)
    expect(css).not.toMatch(/transition[^;]*padding/)
  })
})

describe('renderer/index.html CSP', () => {
  it('includes media-src self cratekeeper:', () => {
    const indexHtml = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8')
    expect(indexHtml).toContain("media-src 'self' cratekeeper:")
  })
})
