/**
 * Unit suite for the plugin-owned settings model (src/tokenmeter/settings.ts).
 *
 * Covers the tokenmeter-settings spec:
 *  - defaults apply when nothing is persisted (combined/compact/session/collapsed)
 *  - malformed or missing values resolve to per-field safe defaults; valid
 *    overrides are honored; no throw, no NaN; the stale legacy view field
 *    is ignored
 *  - `settings.v1` holds exactly the three object fields `cache`/`numbers`/
 *    `collapsedSummary`, never `subagents` or the legacy view field
 *  - cycling object preferences writes the whole three-field object exactly
 *    once per change when `api.kv.ready`; cycling Subagents writes only
 *    `tokenmeter.sidebar.expanded`; when not ready the value updates in
 *    memory only and persistence is not claimed (`persisted() === false`)
 *
 * The kv store is faked (map-backed) so every write is observable: each
 * `kv.set` call is recorded with key and value, and a fresh `loadSettings`
 * over the same store proves durable read-back.
 */
import { describe, expect, test } from "bun:test"
import type { SettingsApi } from "../src/tokenmeter/settings"
import {
  cycleCache,
  cycleCollapsedSummary,
  cycleNumbers,
  cycleSubagents,
  loadSettings,
  persisted,
  SETTINGS_KV_KEY,
  SUBAGENTS_KV_KEY,
  settings,
  subagentsPref,
} from "../src/tokenmeter/settings"

type SetCall = { key: string; value: unknown }

type FakeKv = { kv: SettingsApi["kv"]; sets: SetCall[] }

function makeKv(initial: Record<string, unknown> = {}, ready = true): FakeKv {
  const store = new Map<string, unknown>(Object.entries(initial))
  const sets: SetCall[] = []
  return {
    kv: {
      ready,
      get<Value = unknown>(key: string, fallback?: Value): Value {
        return (store.has(key) ? store.get(key) : fallback) as Value
      },
      set(key: string, value: unknown) {
        sets.push({ key, value })
        store.set(key, value)
      },
    },
    sets,
  }
}

const apiOf = (fake: FakeKv): SettingsApi => ({ kv: fake.kv })

const DEFAULTS = {
  cache: "combined",
  numbers: "compact",
  collapsedSummary: "session",
} as const

describe("settings defaults and sanitization", () => {
  test("applies all defaults when nothing is persisted", () => {
    const api = apiOf(makeKv())
    loadSettings(api)
    expect(settings()).toEqual(DEFAULTS)
    expect(subagentsPref()).toBe("collapsed")
    expect(Object.keys(settings()).sort()).toEqual([
      "cache",
      "collapsedSummary",
      "numbers",
    ])
    expect(persisted()).toBe(true)
  })

  test("resolves a non-object string value to all defaults", () => {
    const api = apiOf(makeKv({ [SETTINGS_KV_KEY]: "garbage" }))
    loadSettings(api)
    expect(settings()).toEqual(DEFAULTS)
    expect(subagentsPref()).toBe("collapsed")
  })

  test("resolves a null value to all defaults without throwing", () => {
    const api = apiOf(makeKv({ [SETTINGS_KV_KEY]: null }))
    expect(() => loadSettings(api)).not.toThrow()
    expect(settings()).toEqual(DEFAULTS)
  })

  test("resolves unknown enums per field and honors valid overrides", () => {
    const api = apiOf(
      makeKv({
        [SETTINGS_KV_KEY]: {
          collapsedSummary: "other",
          cache: 42,
          numbers: "precise",
        },
      }),
    )
    loadSettings(api)
    expect(settings()).toEqual({
      cache: "combined",
      numbers: "precise",
      collapsedSummary: "session",
    })
    expect(settings().numbers).not.toBeNaN()
  })

  test("ignores a stale legacy view field and resolves the remaining fields", () => {
    // The unshipped legacy view preference never made it into `settings.v1`;
    // the sanitizer drops any unknown field, so a stale value from a
    // pre-change build is ignored. (4.3 sweep: the fixture uses a generic
    // stale key — the unshipped field name is gone from the codebase.)
    const api = apiOf(
      makeKv({
        [SETTINGS_KV_KEY]: {
          legacyView: "detailed",
          cache: "separated",
        },
      }),
    )
    loadSettings(api)
    expect(settings()).toEqual({
      cache: "separated",
      numbers: "compact",
      collapsedSummary: "session",
    })
    expect(Object.keys(settings())).not.toContain("legacyView")
  })

  test("honors valid overrides and defaults absent fields", () => {
    const api = apiOf(
      makeKv({
        [SETTINGS_KV_KEY]: {
          cache: "separated",
          collapsedSummary: "project",
        },
      }),
    )
    loadSettings(api)
    expect(settings()).toEqual({
      cache: "separated",
      numbers: "compact",
      collapsedSummary: "project",
    })
  })

  test("resolves subagents to expanded only when the key stores true", () => {
    const api = apiOf(makeKv({ [SUBAGENTS_KV_KEY]: true }))
    loadSettings(api)
    expect(subagentsPref()).toBe("expanded")
  })

  test("resolves a malformed subagents key to collapsed", () => {
    const api = apiOf(makeKv({ [SUBAGENTS_KV_KEY]: "yes" }))
    loadSettings(api)
    expect(subagentsPref()).toBe("collapsed")
  })
})

describe("settings cycling and kv persistence", () => {
  test("cycles cache combined -> separated -> combined, one whole-object write each", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleCache(api)
    expect(settings().cache).toBe("separated")
    expect(fake.sets).toEqual([
      {
        key: SETTINGS_KV_KEY,
        value: {
          cache: "separated",
          numbers: "compact",
          collapsedSummary: "session",
        },
      },
    ])

    cycleCache(api)
    expect(settings().cache).toBe("combined")
    expect(fake.sets).toHaveLength(2)
    expect(fake.sets[1]).toEqual({
      key: SETTINGS_KV_KEY,
      value: {
        cache: "combined",
        numbers: "compact",
        collapsedSummary: "session",
      },
    })
  })

  test("each object write carries the full three-field object including earlier changes", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleCollapsedSummary(api)
    cycleNumbers(api)
    expect(fake.sets[1]).toEqual({
      key: SETTINGS_KV_KEY,
      value: {
        cache: "combined",
        numbers: "precise",
        collapsedSummary: "project",
      },
    })
  })

  test("a ready cycle reports persisted and the next mount reads the new value", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleCache(api)
    expect(persisted()).toBe(true)

    loadSettings(api)
    expect(settings().cache).toBe("separated")
  })

  test("subagents cycles write only the sidebar.expanded key, never settings.v1", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleSubagents(api)
    expect(subagentsPref()).toBe("expanded")
    expect(fake.sets).toEqual([{ key: SUBAGENTS_KV_KEY, value: true }])

    cycleSubagents(api)
    expect(subagentsPref()).toBe("collapsed")
    expect(fake.sets).toEqual([
      { key: SUBAGENTS_KV_KEY, value: true },
      { key: SUBAGENTS_KV_KEY, value: false },
    ])
    expect(fake.sets.every((set) => set.key === SUBAGENTS_KV_KEY)).toBe(true)
  })

  test("object prefs cycle in their fixed domain order", () => {
    const api = apiOf(makeKv())
    loadSettings(api)
    cycleCollapsedSummary(api)
    expect(settings().collapsedSummary).toBe("project")
    cycleCollapsedSummary(api)
    expect(settings().collapsedSummary).toBe("session")
    cycleNumbers(api)
    expect(settings().numbers).toBe("precise")
    cycleNumbers(api)
    expect(settings().numbers).toBe("compact")
  })

  test("not-ready cycles update memory only and report persisted=false", () => {
    const fake = makeKv({}, false)
    const api = apiOf(fake)
    loadSettings(api)
    expect(persisted()).toBe(true)

    cycleCache(api)
    expect(settings().cache).toBe("separated")
    expect(persisted()).toBe(false)
    expect(fake.sets).toEqual([])

    cycleSubagents(api)
    expect(subagentsPref()).toBe("expanded")
    expect(persisted()).toBe(false)
    expect(fake.sets).toEqual([])
  })
})
