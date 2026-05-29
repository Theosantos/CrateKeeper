/**
 * G/B/K tag badge — three-letter glyph reflecting SCAN-03 booleans.
 *
 * Visual contract:
 *  - `present=true`  → filled (kind-specific accent token)
 *  - `present=false` → hollow outline (same hue at low chroma)
 *  - kind='Erreur'   → always filled with the error token; `title` surfaces
 *                      the parse error message via hover/long-press.
 *
 * Semantic contract: a screen reader announces "Genre: présent" /
 * "BPM: absent" / "Erreur de lecture" etc. via aria-label.
 */

export type TagBadgeKind = 'G' | 'B' | 'K' | 'Erreur'

type Props = {
  kind: TagBadgeKind
  present: boolean
  title?: string
}

const FULL_LABEL: Record<TagBadgeKind, string> = {
  G: 'Genre',
  B: 'BPM',
  K: 'Key',
  Erreur: 'Erreur de lecture'
}

const KIND_CLASS: Record<TagBadgeKind, string> = {
  G: 'tag-badge--genre',
  B: 'tag-badge--bpm',
  K: 'tag-badge--key',
  Erreur: 'tag-badge--error'
}

export function TagBadge({ kind, present, title }: Props): React.JSX.Element {
  const label =
    kind === 'Erreur'
      ? FULL_LABEL.Erreur
      : `${FULL_LABEL[kind]}: ${present ? 'présent' : 'absent'}`
  const presentClass = present ? 'tag-badge--present' : 'tag-badge--absent'

  return (
    <span
      role="status"
      aria-label={label}
      title={title ?? label}
      className={`tag-badge ${KIND_CLASS[kind]} ${presentClass}`}
    >
      {kind === 'Erreur' ? '!' : kind}
    </span>
  )
}
