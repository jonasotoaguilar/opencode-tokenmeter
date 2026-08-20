/**
 * Unit suite for the plugin-owned settings model (src/tokenmeter/settings.ts).
 *
 * Covers the tokenmeter-settings spec:
 *  - defaults apply when nothing is persisted (combined/compact/session,
 *    footer on with input+output enabled and reasoning/cache/total disabled)
 *  - malformed or missing values resolve to per-field safe defaults; valid
 *    overrides are honored; no throw, no NaN; the stale legacy view field
 *    is ignored
 *  - `settings.v1` holds exactly the object fields `cache`/`numbers`/
 *    `collapsedSummary`/`footer`, never `subagents` or the legacy view field
 *  - cycling object preferences writes the whole object exactly once per
 *    change when `api.kv.ready`; footer flags toggle independently; cycling
 *    Subagents writes only `tokenmeter.sidebar.expanded`; when not ready the
 *    value updates in memory only and persistence is not claimed
 *    (`persisted() === false`)
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
  cycleFooter,
  cycleFooterMetric,
  cycleNumbers,
  cycleSubagents,
  DEFAULT_FOOTER,
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
  footer: { ...DEFAULT_FOOTER },
  milestones: true,
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
      "footer",
      "milestones",
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
    expect(settings()).toEqual({ ...DEFAULTS, numbers: "precise" })
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
    expect(settings()).toEqual({ ...DEFAULTS, cache: "separated" })
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
      ...DEFAULTS,
      cache: "separated",
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
      { key: SETTINGS_KV_KEY, value: { ...DEFAULTS, cache: "separated" } },
    ])

    cycleCache(api)
    expect(settings().cache).toBe("combined")
    expect(fake.sets).toHaveLength(2)
    expect(fake.sets[1]).toEqual({
      key: SETTINGS_KV_KEY,
      value: { ...DEFAULTS },
    })
  })

  test("each object write carries the full object including earlier changes", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleCollapsedSummary(api)
    cycleNumbers(api)
    expect(fake.sets[1]).toEqual({
      key: SETTINGS_KV_KEY,
      value: { ...DEFAULTS, numbers: "precise", collapsedSummary: "project" },
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

describe("footer settings (defaults, sanitization, independent toggles)", () => {
  test("defaults: footer enabled with input+output on and the rest off", () => {
    const api = apiOf(makeKv())
    loadSettings(api)
    expect(settings().footer).toEqual({
      enabled: true,
      input: true,
      output: true,
      reasoning: false,
      cache: false,
      total: false,
    })
  })

  test("a missing or non-object footer value resolves to all footer defaults", () => {
    const api = apiOf(makeKv({ [SETTINGS_KV_KEY]: { cache: "separated" } }))
    loadSettings(api)
    expect(settings().footer).toEqual(DEFAULT_FOOTER)

    const api2 = apiOf(makeKv({ [SETTINGS_KV_KEY]: { footer: "yes" } }))
    loadSettings(api2)
    expect(settings().footer).toEqual(DEFAULT_FOOTER)
  })

  test("sanitizes each footer flag per field and honors valid overrides", () => {
    const api = apiOf(
      makeKv({
        [SETTINGS_KV_KEY]: {
          footer: {
            enabled: false,
            input: "yes",
            output: false,
            reasoning: true,
            cache: 1,
            total: false,
          },
        },
      }),
    )
    loadSettings(api)
    expect(settings().footer).toEqual({
      enabled: false,
      input: true, // malformed input falls back to the default
      output: false,
      reasoning: true,
      cache: false, // malformed cache falls back to the default
      total: false,
    })
  })

  test("cycleFooter toggles the master switch and persists the whole object", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleFooter(api)
    expect(settings().footer.enabled).toBe(false)
    expect(settings().footer.input).toBe(true)
    expect(fake.sets).toEqual([
      {
        key: SETTINGS_KV_KEY,
        value: {
          cache: "combined",
          numbers: "compact",
          collapsedSummary: "session",
          footer: { ...DEFAULT_FOOTER, enabled: false },
          milestones: true,
        },
      },
    ])

    cycleFooter(api)
    expect(settings().footer.enabled).toBe(true)
    expect(persisted()).toBe(true)

    loadSettings(api)
    expect(settings().footer.enabled).toBe(true)
  })

  test("cycleFooterMetric toggles ONE metric independently, leaving the rest intact", () => {
    const fake = makeKv()
    const api = apiOf(fake)
    loadSettings(api)

    cycleFooterMetric(api, "reasoning")
    expect(settings().footer.reasoning).toBe(true)
    expect(settings().footer.input).toBe(true)
    expect(settings().footer.total).toBe(false)
    expect(fake.sets).toHaveLength(1)
    expect(fake.sets[0].value).toEqual({
      cache: "combined",
      numbers: "compact",
      collapsedSummary: "session",
      footer: { ...DEFAULT_FOOTER, reasoning: true },
      milestones: true,
    })

    cycleFooterMetric(api, "input")
    expect(settings().footer.input).toBe(false)
    expect(settings().footer.reasoning).toBe(true)
    expect(fake.sets).toHaveLength(2)

    // Any subset is reachable: total alone.
    cycleFooterMetric(api, "total")
    cycleFooterMetric(api, "output")
    expect(settings().footer).toEqual({
      enabled: true,
      input: false,
      output: false,
      reasoning: true,
      cache: false,
      total: true,
    })

    loadSettings(api)
    expect(settings().footer.total).toBe(true)
  })

  test("footer cycles are ready-gated like the other preferences", () => {
    const fake = makeKv({}, false)
    const api = apiOf(fake)
    loadSettings(api)

    cycleFooter(api)
    cycleFooterMetric(api, "cache")
    expect(settings().footer.enabled).toBe(false)
    expect(settings().footer.cache).toBe(true)
    expect(persisted()).toBe(false)
    expect(fake.sets).toEqual([])
  })
})
