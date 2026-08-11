# opencode-tokenmeter Codebase Guide

A concise navigational index for maintainers, contributors, and reviewers. Not an API reference, not a README replacement, not an architecture doc.

## Audience

| Role | What this guide gives them |
|------|---------------------------|
| **New contributor** | Where to start and which files to read first |
| **Maintainer** | Where each concern lives and the boundary rules |
| **Reviewer** | What belongs where and how to verify intent |

## Mental Model

opencode-tokenmeter is an event-driven TUI plugin: host events invalidate sessions, a debounced reconcile rehydrates usage from the authoritative client SDK, and a Solid snapshot signal repaints the sidebar panel in place — plus a plugin-owned SQLite store that keeps the Project deleted-session aggregate alive across deletions, restarts, and concurrent TUIs.

- [docs/codebase/mental-model.md](codebase/mental-model.md) — the foundational page: the full data flow (events → invalidation → reconcile → panel), the reading order, and the module dependencies.

## Golden Rule

Every file belongs to exactly one concern: the entry (`tokenmeter.tsx`) only wires events and the slot; pure helpers (`math`, `format`, `text`, `glyphs`, `types`) never touch I/O or state; `store` is the only in-memory state owner; `reconcile`/`tree`/`groups`/`project`/`db` are the only modules that call the client SDK, `api.kv` or the SQLite store. If a change crosses more than two of these layers, reconsider the design.

## Guide Pages

| Page | What it covers | Key files |
|------|---------------|-----------|
| [docs/codebase/mental-model.md](codebase/mental-model.md) | Foundational data flow and reading order | `src/tokenmeter.tsx`, `src/tokenmeter/reconcile.ts`, `src/tokenmeter/store.ts`, `src/tokenmeter/panel/index.tsx` |
| [src/tokenmeter.tsx](../src/tokenmeter.tsx) | Entry and event wiring: event subscriptions, kv state, slot registration | — |
| [src/tokenmeter/reconcile.ts](../src/tokenmeter/reconcile.ts) | Reactivity and reconciliation: debounced reconcile, rehydration, maintenance timer | `src/tokenmeter/store.ts` |
| [src/tokenmeter/tree.ts](../src/tokenmeter/tree.ts) | Delegation tree and groups: tree discovery, agent resolution, group summaries | `src/tokenmeter/groups.ts` |
| [src/tokenmeter/project.ts](../src/tokenmeter/project.ts) | Project section: live-list refresh with explicit limit and cap fail-closed, deleted aggregate, polling timer, error recovery | `src/tokenmeter/db.ts` |
| [src/tokenmeter/db.ts](../src/tokenmeter/db.ts) | Plugin-owned SQLite store: deleted-session aggregate per project + tombstone admission | `bun:sqlite`, `src/tokenmeter/math.ts` |
| [src/tokenmeter/panel/](../src/tokenmeter/panel/) | Rendering and layout: panel composition, metric rows, group rows, scrollbox | `index.tsx`, `group-rows.tsx`, `project-section.tsx` |
| [src/tokenmeter/math.ts](../src/tokenmeter/math.ts) | Pure helpers: usage math, numeric formatting, line formatting, column math, glyphs, types | `numbers.ts`, `format.ts`, `text.ts`, `glyphs.ts`, `types.ts` |
| [scripts/build.ts](../scripts/build.ts) | Build and artifact guard: bundled dist, reactive-binding assertion, dist test | `test/artifact.test.ts` |
| [test/harness.test.ts](../test/harness.test.ts) | Test suites: harness (modules), render (panel), artifact (dist) | `test/render.test.tsx`, `test/artifact.test.ts` |

## Recommended Reading Path

1. [docs/codebase/mental-model.md](codebase/mental-model.md) — the system in one flow.
2. [ARCHITECTURE.md](../ARCHITECTURE.md) — component details, failure invariants, ADRs.
3. [DESIGN.md](../DESIGN.md) — what the panel looks like and why.
4. The entry (`src/tokenmeter.tsx`), then follow one event end-to-end into `reconcile.ts` → `store.ts` → `panel/index.tsx`.

## Existing References

- `README.md` — install, usage, dev scripts, release overview.
- `PRD.md` — product intent, requirements, success criteria.
- `ARCHITECTURE.md` — system design, flows, module map, ADR links.
- `DESIGN.md` — panel layout, theme-role colors, glyphs, states.
- `docs/adr/` — architecture decision records (build, reconcile, kv, external packages, width).
- `docs/release-security.md` — release pipeline security controls, one-time npmjs trusted-publisher setup, maintainer drift checklist.
- `docs/skill-style-guide.md` — how to author/update LLM-first skills in this repo.
- `AGENTS.md` — agent working rules; the authoritative plugin-development skill.
- `skills/opencode-plugin/SKILL.md` — the versioned plugin-development skill.
- `skills/npm-secure-config/SKILL.md` — the versioned npm/pnpm/Bun secure-configuration skill.

## Next Step

Explore the guide pages above, then open a PR — see [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) for the branch, issue, and size policies.
