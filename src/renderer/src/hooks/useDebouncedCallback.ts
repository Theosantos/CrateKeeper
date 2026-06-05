import { useCallback, useEffect, useRef } from 'react'

/**
 * Stable debounced callback handle. Multiple call(...) within `delayMs` collapse
 * to a single invocation with the LAST args. flush() invokes immediately with
 * pending args; cancel() drops them.
 *
 * Returned object is stable across renders (methods are useCallback-wrapped).
 */
export interface DebouncedHandle<Args extends unknown[]> {
  call(...args: Args): void
  flush(): void
  cancel(): void
}

export function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number
): DebouncedHandle<Args> {
  const fnRef = useRef(fn)
  const argsRef = useRef<Args | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (argsRef.current !== null) {
      const a = argsRef.current
      argsRef.current = null
      fnRef.current(...a)
    }
  }, [])

  const cancel = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    argsRef.current = null
  }, [])

  const call = useCallback(
    (...args: Args): void => {
      argsRef.current = args
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const a = argsRef.current
        argsRef.current = null
        if (a !== null) fnRef.current(...a)
      }, delayMs)
    },
    [delayMs]
  )

  useEffect(() => () => cancel(), [cancel])

  return { call, flush, cancel }
}
