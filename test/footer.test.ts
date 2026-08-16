/**
 * Unit suite for the pure footer line formatter (src/tokenmeter/footer.ts).
 *
 * Covers issue #24's footer contract:
 *  - default subset renders exactly `in <input> · out <output>`
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
    expect(line).toBe("in 40K · out 1K")
  })

  test("all metrics render in fixed order: total first, then in/out/reason/cache", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 80)
    expect(line).toBe("total 44K · in 40K · out 1K · reason 800 · cache 2K")
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
    expect(alone("total")).toBe("total 44K")
    expect(alone("input")).toBe("in 40K")
    expect(alone("output")).toBe("out 1K")
    expect(alone("reasoning")).toBe("reason 800")
    expect(alone("cache")).toBe("cache 2K")
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
    ).toBe("total 44K")
    expect(withSubset({ reasoning: true, cache: true, total: false })).toBe(
      "in 40K · out 1K · reason 800 · cache 2K",
    )
    expect(withSubset({ output: false, cache: false })).toBe(
      "total 44K · in 40K · reason 800",
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
    expect(line).toBe("cache 2K")
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
    expect(line).toBe("total 44K")
  })

  test("precise numbers mode renders thousands-separated integers", () => {
    const line = formatFooterLine(USAGE, FOOTER, "precise", 80)
    expect(line).toBe(
      "total 43,900 · in 40,000 · out 1,000 · reason 800 · cache 2,100",
    )
  })

  test("the enabled flag does not affect the line (the component gates on it)", () => {
    const line = formatFooterLine(
      USAGE,
      { ...FOOTER, enabled: false },
      "compact",
      80,
    )
    expect(line).toBe("total 44K · in 40K · out 1K · reason 800 · cache 2K")
  })
})

describe("formatFooterLine width safety", () => {
  test("returns the full line when it fits", () => {
    expect(formatFooterLine(USAGE, FOOTER, "compact", 100)).toBe(
      "total 44K · in 40K · out 1K · reason 800 · cache 2K",
    )
  })

  test("truncates predictably with an ellipsis when the line overflows", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 20)
    expect(line.length).toBeLessThan(
      "total 44K · in 40K · out 1K · reason 800 · cache 2K".length,
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
