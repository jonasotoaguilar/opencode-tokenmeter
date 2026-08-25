import { createHash } from "node:crypto"
import { estimateCost, pricingKey } from "./pricing"
import { computeFingerprint } from "./session-totals"
import type { FinitePrice } from "./types"
export const PRICING_REPAIR_BATCH_SIZE = 8
export const PRICING_REPAIR_CONCURRENCY = 1
export function computePricingHash(pricing: Map<string, FinitePrice>): string {
  const keys = [...pricing.keys()].map((k) => k.toLowerCase()).sort()
  const payload = keys
    .map((k) => {
      let p: FinitePrice | undefined
      for (const [o, v] of pricing) if (o.toLowerCase() === k) p = v
      return p
        ? `${k}:${p.input}:${p.output}:${p.cache.read}:${p.cache.write}`
        : `${k}:0:0:0:0`
    })
    .join("|")
  return createHash("sha256").update(payload).digest("hex")
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}
function isOpenAI(p: unknown): boolean {
  return typeof p === "string" && p.trim().toLowerCase() === "openai"
}
export type TotalsResult = {
  costReported: number
  costEstimated: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cache: number
  context: number
  fingerprint: string
}
export function totalsFromMessages(
  messages: Array<{
    id?: string
    role?: string
    cost?: number
    providerID?: string
    modelID?: string
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: { read?: number; write?: number }
    }
  }>,
  pricing: Map<string, FinitePrice>,
): TotalsResult {
  let costReported = 0,
    costEstimated = 0,
    input = 0,
    output = 0,
    reasoning = 0,
    cacheRead = 0,
    cacheWrite = 0
  const fp: Array<{
    id: string
    cost: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }> = []
  for (const m of messages ?? []) {
    if (m.role !== "assistant") continue
    const t = m.tokens ?? {}
    const i = num(t.input),
      o = num(t.output),
      r = num(t.reasoning),
      cr = num(t.cache?.read),
      cw = num(t.cache?.write)
    const raw = num(m.cost)
    let cost = 0,
      src: "reported" | "estimated" = "reported"
    if (raw !== 0) cost = raw
    else if (i + o + r + cr + cw > 0 && isOpenAI(m.providerID)) {
      const key = pricingKey(m.providerID, m.modelID)
      const price = key ? pricing.get(key) : undefined
      if (price) {
        const est = estimateCost(
          { input: i, output: o, reasoning: r, cacheRead: cr, cacheWrite: cw },
          price,
        )
        if (Number.isFinite(est) && est > 0) {
          cost = est
          src = "estimated"
        }
      }
    }
    if (cost + i + o + r + cr + cw === 0) continue
    input += i
    output += o
    reasoning += r
    cacheRead += cr
    cacheWrite += cw
    if (src === "reported") costReported += cost
    else costEstimated += cost
    if (m.id)
      fp.push({
        id: m.id,
        cost,
        input: i,
        output: o,
        reasoning: r,
        cacheRead: cr,
        cacheWrite: cw,
      })
  }
  return {
    costReported,
    costEstimated,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    cache: cacheRead + cacheWrite,
    context: input + output + reasoning + cacheRead + cacheWrite,
    fingerprint: computeFingerprint(fp),
  }
}
export function shouldScheduleRepair(r: {
  ok: boolean
  reason?: string
}): boolean {
  return !r.ok && r.reason === "conflict"
}
export function isEmptyOrTruncated(
  m: unknown[] | null | undefined,
  _s: unknown,
): boolean {
  return !m || !Array.isArray(m) || m.length === 0
}
export function selectPricingRepairCandidates<
  T extends {
    isDeleted: boolean
    costEstimated: number
    pricingVersion: string
  },
>(rows: T[], hash: string): T[] {
  return rows.filter(
    (r) => !r.isDeleted && r.costEstimated > 0 && r.pricingVersion !== hash,
  )
}
export function nextRepairBatch<T>(
  c: T[],
  o: number,
  s = PRICING_REPAIR_BATCH_SIZE,
): T[] {
  return c.slice(o, o + s)
}
export function createRepairQueue(): {
  generation: number
  queued: Set<string>
  enqueue(id: string): { wasNew: boolean; generation: number }
  dequeueBatch(limit: number): string[]
} {
  let gen = 0
  const q = new Set<string>()
  return {
    get generation() {
      return gen
    },
    queued: q,
    enqueue(id: string) {
      if (q.has(id)) return { wasNew: false, generation: gen }
      q.add(id)
      gen += 1
      return { wasNew: true, generation: gen }
    },
    dequeueBatch(l: number) {
      const b = [...q].slice(0, l)
      for (const id of b) q.delete(id)
      return b
    },
  }
}
