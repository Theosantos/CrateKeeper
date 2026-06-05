import type { ScannedFile } from '../../../../shared/ipc-types'
import { selectCurrentFile, useTaggerStore } from '../../store/useTaggerStore'
import { AudioPreview } from './AudioPreview'
import { ArtistTitleSplit } from './ArtistTitleSplit'
import { GenrePresetBar } from './GenrePresetBar'
import { RatingStars } from './RatingStars'

interface TaggerCardProps {
  file: ScannedFile
  onKeep: () => void
  onSkip: () => void
  /** Plan 04-03: undo handler. Disabled when canUndo === false. */
  onUndo?: () => void
  /** Plan 04-03: when false, Annuler button is disabled (no lastAction). */
  canUndo?: boolean
}

interface MergedCurrent {
  genre: string | null
  bpm: number | null
  key: string | null
  artist: string | null
  title: string | null
  comment: string | null
  rating: number | null
}

function basenameOf(p: string): string {
  const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return ix >= 0 ? p.slice(ix + 1) : p
}

function parentOf(p: string): string {
  const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return ix > 0 ? p.slice(0, ix) : ''
}

const EMPTY: MergedCurrent = {
  genre: null,
  bpm: null,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null
}

/**
 * The editable card: filename + read-only chips + AudioPreview + Artist/Title
 * split banner + editable fields (Artist, Title, Genre, BPM, Key, Comment) +
 * RatingStars + GenrePresetBar + action row (Passer / Annuler / Sauver).
 *
 * Slide animation is driven by the parent (TaggerView) via wrapper className —
 * keep/skip props let the view orchestrate transitionend → store action.
 */
export function TaggerCard({
  file,
  onKeep,
  onSkip,
  onUndo,
  canUndo = false
}: TaggerCardProps): React.JSX.Element {
  const dirty = useTaggerStore((s) => s.dirtyEdits.get(file.path))
  const pending = useTaggerStore((s) => s.pendingEdits.get(file.path))
  const genrePresets = useTaggerStore((s) => s.genrePresets)
  const muteEnabled = useTaggerStore((s) => s.muteEnabled)
  const setDirtyEdit = useTaggerStore((s) => s.setDirtyEdit)
  const applyPreset = useTaggerStore((s) => s.applyPreset)
  const applySplit = useTaggerStore((s) => s.applySplit)
  const setRating = useTaggerStore((s) => s.setRating)
  const toggleMute = useTaggerStore((s) => s.toggleMute)

  const current: MergedCurrent = {
    ...EMPTY,
    ...(pending ?? {}),
    ...(dirty ?? {})
  }

  const basename = basenameOf(file.path)
  const parent = parentOf(file.path)

  const onBpmChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value
    if (v === '') {
      setDirtyEdit('bpm', null)
      return
    }
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 399) {
      setDirtyEdit('bpm', null)
      return
    }
    setDirtyEdit('bpm', n)
  }

  return (
    <article
      className="tagger-card"
      aria-labelledby={`tagger-card-title-${basename}`}
    >
      <header className="tagger-card__header">
        <h3
          id={`tagger-card-title-${basename}`}
          className="tagger-card__title"
        >
          {basename}
        </h3>
        {parent !== '' && <p className="tagger-card__path">{parent}</p>}
      </header>

      <AudioPreview
        filePath={file.path}
        muted={muteEnabled}
        onMuteToggle={() => {
          void toggleMute()
        }}
      />

      <section className="tagger-card__chips" aria-label="Tags existants">
        {file.hasGenre && <span className="tagger-chip">Genre détecté</span>}
        {file.hasBpm && <span className="tagger-chip">BPM détecté</span>}
        {file.hasKey && <span className="tagger-chip">Key détectée</span>}
        <span className="tagger-chip tagger-chip--muted">{file.format}</span>
      </section>

      <ArtistTitleSplit
        title={current.title ?? basename}
        artistEmpty={current.artist === null || current.artist === ''}
        onApply={applySplit}
      />

      <section className="tagger-card__fields">
        <label className="tagger-field">
          <span className="tagger-field__label">Artiste</span>
          <input
            type="text"
            maxLength={500}
            value={current.artist ?? ''}
            onChange={(e) => setDirtyEdit('artist', e.target.value)}
          />
        </label>
        <label className="tagger-field">
          <span className="tagger-field__label">Titre</span>
          <input
            type="text"
            maxLength={500}
            value={current.title ?? ''}
            onChange={(e) => setDirtyEdit('title', e.target.value)}
          />
        </label>
        <label className="tagger-field">
          <span className="tagger-field__label">Genre</span>
          <input
            type="text"
            maxLength={500}
            value={current.genre ?? ''}
            onChange={(e) => setDirtyEdit('genre', e.target.value)}
          />
        </label>
        <label className="tagger-field tagger-field--inline">
          <span className="tagger-field__label">BPM</span>
          <input
            type="number"
            min={1}
            max={399}
            step={1}
            value={current.bpm ?? ''}
            onChange={onBpmChange}
          />
        </label>
        <label className="tagger-field tagger-field--inline">
          <span className="tagger-field__label">Key</span>
          <input
            type="text"
            maxLength={16}
            value={current.key ?? ''}
            onChange={(e) => setDirtyEdit('key', e.target.value)}
          />
        </label>
        <label className="tagger-field">
          <span className="tagger-field__label">Commentaire</span>
          <textarea
            maxLength={500}
            value={current.comment ?? ''}
            onChange={(e) => setDirtyEdit('comment', e.target.value)}
          />
        </label>
        <div className="tagger-field">
          <span className="tagger-field__label">Note</span>
          <RatingStars rating={current.rating} onChange={setRating} />
        </div>
      </section>

      <GenrePresetBar presets={genrePresets} onApply={applyPreset} />

      <footer className="tagger-card__actions">
        <button
          type="button"
          className="tagger-action tagger-action--skip"
          onClick={onSkip}
          aria-label="Passer"
        >
          Passer (→)
        </button>
        <button
          type="button"
          className="tagger-action tagger-action--undo"
          onClick={onUndo}
          disabled={!canUndo}
          aria-disabled={!canUndo}
          aria-label="Annuler"
        >
          Annuler (⌘Z)
        </button>
        <button
          type="button"
          className="tagger-action tagger-action--keep"
          onClick={onKeep}
          aria-label="Sauver"
        >
          Sauver (←)
        </button>
      </footer>
    </article>
  )
}

// Exported for parent shells that want to read the current-file selector.
export { selectCurrentFile }
