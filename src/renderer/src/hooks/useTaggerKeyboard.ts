import { useEffect } from 'react'

/**
 * Document-level keyboard handler for the Tagger view.
 *
 *   ←          → onKeep
 *   →          → onSkip
 *   1-9        → onPreset(n)
 *   Cmd/Ctrl-Z → onUndo
 *   Space      → onPlayPause
 *   M / m      → onMute
 *
 * INPUT-FOCUS GATE (LOCKED): when document.activeElement is a text input
 * (input, textarea, or contentEditable), ALL shortcuts are ignored — typing
 * "1" in the BPM field must NOT trigger preset 1.
 */
export interface TaggerKeyboardActions {
  onKeep: () => void
  onSkip: () => void
  onUndo: () => void
  onPlayPause: () => void
  onMute: () => void
  onPreset: (slot: number) => void
}

function isTextInput(el: Element | null): boolean {
  if (el === null) return false
  if (el instanceof HTMLInputElement) return true
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return false
}

export function useTaggerKeyboard(actions: TaggerKeyboardActions): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isTextInput(document.activeElement)) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        actions.onKeep()
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        actions.onSkip()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        actions.onUndo()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        actions.onPlayPause()
        return
      }
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault()
        actions.onMute()
        return
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        actions.onPreset(Number(e.key))
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [actions])
}
