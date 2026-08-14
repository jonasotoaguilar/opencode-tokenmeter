/**
 * Plugin-owned settings model for the TokenMeter sidebar.
 *
 * Mirrors `project.ts`: a small store-like module owning signals plus
 * persistence, with no render logic. One versioned kv object
 * (`tokenmeter.settings.v1`) holds exactly the three object-backed
 * preferences — `cache`, `numbers`, `collapsedSummary` — written as a whole
 * three-field object on every change. The fourth user-facing preference,
 * `subagents`, lives in the pre-existing `tokenmeter.sidebar.expanded` key
 * (its durable source of truth) and is never duplicated inside
 * `settings.v1`. The unshipped legacy view field is gone; the sanitizer
 * ignores any stale value a pre-change build may have stored.
 *
 * Durable writes are gated on `api.kv.ready`: when the kv store is not
 * ready the in-memory value still updates for the session, no write is
 * issued, and `persisted()` flips to `false` so callers never claim
 * durability they do not have.
 */
import { createSignal } from "solid-js"

export type CachePref = "combined" | "separated"
export type NumbersPref = "compact" | "precise"
export type CollapsedSummaryPref = "session" | "project"
export type SubagentsPref = "collapsed" | "expanded"

export type Settings = {
  cache: CachePref
  numbers: NumbersPref
  collapsedSummary: CollapsedSummaryPref
}

/** Versioned single-key kv object for the three object-backed preferences. */
export const SETTINGS_KV_KEY = "tokenmeter.settings.v1"

/**
 * Durable source for the Subagents preference; retained existing persisted
 * state (never duplicated inside `settings.v1`).
 */
export const SUBAGENTS_KV_KEY = "tokenmeter.sidebar.expanded"

export const DEFAULT_SETTINGS: Settings = {
  cache: "combined",
  numbers: "compact",
  collapsedSummary: "session",
}

/** The kv surface settings needs; a structural subset of the plugin TuiKV. */
export type SettingsApi = {
  kv: {
    get<Value = unknown>(key: string, fallback?: Value): Value
    set(key: string, value: unknown): void
    readonly ready: boolean
  }
}

const [settings, setSettings] = createSignal<Settings>({
  ...DEFAULT_SETTINGS,
})

/** Subagents durable state: `true` (expanded) or `false` (collapsed). */
const [subagentsExpanded, setSubagentsExpanded] = createSignal(false)

/**
 * Reports whether the last preference write was durably persisted. Starts
 * `true`; a write dropped by the kv readiness gate flips it to `false` (the
 * muted `· session only` cue) and a later successful write flips it back.
 */
const [persisted, setPersisted] = createSignal(true)

// Read accessors only: mutations go through the `cycle*` writers so every
// change is gated on `api.kv.ready` and never bypasses persistence.
export { persisted, settings }

const isCachePref = (v: unknown): v is CachePref =>
  v === "combined" || v === "separated"
const isNumbersPref = (v: unknown): v is NumbersPref =>
  v === "compact" || v === "precise"
const isCollapsedSummaryPref = (v: unknown): v is CollapsedSummaryPref =>
  v === "session" || v === "project"

/**
 * Resolves an unknown stored value to a valid Settings object: a missing or
 * non-object value yields all defaults; within an object, unknown enum
 * values (including an invalid `collapsedSummary`) fall back per field
 * while valid overrides are honored. A stale legacy view field is ignored
 * (the field was never shipped). Never throws and never produces NaN.
 */
function sanitizeSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS }
  const candidate = raw as Record<string, unknown>
  return {
    cache: isCachePref(candidate.cache)
      ? candidate.cache
      : DEFAULT_SETTINGS.cache,
    numbers: isNumbersPref(candidate.numbers)
      ? candidate.numbers
      : DEFAULT_SETTINGS.numbers,
    collapsedSummary: isCollapsedSummaryPref(candidate.collapsedSummary)
      ? candidate.collapsedSummary
      : DEFAULT_SETTINGS.collapsedSummary,
  }
}

/** The Subagents preference in its user-facing domain. */
export function subagentsPref(): SubagentsPref {
  return subagentsExpanded() ? "expanded" : "collapsed"
}

/**
 * Loads and sanitizes both durable sources once at startup: the
 * three-field `settings.v1` object and the `sidebar.expanded` boolean.
 * Absent or malformed values resolve to their defaults.
 */
export function loadSettings(api: SettingsApi): void {
  setSettings(sanitizeSettings(api.kv.get<unknown>(SETTINGS_KV_KEY, null)))
  setSubagentsExpanded(api.kv.get<boolean>(SUBAGENTS_KV_KEY, false) === true)
  setPersisted(true)
}

/**
 * Writes the full three-field settings object, gated on `api.kv.ready`. A
 * dropped write leaves the in-memory value intact but reports
 * `persisted() === false`; a successful write reports `true`.
 */
function writeObject(api: SettingsApi): void {
  if (!api.kv.ready) {
    setPersisted(false)
    return
  }
  api.kv.set(SETTINGS_KV_KEY, settings())
  setPersisted(true)
}

/** Writes only the Subagents durable key, gated on `api.kv.ready`. */
function writeSubagents(api: SettingsApi, value: boolean): void {
  if (!api.kv.ready) {
    setPersisted(false)
    return
  }
  api.kv.set(SUBAGENTS_KV_KEY, value)
  setPersisted(true)
}

/**
 * Cycles `collapsedSummary` session -> project -> session.
 */
export function cycleCollapsedSummary(api: SettingsApi): void {
  const next: CollapsedSummaryPref =
    settings().collapsedSummary === "session" ? "project" : "session"
  setSettings({ ...settings(), collapsedSummary: next })
  writeObject(api)
}

/** Cycles `cache` combined -> separated -> combined. */
export function cycleCache(api: SettingsApi): void {
  const next: CachePref =
    settings().cache === "combined" ? "separated" : "combined"
  setSettings({ ...settings(), cache: next })
  writeObject(api)
}

/** Cycles `numbers` compact -> precise -> compact. */
export function cycleNumbers(api: SettingsApi): void {
  const next: NumbersPref =
    settings().numbers === "compact" ? "precise" : "compact"
  setSettings({ ...settings(), numbers: next })
  writeObject(api)
}

/** Cycles Subagents collapsed -> expanded -> collapsed (sidebar key only). */
export function cycleSubagents(api: SettingsApi): void {
  const next = !subagentsExpanded()
  setSubagentsExpanded(next)
  writeSubagents(api, next)
}
