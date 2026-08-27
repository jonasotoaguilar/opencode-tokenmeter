/**
 * Safe directory check for cross-project browsing.
 * Rejects filesystem roots and the user's home directory so the
 * browser never triggers host plugin loads for "/" or similar.
 */

import { homedir } from "node:os"
import { parse } from "node:path"

export function isSafeDirectory(dir: unknown): boolean {
  if (typeof dir !== "string") return false
  const t = dir.trim()
  if (!t) return false
  if (t === "/") return false
  try {
    const hd = homedir()
    if (hd) {
      const norm = (s: string): string => s.replace(/\/+$/, "")
      if (norm(t) === norm(hd)) return false
    }
  } catch {
    // homedir unavailable in test stubs
  }
  try {
    if (parse(t).root === t) return false
  } catch {
    // parse failure treated as unsafe
  }
  return true
}
