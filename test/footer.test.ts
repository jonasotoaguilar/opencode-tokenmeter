/**
 * Unit suite for the pure footer line formatter (src/tokenmeter/footer.ts).
 *
 * Covers issue #24's footer contract + compact metric icons:
 *  - default subset renders exactly input/output as icon-first `↑`/`↓`
 *  - independent metric selection: every subset renders in fixed order
 *    (total first, then in/out/reason/cache) and an empty subset is `""`
 *  - cache is the single combined metric (read + write summed upstream) or
 *    its percentage when `cache=percentage` (cache/total*100, 0% when total 0)
 *  - total uses the canonical cumulative spend (summed upstream) with `Σ`
 *  - the `numbers` preference picks compact magnitudes vs precise integers
 *  - the line never exceeds its width budget: predictable `…` truncation
 *  - footer icons are exactly the specified glyphs; total icon `Σ` is the
 *    chosen project plain-Unicode sum glyph
 */
import { describe, expect, test } from "bun:test"
import { FOOTER_ICONS, formatFooterLine } from "../src/tokenmeter/footer"
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
  test("default subset renders only input and output as icons", () => {
    const line = formatFooterLine(
      USAGE,
      { ...FOOTER, reasoning: false, cache: false, total: false },
      "compact",
      80,
    )
    expect(line).toBe("↑40K · ↓1K")
  })

  test("all metrics render in fixed order: total first, then in/out/reason/cache with icons", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 80)
    expect(line).toBe("Σ 44K · ↑40K · ↓1K · 󰧑 800 · 󰆼 2K")
  })

  test("each metric renders alone when it is the only one enabled (icon shape)", () => {
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
    expect(alone("total")).toBe("Σ 44K")
    expect(alone("input")).toBe("↑40K")
    expect(alone("output")).toBe("↓1K")
    expect(alone("reasoning")).toBe("󰧑 800")
    expect(alone("cache")).toBe("󰆼 2K")
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

  test("subset selection is independent: any combination is reachable (icons)", () => {
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
    ).toBe("Σ 44K")
    expect(withSubset({ reasoning: true, cache: true, total: false })).toBe(
      "↑40K · ↓1K · 󰧑 800 · 󰆼 2K",
    )
    expect(withSubset({ output: false, cache: false })).toBe(
      "Σ 44K · ↑40K · 󰧑 800",
    )
  })
})

describe("formatFooterLine values and number modes", () => {
  test("cache is the single combined read+write metric (icon)", () => {
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
    expect(line).toBe("󰆼 2K")
  })

  test("total is the canonical cumulative spend input+output+reasoning+cache.read+cache.write (Σ)", () => {
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
    expect(line).toBe("Σ 44K")
  })

  test("precise numbers mode renders thousands-separated integers with icons", () => {
    const line = formatFooterLine(USAGE, FOOTER, "precise", 80)
    expect(line).toBe("Σ 43,900 · ↑40,000 · ↓1,000 · 󰧑 800 · 󰆼 2,100")
  })

  test("the enabled flag does not affect the line (the component gates on it)", () => {
    const line = formatFooterLine(
      USAGE,
      { ...FOOTER, enabled: false },
      "compact",
      80,
    )
    expect(line).toBe("Σ 44K · ↑40K · ↓1K · 󰧑 800 · 󰆼 2K")
  })

  test("footer icons are exactly the specified glyphs and total icon is Σ", () => {
    expect(FOOTER_ICONS.input).toBe("↑")
    expect(FOOTER_ICONS.output).toBe("↓")
    expect(FOOTER_ICONS.cache).toBe("󰆼")
    expect(FOOTER_ICONS.reasoning).toBe("󰧑")
    expect(FOOTER_ICONS.total).toBe("Σ")
  })
})

describe("formatFooterLine cache percentage mode", () => {
  test("cache percentage shows cache/total*100 rounded integer percent", () => {
    // 2100 / 43900 = 4.78% -> 5%
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
      "percentage",
    )
    expect(line).toBe("󰆼 5%")
  })

  test("cache percentage with total 0 is deterministically 0%", () => {
    const zeroTotal: SessionUsage = {
      cost: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 100,
      cacheWrite: 50,
      total: 0,
      cache: 150,
    }
    const line = formatFooterLine(
      zeroTotal,
      {
        ...FOOTER,
        input: false,
        output: false,
        reasoning: false,
        total: false,
      },
      "compact",
      80,
      "percentage",
    )
    expect(line).toBe("󰆼 0%")
  })

  test("cache percentage rounding and clamping", () => {
    const cases: Array<[SessionUsage, string]> = [
      // 50% exactly
      [
        {
          cost: 0,
          input: 50,
          output: 0,
          reasoning: 0,
          cacheRead: 50,
          cacheWrite: 0,
          total: 100,
          cache: 50,
        },
        "󰆼 50%",
      ],
      // 99.5% rounds to 100%
      [
        {
          cost: 0,
          input: 1,
          output: 0,
          reasoning: 0,
          cacheRead: 199,
          cacheWrite: 0,
          total: 200,
          cache: 199,
        },
        "󰆼 100%",
      ],
    ]
    for (const [usage, expected] of cases) {
      expect(
        formatFooterLine(
          usage,
          {
            ...FOOTER,
            input: false,
            output: false,
            reasoning: false,
            total: false,
          },
          "compact",
          80,
          "percentage",
        ),
      ).toBe(expected)
    }
  })

  test("percentage mode does not affect non-cache metrics and preserves order", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 80, "percentage")
    expect(line).toBe("Σ 44K · ↑40K · ↓1K · 󰧑 800 · 󰆼 5%")
  })
})

describe("formatFooterLine width safety", () => {
  test("returns the full line when it fits", () => {
    expect(formatFooterLine(USAGE, FOOTER, "compact", 100)).toBe(
      "Σ 44K · ↑40K · ↓1K · 󰧑 800 · 󰆼 2K",
    )
  })

  test("truncates predictably with an ellipsis when the line overflows", () => {
    const line = formatFooterLine(USAGE, FOOTER, "compact", 20)
    expect(line.length).toBeLessThan("Σ 44K · ↑40K · ↓1K · 󰧑 800 · 󰆼 2K".length)
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
