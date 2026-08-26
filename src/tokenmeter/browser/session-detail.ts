import { resolveCost } from "../math"
import { loadPricing } from "../pricing"
import { truncateToColumns } from "../text"
import { fallbackTotals } from "./session-fallback"
import { curSID, fetchInfo, numTokens, type toInfo } from "./session-info"
import { fetchMsgs, modelOf, provOf, shortLabel } from "./session-messages"
import { discoverTree } from "./session-tree"
import type { BrowserApi } from "./types"

export type ModelGroup = {
  modelID: string
  shortLabel: string
  cost: number
  context: number
  count: number
}

export type ProviderGroup = {
  providerID: string
  cost: number
  context: number
  count: number
  models: ModelGroup[]
}

export type SessionDetail = {
  id: string
  projectID: string
  title?: string
  label: string
  time: { created: number; updated: number }
  lastActive: number
  isCurrent: boolean
  usage: {
    context: number
    cost: number
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    cache: number
  }
  providers: ProviderGroup[]
  messageCount: number
  currentSessionID: string | null
}

const num = numTokens

export async function loadSessionDetail(
  api: BrowserApi,
  sid: string,
): Promise<SessionDetail> {
  if (!sid || typeof sid !== "string") throw new Error("Unable to load session")
  try {
    await loadPricing(api as unknown as Parameters<typeof loadPricing>[0])
  } catch {}
  const info = await fetchInfo(api, sid)
  const cur = curSID(api)
  const isCurrent = sid === cur
  const created = info?.time.created ?? 0,
    updated = info?.time.updated ?? created,
    base = updated || created
  const labelRaw = info?.title?.trim() ? info!.title!.trim() : sid
  const label = truncateToColumns(labelRaw, 40)
  let tree: string[] = [sid]
  try {
    tree = await discoverTree(api, sid)
  } catch {
    tree = [sid]
  }
  let last = base
  const infos = new Map<string, ReturnType<typeof toInfo>>()
  if (info) infos.set(sid, info)
  for (const id of tree)
    if (id !== sid)
      try {
        const inf = await fetchInfo(api, id)
        if (inf) {
          infos.set(id, inf)
          const la = inf.time.updated || inf.time.created
          if (la > last) last = la
        }
      } catch {}
  const all: unknown[] = []
  for (const id of tree) {
    const ms = await fetchMsgs(api, id)
    for (const m of ms) all.push(m)
  }
  let ctx = 0,
    cost = 0,
    inp = 0,
    out = 0,
    rea = 0,
    cr = 0,
    cw = 0,
    msgC = 0
  const pm = new Map<
    string,
    {
      cost: number
      context: number
      count: number
      models: Map<string, { cost: number; context: number; count: number }>
    }
  >()
  for (const raw of all) {
    const m = raw as Record<string, unknown>
    if (m?.role !== "assistant") continue
    const tk = (m.tokens ?? {}) as Record<string, unknown>,
      ch = (tk.cache ?? {}) as Record<string, unknown>
    const i = num(tk.input),
      o = num(tk.output),
      r = num(tk.reasoning),
      a = num(ch.read),
      b = num(ch.write)
    if (i + o + r + a + b === 0 && num(m.cost) === 0) continue
    const pr = provOf(m),
      mo = modelOf(m)
    const res = resolveCost({
      cost: num(m.cost),
      providerID:
        pr === "unknown"
          ? ((m.providerID ??
              (m.model as Record<string, unknown> | undefined)?.providerID) as
              | string
              | undefined)
          : pr,
      modelID:
        mo === "unknown"
          ? ((m.modelID ??
              (m.model as Record<string, unknown> | undefined)?.id) as
              | string
              | undefined)
          : mo,
      tokens: {
        input: i,
        output: o,
        reasoning: r,
        cacheRead: a,
        cacheWrite: b,
      },
    }).cost
    const c = i + o + r + a + b
    ctx += c
    cost += res
    inp += i
    out += o
    rea += r
    cr += a
    cw += b
    msgC++
    let g = pm.get(pr)
    if (!g) {
      g = { cost: 0, context: 0, count: 0, models: new Map() }
      pm.set(pr, g)
    }
    g.cost += res
    g.context += c
    g.count++
    let mg = g.models.get(mo)
    if (!mg) {
      mg = { cost: 0, context: 0, count: 0 }
      g.models.set(mo, mg)
    }
    mg.cost += res
    mg.context += c
    mg.count++
  }
  if (ctx === 0 && cost === 0) {
    const fb = await fallbackTotals(api, tree, infos, last)
    if (fb) {
      ctx = fb.ctx
      cost = fb.cost
      inp = fb.inp
      out = fb.out
      rea = fb.rea
      cr = fb.cr
      cw = fb.cw
      msgC = fb.msgC
      last = fb.last
    }
  }
  const cache = cr + cw
  const providers: ProviderGroup[] = [...pm.entries()]
    .map(([providerID, g]) => ({
      providerID,
      cost: g.cost,
      context: g.context,
      count: g.count,
      models: [...g.models.entries()]
        .map(([modelID, v]) => ({
          modelID,
          shortLabel: shortLabel(modelID),
          cost: v.cost,
          context: v.context,
          count: v.count,
        }))
        .sort(
          (a, b) =>
            b.cost - a.cost ||
            b.context - a.context ||
            a.modelID.localeCompare(b.modelID),
        ),
    }))
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        b.context - a.context ||
        a.providerID.localeCompare(b.providerID),
    )
  return {
    id: sid,
    projectID: info?.projectID ?? "",
    title: info?.title,
    label,
    time: { created, updated },
    lastActive: last,
    isCurrent,
    usage: {
      context: ctx,
      cost,
      input: inp,
      output: out,
      reasoning: rea,
      cacheRead: cr,
      cacheWrite: cw,
      cache,
    },
    providers,
    messageCount: msgC,
    currentSessionID: cur,
  }
}
