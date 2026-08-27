import { resolveCost } from "../math"
import { numTokens } from "./session-info"
import type { BrowserApi } from "./types"

const num = numTokens

export async function fallbackTotals(
  api: BrowserApi,
  tree: string[],
  infos: Map<
    string,
    {
      tokens: unknown
      cost: unknown
      model: unknown
      time: { created: number; updated: number }
    } | null
  >,
  last: number,
): Promise<{
  ctx: number
  cost: number
  inp: number
  out: number
  rea: number
  cr: number
  cw: number
  msgC: number
  last: number
} | null> {
  let pi = 0,
    po = 0,
    pr2 = 0,
    pcr = 0,
    pcw = 0,
    pcost = 0,
    pcnt = 0
  let updatedLast = last
  if (infos.size > 0) {
    for (const inf of infos.values()) {
      const t = (inf?.tokens ?? {}) as Record<string, unknown>,
        ch = (t.cache ?? {}) as Record<string, unknown>
      const i = num(t.input),
        o = num(t.output),
        r = num(t.reasoning),
        a = num(ch.read),
        b = num(ch.write)
      const c = i + o + r + a + b
      if (c === 0 && num(inf?.cost) === 0) continue
      const res = resolveCost({
        cost: num(inf?.cost),
        providerID: (inf?.model as Record<string, unknown> | undefined)
          ?.providerID as string | undefined,
        modelID: (inf?.model as Record<string, unknown> | undefined)?.id as
          | string
          | undefined,
        tokens: {
          input: i,
          output: o,
          reasoning: r,
          cacheRead: a,
          cacheWrite: b,
        },
      }).cost
      pi += i
      po += o
      pr2 += r
      pcr += a
      pcw += b
      pcost += res
      pcnt++
    }
  } else
    try {
      const lf = (
        api.client as unknown as {
          session?: { list?: (p: Record<string, unknown>) => Promise<unknown> }
        }
      ).session?.list
      if (typeof lf === "function") {
        const res = (await lf.call(api.client.session, {})) as {
          data?: unknown
        }
        const arr = (res as { data?: unknown })?.data as
          | Record<string, unknown>[]
          | undefined
        if (Array.isArray(arr))
          for (const id of tree) {
            const f = arr.find((x) => x.id === id) as
              | Record<string, unknown>
              | undefined
            if (!f) continue
            const t = (f.tokens ?? {}) as Record<string, unknown>,
              ch = (t.cache ?? {}) as Record<string, unknown>
            const i = num(t.input),
              o = num(t.output),
              r = num(t.reasoning),
              a = num(ch.read),
              b = num(ch.write)
            const c = i + o + r + a + b
            if (c === 0 && num(f.cost) === 0) continue
            const res = resolveCost({
              cost: num(f.cost),
              providerID: (f.model as Record<string, unknown> | undefined)
                ?.providerID as string | undefined,
              modelID: (f.model as Record<string, unknown> | undefined)?.id as
                | string
                | undefined,
              tokens: {
                input: i,
                output: o,
                reasoning: r,
                cacheRead: a,
                cacheWrite: b,
              },
            }).cost
            pi += i
            po += o
            pr2 += r
            pcr += a
            pcw += b
            pcost += res
            pcnt++
            const la =
              num((f.time as Record<string, unknown> | undefined)?.updated) ||
              num((f.time as Record<string, unknown> | undefined)?.created)
            if (la > updatedLast) updatedLast = la
          }
      }
    } catch {}
  if (pcnt === 0) return null
  return {
    ctx: pi + po + pr2 + pcr + pcw,
    cost: pcost,
    inp: pi,
    out: po,
    rea: pr2,
    cr: pcr,
    cw: pcw,
    msgC: pcnt,
    last: updatedLast,
  }
}
