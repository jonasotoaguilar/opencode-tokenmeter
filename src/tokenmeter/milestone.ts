// Project milestone toasts: 10^6 powers, highest per refresh, silent baseline, per-project kv.
import { settings } from "./settings"
import type { ProjectUsage } from "./types"

export const MILESTONE_START_EXP = 6
export const MILESTONE_KV_KEY = "tokenmeter.milestones.v1"
const SUFFIX_BY_INDEX = ["", "K", "M", "B", "T", "P", "E", "Z", "Y"] as const
const seenProjects = new Set<string>()
let memoryMilestones: Record<string, number> = {}
export function resetMilestoneState(): void {
  seenProjects.clear()
  memoryMilestones = {}
}

export function milestoneExponentForTotal(total: number): number | null {
  if (!Number.isFinite(total) || total < 1_000_000) return null
  let exp = MILESTONE_START_EXP
  let best: number | null = null
  let pow = 1_000_000
  while (pow <= total) {
    best = exp
    exp += 1
    if (exp > 18) return total >= 1e18 ? 18 : best
    pow *= 10
    if (!Number.isFinite(pow)) break
  }
  return best
}

export function formatMilestone(exp: number): string {
  const suffix = SUFFIX_BY_INDEX[Math.floor(exp / 3)] ?? ""
  const coeff = exp % 3 === 0 ? "1" : exp % 3 === 1 ? "10" : "100"
  return `${coeff}${suffix}`
}
export function milestoneVariant(
  exp: number,
): "info" | "success" | "warning" | "error" {
  return exp <= 6
    ? "info"
    : exp === 7
      ? "success"
      : exp === 8
        ? "warning"
        : "error"
}
export function milestoneDuration(exp: number): number {
  return exp <= 6 ? 4500 : exp === 7 ? 5500 : exp === 8 ? 6500 : 7500
}
export function milestoneTitle(exp: number): string {
  if (exp <= 6) return "TokenMeter"
  if (exp === 7) return "TokenMeter ◆"
  if (exp === 8) return "TokenMeter ◆◆"
  return `TokenMeter ${"◆".repeat(Math.min(exp - 5, 5))}`
}

type MilestoneApi = {
  kv: {
    get<Value = unknown>(key: string, fallback?: Value): Value
    set(key: string, value: unknown): void
    readonly ready: boolean
  }
  ui: {
    toast(input: {
      title?: string
      message: string
      variant?: "info" | "success" | "warning" | "error"
      duration?: number
    }): void
  }
}

function sanitizeMilestoneMap(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      typeof k === "string" &&
      k &&
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= MILESTONE_START_EXP &&
      v <= 18
    )
      out[k] = v
  }
  return out
}
function loadMap(api: MilestoneApi): Record<string, number> {
  try {
    const sanitized = sanitizeMilestoneMap(
      api.kv.get<unknown>(MILESTONE_KV_KEY, null),
    )
    const merged: Record<string, number> = { ...memoryMilestones }
    for (const [k, v] of Object.entries(sanitized))
      merged[k] = Math.max(merged[k] ?? -1, v)
    memoryMilestones = merged
    return { ...merged }
  } catch {
    return { ...memoryMilestones }
  }
}
function saveMap(api: MilestoneApi, map: Record<string, number>): void {
  memoryMilestones = { ...map }
  if (!api.kv.ready) return
  try {
    api.kv.set(MILESTONE_KV_KEY, map)
  } catch {}
}

export function handleProjectMilestone(
  api: MilestoneApi,
  snapshot: ProjectUsage | null,
): void {
  if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id) return
  const total = snapshot.context
  if (!Number.isFinite(total)) return
  const currentExp = milestoneExponentForTotal(total)
  const projectID = snapshot.id
  if (currentExp === null) {
    seenProjects.add(projectID)
    return
  }
  const map = loadMap(api)
  const ackRaw = map[projectID]
  const acknowledged =
    typeof ackRaw === "number" &&
    Number.isInteger(ackRaw) &&
    ackRaw >= MILESTONE_START_EXP
      ? ackRaw
      : null
  if (acknowledged === null) {
    const isFirstEver = !seenProjects.has(projectID)
    seenProjects.add(projectID)
    map[projectID] = currentExp
    saveMap(api, map)
    if (isFirstEver) return
  } else {
    seenProjects.add(projectID)
    if (currentExp <= acknowledged) return
    map[projectID] = currentExp
    saveMap(api, map)
  }
  try {
    if (settings().milestones === false) return
  } catch {}
  const label = formatMilestone(currentExp)
  try {
    api.ui.toast({
      title: milestoneTitle(currentExp),
      message: `Project reached ${label} tokens`,
      variant: milestoneVariant(currentExp),
      duration: milestoneDuration(currentExp),
    })
  } catch {}
}
