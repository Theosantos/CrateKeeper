import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplyResult } from '../../../../shared/ipc-types'
import { useTaggerStore } from '../../store/useTaggerStore'
import { ApplyBanner } from './ApplyBanner'

/**
 * Plan 05-03 Task 2 — ApplyBanner unit tests.
 *
 * Tests behavior via the RTL DOM:
 *  (a) renders null when count 0 + no result + not applying
 *  (b) shows "Appliquer (3)" when pendingWriteCount=3
 *  (c) button disabled + "Écriture…" when isApplying
 *  (d) clicking calls applyWrites
 *  (e) shows Écrit/Erreur badges from writeResults + "N écrits, N erreurs" summary
 */

function setStoreState(partial: {
  pendingWriteCount?: number
  isApplying?: boolean
  applyResult?: ApplyResult | null
  applyError?: string | null
  writeResults?: Map<string, { ok: boolean; error?: string }>
}): void {
  useTaggerStore.setState({
    pendingWriteCount: partial.pendingWriteCount ?? 0,
    isApplying: partial.isApplying ?? false,
    applyResult: partial.applyResult ?? null,
    applyError: partial.applyError ?? null,
    writeResults:
      partial.writeResults ?? new Map<string, { ok: boolean; error?: string }>()
  })
}

describe('ApplyBanner', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
  })

  it('(a) renders null when pendingWriteCount=0, no result, not applying', () => {
    setStoreState({})
    const { container } = render(<ApplyBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('(b) shows "Appliquer (3)" when pendingWriteCount=3', () => {
    setStoreState({ pendingWriteCount: 3 })
    render(<ApplyBanner />)
    expect(
      screen.getByRole('button', { name: 'Appliquer (3)' })
    ).toBeInTheDocument()
    expect(screen.getByText('3 tags en attente')).toBeInTheDocument()
  })

  it('(b-singular) shows "1 tag en attente" for pendingWriteCount=1', () => {
    setStoreState({ pendingWriteCount: 1 })
    render(<ApplyBanner />)
    expect(screen.getByText('1 tag en attente')).toBeInTheDocument()
  })

  it('(c) button shows "Écriture…" and is disabled while isApplying', () => {
    setStoreState({ isApplying: true })
    render(<ApplyBanner />)
    const btn = screen.getByRole('button', { name: 'Écriture…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('(c) button is disabled when pendingWriteCount=0 (nothing to apply)', () => {
    setStoreState({ pendingWriteCount: 0, applyResult: { totalWritten: 2, totalFailed: 0 } })
    render(<ApplyBanner />)
    const btn = screen.getByRole('button', { name: 'Appliquer (0)' })
    expect(btn).toBeDisabled()
  })

  it('(d) clicking the button calls applyWrites on the store', () => {
    const applyWrites = vi.fn().mockResolvedValue(undefined)
    useTaggerStore.setState({
      pendingWriteCount: 2,
      applyWrites
    } as Partial<ReturnType<typeof useTaggerStore.getState>>)

    render(<ApplyBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer (2)' }))
    expect(applyWrites).toHaveBeenCalledOnce()
  })

  it('(e) shows Écrit badge for ok:true writeResults entries', () => {
    const writeResults = new Map<string, { ok: boolean; error?: string }>([
      ['/m/a.mp3', { ok: true }]
    ])
    setStoreState({ writeResults, applyResult: { totalWritten: 1, totalFailed: 0 } })
    render(<ApplyBanner />)
    expect(screen.getByText('Écrit')).toBeInTheDocument()
    expect(screen.getByText('a.mp3')).toBeInTheDocument()
  })

  it('(e) shows Erreur badge + error text for ok:false writeResults entries', () => {
    const writeResults = new Map<string, { ok: boolean; error?: string }>([
      ['/m/b.mp3', { ok: false, error: 'write failed' }]
    ])
    setStoreState({ writeResults, applyResult: { totalWritten: 0, totalFailed: 1 } })
    render(<ApplyBanner />)
    expect(screen.getByText('Erreur')).toBeInTheDocument()
    expect(screen.getByText('b.mp3')).toBeInTheDocument()
    expect(screen.getByText('write failed')).toBeInTheDocument()
  })

  it('(e) shows "N écrits, N erreurs" summary from applyResult', () => {
    setStoreState({ applyResult: { totalWritten: 3, totalFailed: 1 } })
    render(<ApplyBanner />)
    expect(screen.getByText('3 écrits, 1 erreurs')).toBeInTheDocument()
  })

  it('(e) shows mixed Écrit + Erreur badges for multiple writeResults', () => {
    const writeResults = new Map<string, { ok: boolean; error?: string }>([
      ['/m/ok.mp3', { ok: true }],
      ['/m/fail.mp3', { ok: false, error: 'disk full' }]
    ])
    setStoreState({
      writeResults,
      applyResult: { totalWritten: 1, totalFailed: 1 }
    })
    render(<ApplyBanner />)
    const badges = screen.getAllByText(/^(Écrit|Erreur)$/)
    expect(badges).toHaveLength(2)
    expect(screen.getByText('disk full')).toBeInTheDocument()
  })

  it('renders when isApplying=true even if pendingWriteCount=0 (write in progress)', () => {
    setStoreState({ isApplying: true })
    const { container } = render(<ApplyBanner />)
    expect(container.firstChild).not.toBeNull()
  })

  it('shows applyError as an alert when present', () => {
    setStoreState({
      applyResult: null,
      applyError: 'connexion perdue',
      pendingWriteCount: 2
    })
    render(<ApplyBanner />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('connexion perdue')
  })
})
