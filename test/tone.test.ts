/**
 * Unit suite for the panel tone derivation (src/tokenmeter/panel/tone.ts):
 * the final visual contract's hierarchy, derived theme-relatively through
 * the installed RGBA API — no arbitrary hex colors.
 *
 *  - `detailTone` blends the existing `textMuted` role 50% toward the
 *    active `background` — the dimmest readable detail tone used by the
 *    secondary metric rows and the task metadata;
 *  - `segmentTone` routes the primary token+cost row (lineIndex 0) to the
 *    main-text tone except the `spend` segment (light-red error tone) and
 *    every other row to the derived detail tone.
 */
import { describe, expect, test } from "bun:test"
import { RGBA, rgbToHex } from "@opentui/core"
import { detailTone, segmentTone } from "../src/tokenmeter/panel/tone"

const THEME = {
  text: RGBA.fromHex("#a8b4dc"),
  textMuted: RGBA.fromHex("#a9b1d6"),
  background: RGBA.fromHex("#16161e"),
  error: RGBA.fromHex("#ff4500"),
}

describe("detailTone — textMuted blended 50% toward the active background", () => {
  test("blends each channel toward the background, never hardcoded hex", () => {
    // textMuted (169, 177, 214) and background (22, 22, 30) average to
    // (95.5, 99.5, 122) → rounded (96, 100, 122) → #60647a.
    expect(rgbToHex(detailTone(() => THEME))).toBe("#60647a")
  })

  test("stays strictly dimmer than textMuted in every channel", () => {
    const [dr, dg, db] = detailTone(() => THEME).toInts()
    const [mr, mg, mb] = THEME.textMuted.toInts()
    expect(dr).toBeLessThan(mr)
    expect(dg).toBeLessThan(mg)
    expect(db).toBeLessThan(mb)
  })

  test("tracks the theme: a darker background yields an even dimmer tone", () => {
    const darker = { ...THEME, background: RGBA.fromHex("#000000") }
    const [dr, dg, db] = detailTone(() => darker).toInts()
    // textMuted (169, 177, 214) blended 50% toward black rounds to
    // (85, 89, 107).
    expect(rgbToHex(detailTone(() => darker))).toBe(
      rgbToHex(RGBA.fromInts(85, 89, 107)),
    )
    expect(dr).toBeLessThan(96)
    expect(dg).toBeLessThan(100)
    expect(db).toBeLessThan(122)
  })
})

describe("segmentTone — primary row white with light-red spend; secondary rows detail tone", () => {
  test("primary row: every segment renders main text except the spend", () => {
    expect(rgbToHex(segmentTone(() => THEME, 0, "tokens"))).toBe(
      rgbToHex(THEME.text),
    )
    expect(rgbToHex(segmentTone(() => THEME, 0, "label"))).toBe(
      rgbToHex(THEME.text),
    )
    expect(rgbToHex(segmentTone(() => THEME, 0, "sep"))).toBe(
      rgbToHex(THEME.text),
    )
    // The spend (full or `$…`-elided) keeps the light-red error tone.
    expect(rgbToHex(segmentTone(() => THEME, 0, "spend"))).toBe(
      rgbToHex(THEME.error),
    )
    expect(rgbToHex(segmentTone(() => THEME, 0, "spend"))).toBe(
      rgbToHex(THEME.error),
    )
  })

  test("secondary rows: every segment renders the derived detail tone", () => {
    for (const role of [
      "input",
      "output",
      "reasoning",
      "cache",
      "label",
      "sep",
    ]) {
      expect(rgbToHex(segmentTone(() => THEME, 1, role))).toBe(
        rgbToHex(detailTone(() => THEME)),
      )
      expect(rgbToHex(segmentTone(() => THEME, 2, role))).toBe(
        rgbToHex(detailTone(() => THEME)),
      )
    }
  })

  test("the derived tone equals the documented blend — never an arbitrary hex", () => {
    // The detail tone is exactly textMuted blended 50% toward background:
    // (169, 177, 214) + (22, 22, 30) → (96, 100, 122) → #60647a.
    expect(rgbToHex(segmentTone(() => THEME, 1, "input"))).toBe("#60647a")
    expect(rgbToHex(detailTone(() => THEME))).toBe("#60647a")
  })
})
