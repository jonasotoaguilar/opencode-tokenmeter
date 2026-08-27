/**
 * Shared dialog helpers for the browser.
 * Provides Overview rows, ISO dates, file existence checks and
 * the common dialog-row shape used by all browser panels.
 */

import { existsSync } from "node:fs"
import { formatDetailLines } from "../format-detail"
import { settings } from "../settings"
import { NAV } from "./constants"

export type DialogRow = {
  title: string
  value: string
  description?: string
  category?: string
  disabled?: boolean
}

export function iso(n: number): string {
  try {
    return new Date(n).toISOString().slice(0, 10)
  } catch {
    return "—"
  }
}

export function dirExists(p: string): boolean {
  try {
    return existsSync(p)
  } catch {
    return false
  }
}

export function overviewRows(usage: {
  context: number
  cost: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}): Array<DialogRow> {
  const view = {
    context: usage.context,
    cost: usage.cost,
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  }
  const cache = settings().cache
  const numbers = settings().numbers
  const lines = formatDetailLines(view as never, { cache, numbers }, 100)
  const vals =
    numbers === "precise"
      ? ["__total", "__input", "__output", "__reason", "__cache"]
      : ["__total", "__io", "__cache"]
  return lines.map((line, i) => ({
    title: line.map((s) => s.text).join(""),
    value: vals[i] ?? `__ov${i}`,
    category: "Overview",
  }))
}

export const navCategory = NAV
