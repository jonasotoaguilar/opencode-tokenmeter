/** Durable paths outside host state — pure injectable for tests. */
import { realpathSync } from "node:fs"
import { homedir as osHomedir } from "node:os"
import {
  isAbsoluteForPlatform,
  isRootForPlatform,
  isSafeForPlatform,
  joinForPlatform,
  normalizeForPlatform,
  stripTrailingSep,
} from "./platform"

export type DurablePathOpts = {
  env?: Record<string, string | undefined>
  platform?: string
  homedir?: string
  dataDir?: string
}

function safeHomedir(opts?: DurablePathOpts): string | null {
  if (opts?.homedir !== undefined) return opts.homedir || null
  try {
    const hd = osHomedir()
    return hd || null
  } catch {
    return null
  }
}

export function resolveDurableDir(opts?: DurablePathOpts): string | null {
  const env = opts?.env ?? (process.env as Record<string, string | undefined>)
  const platform = opts?.platform ?? process.platform
  const override = opts?.dataDir ?? env.TOKENMETER_DURABLE_DIR
  if (override && typeof override === "string" && override.trim()) {
    const t = override.trim()
    if (!isAbsoluteForPlatform(t, platform)) return null
    const cand = stripTrailingSep(normalizeForPlatform(t, platform))
    const normCand = platform === "win32" ? cand.toLowerCase() : cand
    if (!isSafeForPlatform(cand, platform, safeHomedir(opts))) return null
    // Best-effort realpath for canonical, fallback to normalized
    let finalCand: string = cand
    if (platform !== "win32") {
      try {
        const real = realpathSync(cand)
        if (real) finalCand = stripTrailingSep(real)
      } catch {}
    } else {
      finalCand = normCand
    }
    return finalCand
  }
  const hd = safeHomedir(opts)

  if (platform === "win32") {
    const appData = env.APPDATA
    if (
      appData &&
      appData.trim() &&
      isAbsoluteForPlatform(appData.trim(), platform)
    ) {
      const cand = joinForPlatform(
        platform,
        appData.trim(),
        "opencode-tokenmeter",
      )
      if (isSafeForPlatform(cand, platform, hd)) return cand
    }
    const localApp = env.LOCALAPPDATA
    if (
      localApp &&
      localApp.trim() &&
      isAbsoluteForPlatform(localApp.trim(), platform)
    ) {
      const cand = joinForPlatform(
        platform,
        localApp.trim(),
        "opencode-tokenmeter",
      )
      if (isSafeForPlatform(cand, platform, hd)) return cand
    }
    if (hd) {
      const cand = joinForPlatform(
        platform,
        hd,
        "AppData",
        "Roaming",
        "opencode-tokenmeter",
      )
      if (isSafeForPlatform(cand, platform, hd)) return cand
    }
    return null
  }

  if (platform === "darwin") {
    if (hd) {
      const cand = joinForPlatform(
        platform,
        hd,
        "Library",
        "Application Support",
        "opencode-tokenmeter",
      )
      if (isSafeForPlatform(cand, platform, hd)) return cand
    }
    const home = env.HOME
    if (home && home.trim() && isAbsoluteForPlatform(home.trim(), platform)) {
      const cand = joinForPlatform(
        platform,
        home.trim(),
        "Library",
        "Application Support",
        "opencode-tokenmeter",
      )
      if (isSafeForPlatform(cand, platform, hd)) return cand
    }
    return null
  }

  const xdg = env.XDG_DATA_HOME
  if (
    xdg &&
    typeof xdg === "string" &&
    xdg.trim() &&
    isAbsoluteForPlatform(xdg.trim(), platform)
  ) {
    const cand = joinForPlatform(platform, xdg.trim(), "opencode-tokenmeter")
    if (isSafeForPlatform(cand, platform, hd)) return cand
  }
  if (hd) {
    const cand = joinForPlatform(
      platform,
      hd,
      ".local",
      "share",
      "opencode-tokenmeter",
    )
    if (isSafeForPlatform(cand, platform, hd)) return cand
  }
  const home = env.HOME
  if (home && home.trim() && isAbsoluteForPlatform(home.trim(), platform)) {
    const cand = joinForPlatform(
      platform,
      home.trim(),
      ".local",
      "share",
      "opencode-tokenmeter",
    )
    if (isSafeForPlatform(cand, platform, hd)) return cand
  }
  return null
}

export function durableDbPath(opts?: DurablePathOpts): string | null {
  const dir = resolveDurableDir(opts)
  if (!dir) return null
  const platform = opts?.platform ?? process.platform
  return joinForPlatform(platform, dir, "checkpoints.sqlite")
}

export function normalizeAlias(raw: unknown, platform?: string): string {
  if (typeof raw !== "string") return ""
  const plat = platform ?? process.platform
  const t = raw.trim()
  if (!t) return ""
  if (!isAbsoluteForPlatform(t, plat)) return ""
  let norm = normalizeForPlatform(t, plat)
  norm = stripTrailingSep(norm)
  if (!norm) return ""
  if (isRootForPlatform(norm, plat)) return ""
  try {
    const hd = osHomedir()
    if (hd) {
      const hdNorm = stripTrailingSep(normalizeForPlatform(hd, plat))
      const cmpNorm = plat === "win32" ? norm.toLowerCase() : norm
      const cmpHd = plat === "win32" ? hdNorm.toLowerCase() : hdNorm
      if (cmpNorm === cmpHd) return ""
    }
  } catch {}
  if (plat !== "win32") {
    try {
      const real = realpathSync(norm)
      if (real) norm = stripTrailingSep(real)
    } catch {}
  } else {
    norm = norm.toLowerCase()
  }
  if (!norm) return ""
  if (isRootForPlatform(norm, plat)) return ""
  return norm
}

export function durableDbPathForTest(dir: string): string | null {
  return durableDbPath({ dataDir: dir })
}
