/**
 * Numeric display formatting for the TokenMeter sidebar: compact token
 * magnitudes and fixed two-decimal cost strings. Pure — no I/O, no state.
 * Aggregation lives in math.ts; this module only shapes numbers for display.
 */
export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

/**
 * Compact token format for the single-line four-value breakdown rows. Keeps
 * each value at most six columns (`999.9M`, `1000k`) so the rendered
 * input · output · reasoning · cache row stays within the design budget
 * (MIN_BREAKDOWN_WIDTH) at every realistic magnitude. Whole-number
 * thousands drop the decimal that fmtTokens would carry.
 */
export function fmtCompact(n: number): string {
  if (n >= 1e6) {
    const scaled = (n / 1e6).toFixed(1)
    return `${scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled}M`
  }
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return `${Math.round(n)}`
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
