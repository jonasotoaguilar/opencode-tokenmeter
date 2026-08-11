/**
 * Column-aware text helpers and sidebar-width resolution for the TokenMeter
 * panel, modeled on the opencode-subagent-statusline reference pattern.
 *
 * Wide/combining codepoints count as real terminal columns and every line is
 * truncated to the content width, so the terminal can never wrap mid-word.
 * Width comes from the sidebar_content slot context, never from
 * useTerminalDimensions() (that hook measures the whole terminal).
 */
const ELLIPSIS = "…"

function isCombiningCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
  )
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return 0
  if (
    codePoint === 0 ||
    codePoint < 32 ||
    (codePoint >= 127 && codePoint < 160)
  )
    return 0
  if (codePoint === 0x200d || isCombiningCodePoint(codePoint)) return 0
  return isWideCodePoint(codePoint) ? 2 : 1
}

export function textColumns(value: string): number {
  let columns = 0
  for (const character of value) columns += characterWidth(character)
  return columns
}

export function takeColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return ""
  let columns = 0
  let result = ""
  for (const character of value) {
    const width = characterWidth(character)
    if (columns + width > maxColumns) break
    columns += width
    result += character
  }
  return result
}

export function truncateToColumns(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return ""
  if (textColumns(value) <= maxColumns) return value
  if (maxColumns <= textColumns(ELLIPSIS)) return ELLIPSIS
  return `${takeColumns(value, maxColumns - textColumns(ELLIPSIS)).trimEnd()}${ELLIPSIS}`
}

export const FALLBACK_SIDEBAR_WIDTH = 38
export const MIN_SIDEBAR_WIDTH = 24
export const MAX_SIDEBAR_WIDTH = 52

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined

const positiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined

/** Width chain from the sidebar_content slot ctx: width → columns → cols → size → viewport → bounds. */
export function resolveSidebarWidth(ctx: unknown): number | undefined {
  const source = asRecord(ctx)
  if (!source) return undefined
  const direct =
    positiveInt(source.width) ??
    positiveInt(source.columns) ??
    positiveInt(source.cols)
  if (direct) return direct
  const size = asRecord(source.size)
  const viewport = asRecord(source.viewport)
  const bounds = asRecord(source.bounds)
  return (
    positiveInt(size?.width) ??
    positiveInt(viewport?.width) ??
    positiveInt(bounds?.width)
  )
}

/** Fallback 38 (realistic for this host layout), clamped to the useful 24–52 range. */
export function clampSidebarWidth(width: number | undefined): number {
  const resolved = width ?? FALLBACK_SIDEBAR_WIDTH
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(resolved, MAX_SIDEBAR_WIDTH))
}

/** Usable columns inside the panel after a one-column host margin. */
export function contentWidth(sidebarWidth: number): number {
  return Math.max(10, Math.floor(sidebarWidth) - 2)
}
