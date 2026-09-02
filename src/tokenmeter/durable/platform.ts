/**
 * Cross-platform path primitives for durable storage.
 * Pure and injectable: every input (platform, path) is explicit so tests
 * can inject win32 behavior without touching the real filesystem.
 */

import { posix, win32 } from "node:path"

export function isAbsoluteForPlatform(p: string, platform: string): boolean {
  return platform === "win32" ? win32.isAbsolute(p) : posix.isAbsolute(p)
}

export function normalizeForPlatform(p: string, platform: string): string {
  return platform === "win32" ? win32.normalize(p) : posix.normalize(p)
}

export function joinForPlatform(platform: string, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : posix.join(...parts)
}

export function stripTrailingSep(p: string): string {
  return p.replace(/[/\\]+$/, "")
}

export function isRootForPlatform(p: string, platform: string): boolean {
  const norm = normalizeForPlatform(p, platform)
  const stripped = stripTrailingSep(norm)
  if (platform === "win32") {
    const parsed = win32.parse(norm)
    if (
      parsed.root !== "" &&
      (stripped === stripTrailingSep(parsed.root) ||
        stripped.toLowerCase() === stripTrailingSep(parsed.root).toLowerCase())
    )
      return true
    if (/^[a-zA-Z]:\.?$/.test(stripped)) return true
    return false
  }
  return posix.parse(norm).root === norm || stripped === "" || stripped === "/"
}

export function isSafeForPlatform(
  dir: string,
  platform: string,
  homedirVal: string | null,
): boolean {
  if (typeof dir !== "string") return false
  const t = dir.trim()
  if (!t) return false
  if (!isAbsoluteForPlatform(t, platform)) return false
  if (isRootForPlatform(t, platform)) return false
  if (homedirVal) {
    const hdNorm = stripTrailingSep(normalizeForPlatform(homedirVal, platform))
    const tNorm = stripTrailingSep(normalizeForPlatform(t, platform))
    const hdCmp = platform === "win32" ? hdNorm.toLowerCase() : hdNorm
    const tCmp = platform === "win32" ? tNorm.toLowerCase() : tNorm
    if (tCmp === hdCmp) return false
  }
  return true
}
