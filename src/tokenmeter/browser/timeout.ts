/**
 * Timeout wrapper for host SDK calls.
 * Used by directory resolution and session pagination so one slow
 * project never freezes the browser dialog.
 */

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (v) => {
        if (timer) clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        if (timer) clearTimeout(timer)
        reject(e)
      },
    )
  })
}
