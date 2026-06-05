import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaggerKeyboard, type TaggerKeyboardActions } from './useTaggerKeyboard'

function makeActions(): TaggerKeyboardActions & {
  spies: Record<keyof TaggerKeyboardActions, ReturnType<typeof vi.fn>>
} {
  const spies = {
    onKeep: vi.fn(),
    onSkip: vi.fn(),
    onUndo: vi.fn(),
    onPlayPause: vi.fn(),
    onMute: vi.fn(),
    onPreset: vi.fn()
  }
  return { ...spies, spies }
}

function fire(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
}

describe('useTaggerKeyboard', () => {
  let actions: ReturnType<typeof makeActions>

  beforeEach(() => {
    actions = makeActions()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('ArrowLeft calls onKeep, ArrowRight calls onSkip', () => {
    renderHook(() => useTaggerKeyboard(actions))
    fire('ArrowLeft')
    fire('ArrowRight')
    expect(actions.spies.onKeep).toHaveBeenCalledTimes(1)
    expect(actions.spies.onSkip).toHaveBeenCalledTimes(1)
  })

  it('digits 1-9 call onPreset with the slot number', () => {
    renderHook(() => useTaggerKeyboard(actions))
    for (let n = 1; n <= 9; n += 1) fire(String(n))
    expect(actions.spies.onPreset).toHaveBeenCalledTimes(9)
    expect(actions.spies.onPreset).toHaveBeenNthCalledWith(1, 1)
    expect(actions.spies.onPreset).toHaveBeenNthCalledWith(9, 9)
  })

  it('Cmd+Z and Ctrl+Z call onUndo', () => {
    renderHook(() => useTaggerKeyboard(actions))
    fire('z', { metaKey: true })
    fire('z', { ctrlKey: true })
    expect(actions.spies.onUndo).toHaveBeenCalledTimes(2)
  })

  it('Space calls onPlayPause; m / M call onMute', () => {
    renderHook(() => useTaggerKeyboard(actions))
    fire(' ')
    fire('m')
    fire('M')
    expect(actions.spies.onPlayPause).toHaveBeenCalledTimes(1)
    expect(actions.spies.onMute).toHaveBeenCalledTimes(2)
  })

  it('ignores ALL shortcuts when activeElement is an HTMLInputElement', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useTaggerKeyboard(actions))
    fire('ArrowLeft')
    fire('ArrowRight')
    fire('1')
    fire('m')
    fire(' ')
    fire('z', { metaKey: true })
    expect(actions.spies.onKeep).not.toHaveBeenCalled()
    expect(actions.spies.onSkip).not.toHaveBeenCalled()
    expect(actions.spies.onPreset).not.toHaveBeenCalled()
    expect(actions.spies.onMute).not.toHaveBeenCalled()
    expect(actions.spies.onPlayPause).not.toHaveBeenCalled()
    expect(actions.spies.onUndo).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when activeElement is contentEditable', () => {
    // jsdom doesn't expose isContentEditable=true unless we force the prop.
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    Object.defineProperty(div, 'isContentEditable', {
      configurable: true,
      get: () => true
    })
    div.tabIndex = 0
    document.body.appendChild(div)
    div.focus()
    expect(document.activeElement).toBe(div)
    renderHook(() => useTaggerKeyboard(actions))
    fire('1')
    expect(actions.spies.onPreset).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useTaggerKeyboard(actions))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
