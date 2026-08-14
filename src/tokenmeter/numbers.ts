/**
 * Numeric display formatting for the TokenMeter sidebar: compact token
 * magnitudes, thousands-separated integers and fixed two-decimal cost
 * strings. Pure — no I/O, no state.
 * Aggregation lives in math.ts; this module only shapes numbers for display.
 */

/**
 * Compact token format for the corrected-contract metric lines. Keeps each
 * value at most six columns (`999.9M`, `1000K`) so the labeled lines stay
 * within the sidebar's content width at every realistic magnitude.
 * Whole-number thousands drop the decimal that the removed `fmtTokens`
 * carried. Magnitudes are UPPERCASE (`152K`, `10M`) per the corrected
 * formatting contract.
 */
export function fmtCompact(n: number): string {
  if (n >= 1e6) {
    const scaled = (n / 1e6).toFixed(1)
    return `${scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled}M`
  }
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return `${Math.round(n)}`
}

/**
 * Precise token format: thousands-separated integers (`1234567` → `1,234,567`),
 * the `numbers=precise` counterpart to the compact magnitudes above. Rounds
 * fractional raw values to whole tokens; non-finite input collapses to `0`
 * so a stray NaN never renders into the panel.
 */
export function fmtPrecise(n: number): string {
  if (!Number.isFinite(n)) return "0"
  const digits = String(Math.round(Math.abs(n)))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return n < 0 ? `-${grouped}` : grouped
}

/**
 * Cost formatting is ALWAYS exactly two decimals (`$0.00`, `$0.01`, `$1.09`):
 * the three/four-decimal precision variants were removed so headline,
 * Project and group costs all render the same fixed-width shape. Sub-cent
 * values round to the nearest cent; negative/NaN/zero collapse to `$0.00`.
 */
export function fmtCost(cost: number): string {
  if (!(cost > 0)) return "$0.00"
  return `$${(Math.round((cost + 1e-9) * 100) / 100).toFixed(2)}`
}
