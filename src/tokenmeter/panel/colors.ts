/**
 * Fixed semantic colors that must survive any host theme.
 *
 * The spend coin+number is coin gold by design contract (DESIGN.md): the
 * rest of the UI stays theme-driven, but a GUARANTEED gold identity cannot
 * ride theme().accent — different hosts map accent to different hues.
 * OpenTUI fg accepts hex strings directly, so this single exported literal
 * is the one source of truth for the spend color.
 */
export const SPEND_GOLD = "#D4AF37"
