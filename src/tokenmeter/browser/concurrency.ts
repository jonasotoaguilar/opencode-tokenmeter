/**
 * Bounded concurrency helper.
 * Limits parallel project probes to BROWSER_CONCURRENCY so the host
 * is not flooded when browsing many projects.
 */

export async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
  let idx = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = idx++
        if (i >= items.length) break
        const item = items[i]
        if (item === undefined) break
        try {
          await fn(item, i)
        } catch {
          // per-project isolation, caller decides handling
        }
      }
    },
  )
  await Promise.all(workers)
}
