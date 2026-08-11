# opencode-tokenmeter — Agent Skills Index

When working on this project, load the relevant skill(s) BEFORE writing any code.

Naming convention: project-prefixed skills are repo-specific workflow skills. Unprefixed skills are portable skills and keep their canonical names.

## How to Use

1. Match the task to the trigger.
2. Read the referenced `SKILL.md`.
3. Follow all rules from that skill.
4. Load multiple skills when needed.

## Skills

| Skill | Trigger | Path |
|---|---|---|
| `opencode-plugin` | Trigger: create OpenCode plugins, TUI plugins, sidebar UI, Solid reactivity, plugin SDK, custom tools, hooks, auth, or tool interception. Build and package plugins with @opencode-ai/plugin. | `skills/opencode-plugin/SKILL.md` |

## Project Documentation

- `ARCHITECTURE.md` — Backend design, architecture decisions, system design
- `DESIGN.md` — UI/UX design and frontend component design
- `docs/CODEBASE-GUIDE.md` — navigational index; `docs/codebase/mental-model.md` is the foundational data-flow page
- `docs/adr/` — architecture decision records (build, reconcile, kv persistence, external packages, width)
- `docs/skill-style-guide.md` — normative LLM-first skill authoring guide
- `openspec/` — spec-driven requirements live here (`config.yaml`, `specs/`, `changes/`), not in a parallel doc
