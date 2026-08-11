# README icons — provenance

The six SVG files in this directory are the **exact vector outlines** of the
Nerd Font glyphs that TokenMeter renders in the sidebar, extracted from the
official Nerd Fonts source font — not redrawn, not approximations.

## Source font

| Field | Value |
| --- | --- |
| Font | `SymbolsNerdFont-Regular.ttf` (Symbols Nerd Font Regular) |
| Release | Nerd Fonts **v3.5.0** (`Version 001.000;Nerd Fonts 3.5.0`) |
| URL | https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.0/NerdFontsSymbolsOnly.zip |
| SHA-256 | see `extraction-evidence.txt` |
| Font license | MIT (Nerd Fonts, copyright (c) 2014 Ryan L McIntyre) |

Extraction method: `fonttools` `SVGPathPen` over the TrueType `glyf`
outlines. Font outlines are y-up; SVG is y-down, so every glyph is mirrored
with `TransformPen(1, 0, 0, -1, 0, 2*bboxCenterY)` — the path is the exact
font outline mirrored around its bounding-box center, which is the transform
a font rasterizer applies before display. The `viewBox` stays the glyph's
real bounding box (the mirror maps the box onto itself), so the shape renders
right-side up at any size. Orientation was verified by rasterizing each SVG
(librsvg) and the same glyphs directly from the font (FreeType/PIL — the
terminal's own display path): correlation 0.99+ with the font rendering and
clearly lower with the vertical mirror. Per-glyph evidence and path SHA-256:
`extraction-evidence.txt`.

## Codepoint → glyph mapping (Nerd Fonts 3.5.0 cmap)

| Codepoint (from `src/tokenmeter/glyphs.ts`) | Font glyph name | SVG file | Source icon set | Icon set license |
| --- | --- | --- | --- | --- |
| `U+EDE8` | `fa-coins` | `fa-coins.svg` | Font Awesome 6.5.1 | CC BY 4.0 |
| `U+EE9C` | `fa-brain` | `reasoning.svg` | Font Awesome 6.5.1 | CC BY 4.0 |
| `U+F0238` | `md-fire` | `md-fire.svg` | Material Design Icons | Apache 2.0 |
| `U+F472` | `oct-database` | `oct-database.svg` | Octicons 18.3.0 | MIT |
| `U+F06A9` | `md-robot` | `md-robot.svg` | Material Design Icons | Apache 2.0 |
| `U+E20F` | `fae-tools` | `tasks.svg` | Font Awesome Extension 0.0.3 | MIT |

`glyphs.ts` names the codepoints by their product semantics (`reasoning`,
`tasks`); the font's own cmap names at those codepoints in Nerd Fonts 3.5.0
are `fa-brain` and `fae-tools`.

## Colors — DESIGN.md reference values for the runtime semantic roles

GitHub renders the SVGs as external `<img>` elements, which cannot inherit
`currentColor`, so each icon carries a static hex. The hex values are the
**exact reference values from `DESIGN.md`** for the runtime semantic role
each icon renders. At runtime the plugin resolves every role from
`ctx.theme.current` (the host OpenCode theme) — the hexes here are the
documented reference swatches, not runtime values — with exactly ONE
exception: the spend coin (`SPEND_GOLD = #D4AF37`) is a fixed product
identity that is never theme-derived.

| SVG | Semantic role at runtime | Hex (exact DESIGN.md reference) |
| --- | --- | --- |
| `fa-coins.svg` | Token spend — `SPEND_GOLD`, **fixed** | `#D4AF37` |
| `reasoning.svg` | Thinking — `theme().accent` | `#F5BDE6` (active `catppuccin-macchiato` `macPink`) |
| `md-fire.svg` | Cost — `theme().error` | `#F87171` |
| `oct-database.svg` | Prompt cache — `theme().textMuted` | `#64748B` |
| `md-robot.svg` | Agents — `theme().primary` (robot icon and agent names, per DESIGN.md) | `#38BDF8` |
| `tasks.svg` | Delegations/runs — `theme().success` | `#4ADE80` |

These hex values are the DESIGN.md reference swatches; the sidebar at
runtime renders the theme-resolved colors, never these values.

## Divergence from distro-patched fonts

The installed distro Nerd Fonts (e.g. the pacman `ttf-jetbrains-mono-nerd`
package, "Nerd Fonts 3.5.0" name string) embed **different icon revisions**
for these codepoints — the outlines differ from the official Symbols font
even though the glyph names match. The SVGs here follow the official Nerd
Fonts source font, which is the canonical, reproducible reference.
