/**
 * Group summaries for the TokenMeter sidebar.
 *
 * Aggregates ALL descendant session usage into stable per-agent groups so
 * repeated runs of the same agent (for example two sdd-apply sessions)
 * collapse into a single group. Each group total sums one context snapshot
 * per session (max observed); cost and the input/output/reasoning/cache
 * breakdowns are cumulative sums and stay separate, with RAW output and RAW
 * reasoning preserved independently (never merged) — the displayed output
 * real (output + reasoning) is computed at the formatting boundary, exactly
 * once, so no reasoning token is ever counted twice.
 *
 * Groups are ordered by CONTEXT total descending (the heaviest consumers of
 * context on top); cost, runs and then name only break ties, in that order,
 * so the ordering is stable and deterministic.
 */

import { sumMessages } from "./math"
import { hasUsage, usageMap } from "./store"
import { getSessionAgent } from "./tree"
import type { GroupSummary } from "./types"

export type RunningOf = (sessionID: string) => boolean

export function buildGroups(
  ids: string[],
  rootID: string,
  runningOf: RunningOf,
): GroupSummary[] {
  const byName = new Map<string, GroupSummary>()
  for (const sid of ids) {
    if (sid === rootID) continue
    const name = getSessionAgent(sid)
    let group = byName.get(name)
    if (!group) {
      group = {
        name,
        runs: 0,
        running: 0,
        cost: 0,
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: 0,
      }
      byName.set(name, group)
    }
    group.runs += 1
    if (runningOf(sid)) group.running += 1
    if (!hasUsage(sid)) continue
    const s = sumMessages(usageMap(sid))
    group.cost += s.cost
    group.total += s.total
    group.input += s.input
    group.output += s.output
    group.reasoning += s.reasoning
    group.cache += s.cache
  }
  // Context total descending; cost, runs and name are stable tiebreakers.
  return [...byName.values()].sort(
    (a, b) =>
      b.total - a.total ||
      b.cost - a.cost ||
      b.runs - a.runs ||
      a.name.localeCompare(b.name),
  )
}
