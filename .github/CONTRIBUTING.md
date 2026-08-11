# Contributing

Thanks for your interest. Please follow the process below.

## Before you start

1. Open or find an issue for your change.
2. Ensure the issue carries the `status:approved` label — this signals maintainer approval before writing code.

## Setup

```bash
git clone git@github.com:jonasotoaguilar/opencode-tokenmeter.git
cd opencode-tokenmeter
bun install          # bun 1.3.x; first install generates bun.lock
bun run hooks:install  # installs the repo-local Lefthook pre-commit hook
```

## Development

1. Branch from `main` with a focused scope: `feat/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`; never commit directly on `main`.
2. Make your changes.
3. Run `bun run biome:check` and `bun test` — fix all failures.

## Pull request

- Reference the issue: `Closes #N`, `Fixes #N`, or `Resolves #N`.
- Apply exactly one type label from the accepted set: `type:bug`, `type:feature`, `type:refactor`, `type:docs`, `type:chore`, `type:breaking-change`.
- Keep the diff at **≤400 lines**. If it must exceed that, add `size:exception` with a brief justification.
- Commit with Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`); no AI attribution.

## Checks before a PR

Run all of these locally; CI enforces the same gates:

```bash
bun run typecheck    # tsc --noEmit over source and tests
bun run test         # bun test (unit + render + artifact suites)
bun run build        # bundle dist/tui.js + dist/tui.d.ts with the Solid transform
bun run test:dist    # build first, then the dist artifact regression test
bun run audit        # bun audit — zero known vulnerabilities
bun run pack:dry-run # inspect the published tarball contents
bun run biome:check  # Biome formatter + linter gate (read-only)
```

No silent skips: if a command cannot run, say so in the PR instead of passing it over.
