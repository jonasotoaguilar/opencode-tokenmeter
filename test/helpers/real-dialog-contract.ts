// Real dialog contract harness — faithful to packages/tui/src/ui/dialog.tsx
// Both replace and clear invoke previous onClose before mutating.
// biome-ignore-all lint/suspicious/noExplicitAny: harness uses host types

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { clearPricing } from "../../src/tokenmeter/pricing"
import {
  __setPricingFetchForTest,
  clearRemotePricing,
} from "../../src/tokenmeter/pricing-remote"

export function ensureGit(p: string): void {
  try {
    mkdirSync(join(p, ".git"), { recursive: true })
  } catch {}
}

export function stubPricing(): void {
  try {
    clearPricing()
    clearRemotePricing()
    __setPricingFetchForTest(
      (async () =>
        ({
          ok: true,
          json: async () => ({}),
        }) as unknown as Response) as unknown as typeof fetch,
    )
  } catch {}
}

export function hostRealContract() {
  type S = { render: () => unknown; onClose?: () => void }
  let stack: S[] = []
  let rc = 0
  let cc = 0
  let oc = 0
  let cap: unknown = null
  const dlg = {
    replace(r: () => unknown, c?: () => void) {
      const prev = [...stack]
      for (const it of prev) {
        if (it.onClose) {
          oc++
          try {
            it.onClose()
          } catch {}
        }
      }
      rc++
      stack = [{ render: r, onClose: c }]
    },
    clear() {
      const prev = [...stack]
      const had = prev.length > 0
      for (const it of prev) {
        if (it.onClose) {
          oc++
          try {
            it.onClose()
          } catch {}
        }
      }
      stack = []
      if (had) cc++
    },
    get depth() {
      return stack.length
    },
    get open() {
      return stack.length > 0
    },
  } as unknown as Record<string, unknown>
  const capture = (p: unknown) => {
    cap = p
    return null as unknown
  }
  const get = () => {
    const first = stack[0]
    if (!first) throw new Error("no render")
    ;(first.render as () => unknown)()
    const v = cap
    cap = null
    return v as {
      title: string
      options: Array<{ title: string; value: string; category?: string }>
      onSelect?: (v: unknown) => void
    }
  }
  return {
    dlg,
    capture: capture as (p: unknown) => unknown,
    get,
    rc: () => rc,
    cc: () => cc,
    oc: () => oc,
    stack: () => stack,
  }
}
