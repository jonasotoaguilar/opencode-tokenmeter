/**
 * Unit suite for the pure footer line formatter (src/tokenmeter/footer.ts).
 *
 * Covers issue #24's footer contract:
 *  - default subset renders exactly `<input> in · <output> out`
 *  - independent metric selection: every subset renders in fixed order
 *    (total first, then in/out/reason/cache) and an empty subset is `""`
 *  - cache is the single combined metric (read + write summed upstream)
 *  - total uses the canonical cumulative spend (summed upstream)
 *  - the `numbers` preference picks compact magnitudes vs precise integers
 *  - the line never exceeds its width budget: predictable `…` truncation
 *    instead of wrapping or overflowing the host footer
 */
import { describe, expect, test } from "bun:test"
import { formatFooterLine } from "../src/tokenmeter/footer"
import type { FooterSettings } from "../src/tokenmeter/settings"
import type { SessionUsage } from "../src/tokenmeter/types"

const USAGE: SessionUsage = {
  cost: 0.01,
  input: 40000,
  output: 1000,
  reasoning: 800,
  cacheRead: 2000,
  cacheWrite: 100,
  total: 43900,
  cache: 2100,
}

const FOOTER = {
  enabled: true,
  input: true,
  output: true,
  reasoning: true,
  cache: true,
  total: true,
} as const satisfies FooterSettings

describe("formatFooterLine metric selection", () => {
  test("default subset renders only input and output", () => {
    const line = formatFooterLine(
      USAGE,
      { ...FOOTER, reasoning: false, cache: false, total: false },
      "compact",
      80,
    )
    expect(line).toBe("40K in · 1K out")
  })

  test("all metrics render in fixed order: total first, then in/out/reason/cache", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 80)
    expect(line).toBe("44K total · 40K in · 1K out · 800 reason · 2K cache")
  })

  test("each metric renders alone when it is the only one enabled", () => {
    const alone = (metric: keyof FooterSettings) =>
      formatFooterLine(
        USAGE,
        {
          ...FOOTER,
          input: false,
          output: false,
          reasoning: false,
          cache: false,
          total: false,
          [metric]: true,
        },
        "compact",
        80,
      )
    expect(alone("total")).toBe("44K total")
    expect(alone("input")).toBe("40K in")
    expect(alone("output")).toBe("1K out")
    expect(alone("reasoning")).toBe("800 reason")
    expect(alone("cache")).toBe("2K cache")
  })

  test("an empty metric subset renders the empty string", () => {
    const line = formatFooterLine(
      USAGE,
      {
        ...FOOTER,
        input: false,
        output: false,
        reasoning: false,
        cache: false,
        total: false,
      },
      "compact",
      80,
    )
    expect(line).toBe("")
  })

  test("subset selection is independent: any combination is reachable", () => {
    const withSubset = (
      flags: Partial<Record<keyof FooterSettings, boolean>>,
    ) => formatFooterLine(USAGE, { ...FOOTER, ...flags }, "compact", 80)
    expect(
      withSubset({
        total: true,
        input: false,
        output: false,
        reasoning: false,
        cache: false,
      }),
    ).toBe("44K total")
    expect(withSubset({ reasoning: true, cache: true, total: false })).toBe(
      "40K in · 1K out · 800 reason · 2K cache",
    )
    expect(withSubset({ output: false, cache: false })).toBe(
      "44K total · 40K in · 800 reason",
    )
  })
})

describe("formatFooterLine values and number modes", () => {
  test("cache is the single combined read+write metric", () => {
    const line = formatFooterLine(
      USAGE,
      {
        ...FOOTER,
        input: false,
        output: false,
        reasoning: false,
        total: false,
      },
      "compact",
      80,
    )
    // cache = cacheRead + cacheWrite = 2000 + 100 = 2100 -> 2K
    expect(line).toBe("2K cache")
  })

  test("total is the canonical cumulative spend input+output+reasoning+cache.read+cache.write", () => {
    // 40000 + 1000 + 800 + 2000 + 100 = 43900 (usage.total), rendered 44K.
    const line = formatFooterLine(
      USAGE,
      {
        ...FOOTER,
        input: false,
        output: false,
        reasoning: false,
        cache: false,
      },
      "compact",
      80,
    )
    expect(line).toBe("44K total")
  })

  test("precise numbers mode renders thousands-separated integers", () => {
    const line = formatFooterLine(USAGE, FOOTER, "precise", 80)
    expect(line).toBe(
      "43,900 total · 40,000 in · 1,000 out · 800 reason · 2,100 cache",
    )
  })

  test("the enabled flag does not affect the line (the component gates on it)", () => {
    const line = formatFooterLine(
      USAGE,
      { ...FOOTER, enabled: false },
      "compact",
      80,
    )
    expect(line).toBe("44K total · 40K in · 1K out · 800 reason · 2K cache")
  })
})

describe("formatFooterLine width safety", () => {
  test("returns the full line when it fits", () => {
    expect(formatFooterLine(USAGE, FOOTER, "compact", 100)).toBe(
      "44K total · 40K in · 1K out · 800 reason · 2K cache",
    )
  })

  test("truncates predictably with an ellipsis when the line overflows", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 20)
    expect(line.length).toBeLessThan(
      "44K total · 40K in · 1K out · 800 reason · 2K cache".length,
    )
    expect(line.endsWith("…")).toBe(true)
  })

  test("never exceeds the width budget at any width", () => {
    for (let width = 0; width <= 60; width += 1) {
      const line = formatFooterLine(USAGE, FOOTER, "compact", width)
      expect([...line].length).toBeLessThanOrEqual(Math.max(0, width))
    }
  })

  test("an empty subset stays empty at any width", () => {
    for (let width = 0; width <= 30; width += 1) {
      const line = formatFooterLine(
        USAGE,
        {
          ...FOOTER,
          input: false,
          output: false,
          reasoning: false,
          cache: false,
          total: false,
        },
        "compact",
        width,
      )
      expect(line).toBe("")
    }
  })
})
