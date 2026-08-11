---
name: npm-secure-config
description: "Trigger: configure, initialize, upgrade, or secure npm/pnpm/Bun; .npmrc, pnpm-workspace.yaml, bunfig.toml, trustedDependencies. Enforce secure defaults."
license: Apache-2.0
metadata:
  author: jonasotoaguilar
  version: "1.2"
---

## Activation Contract

Always load when configuring, initializing, migrating, or upgrading npm, pnpm, or Bun for a project, even when security hardening was not explicitly requested. Also load when a task touches `.npmrc`, `pnpm-workspace.yaml`, `bunfig.toml`, `bun.lock`, dependency installs or lockfiles, lifecycle scripts, install cooldown, audit or signature verification, `npx` / `pnpm dlx` / `bunx`, `bun ci`, `bun pm trust` / `bun pm untrusted`, npm tokens, Bun publishing, or semantic-release on Bun-managed projects.

## Hard Rules

- Version-gate every setting: run `npm --version` / `pnpm --version` / `bun --version` first and only apply keys the installed version supports (gates in references). Bun baseline requires 1.3.5+ (CVE-2026-24910 fix).
- Apply this skill's secure baseline whenever project-level npm, pnpm, or Bun configuration is created or updated; security does not need to be requested separately.
- Never blanket-enable lifecycle scripts (`ignore-scripts=false`, `dangerouslyAllowAllBuilds`, `bun pm trust --all`, `--dangerously-allow-all-scripts`): use explicit allowlists after reviewing each package (`allowScripts` via `npm install-scripts approve` for npm 12+, `trustedDependencies` in package.json for Bun).
- Never put tokens in a committed `.npmrc` or `bunfig.toml`; only registry URLs. Credentials go in user-level config or environment variables (`BUN_CONFIG_TOKEN` indirection for Bun).
- Keep lockfiles committed; validate `package-lock.json` with lockfile-lint in CI. For Bun, commit the text `bun.lock` and run `bun ci` / `bun install --frozen-lockfile` (lockfile-lint does not cover bun.lock).
- Prefer persistent cooldown config over the `--before` date flag (manual date management is error-prone); keep units straight: npm days, pnpm minutes, Bun seconds.
- Prefer OIDC trusted publishing for npm publish in CI; never inject `NPM_TOKEN`/`NODE_AUTH_TOKEN` as a fallback in an OIDC publish job — a fallback token silently masks a broken trusted-publisher binding.
- Never configure an npm trusted publisher for a package that does not exist yet: the first `npm publish` is authenticated (human login with 2FA or a short-lived token) and creates the package; trusted publishing covers subsequent publishes only.
- Re-verify upstream commands and defaults against the installed tool before mutating config.

## Decision Gates

| Situation | Action |
|---|---|
| npm project | Secure `.npmrc` per [references/npm-config.md](references/npm-config.md) |
| pnpm project | `pnpm-workspace.yaml` settings per [references/pnpm-config.md](references/pnpm-config.md) |
| Bun project | Secure `bunfig.toml` per [references/bun-config.md](references/bun-config.md) |
| npm older than 11.10.0 | Fall back to per-install flags (`--ignore-scripts`, `--before`) |
| npm lifecycle-script allowlist | npm 12.0.0+: `allowScripts` + `npm install-scripts approve` per [references/npm-config.md](references/npm-config.md); older npm: `ignore-scripts` + per-install `--ignore-scripts=false` after review |
| Bun older than 1.3.5 | Upgrade Bun before hardening (CVE-2026-24910 spoofing fix) |
| Dependency needs build scripts | Review, then allowlist explicitly; never enable globally (`npm install-scripts approve <pkg>` / `bun pm trust <pkg>`) |
| Ad-hoc tool | `npx` / `pnpm dlx` / `bunx` with a pinned version; avoid global installs |
| Publishing packages | 2FA + provenance, OIDC trusted publishing preferred (npm >= 11.5.1, GitHub-hosted runner, exact publisher binding, no token fallback) per [references/publishing.md](references/publishing.md); Bun: provenance requires npm publish |
| Release CI uses semantic-release (on Bun-managed packages) | Only when the release pipeline actually uses semantic-release: keep `bun ci` + bun.lock; release CI must run npm for `@semantic-release/npm` per [references/publishing.md](references/publishing.md) |
| Release CI triggers on a version tag and publishes directly | No semantic-release requirements; sync the package.json version to the tag before publish (`npm publish` ships the package.json version, not the tag's) per [references/publishing.md](references/publishing.md); apply the plain publishing checklist (2FA, provenance/OIDC, token rules) |

## Execution Steps

1. Detect package manager and version; read existing `.npmrc` / `pnpm-workspace.yaml` / `bunfig.toml` and merge — never clobber.
2. Apply the matching secure template from references, dropping keys the installed version does not support (Bun: reject Bun < 1.3.5).
3. List dependencies with lifecycle scripts; review each and add to the allowlist (`npm install-scripts approve` / `allowScripts` for npm 12+, `allowBuilds` / `onlyBuiltDependencies` for pnpm, `trustedDependencies` for Bun); keep fail-on-unreviewed behavior on (npm: `strict-allow-scripts=true`; Bun: check `bun pm untrusted`).
4. Set the cooldown with the correct unit (npm days, pnpm minutes, Bun seconds); exclude only trusted or urgent packages (e.g. own scoped packages).
5. Add CI gates: `npm ci` + lockfile-lint + failing `npm audit` for npm; `bun ci` + `bun audit` for Bun.
6. For publish flows, detect the release mechanism first (semantic-release vs a tag-triggered workflow that publishes directly); for tag-triggered workflows, sync the package.json version to the tag before publishing (npm publishes the package.json version, not the tag's); apply the publishing checklist, and the semantic-release-specific guidance only when the pipeline actually uses semantic-release (Bun-managed: npm publishes, Bun installs).
7. Verify with the check commands in the references and report the output.

## Output Contract

Report: config files created/modified, version gates applied or skipped (with installed versions), allowlists with their review basis, CI steps added, and verification command output.

## References

- [references/npm-config.md](references/npm-config.md) — npm `.npmrc` secure template, version gates, lifecycle-script allowlist (`allowScripts`/`npm install-scripts approve`), transitive `overrides`, toolchain pinning (`devEngines`/`packageManager`/`engine-strict`), `npm ci`, audit and lockfile-lint CI checks.
- [references/pnpm-config.md](references/pnpm-config.md) — pnpm-workspace.yaml settings and version gates.
- [references/bun-config.md](references/bun-config.md) — Bun `bunfig.toml` secure baseline, version gates, trustedDependencies, cooldown, audit, bunx, publishing.
- [references/publishing.md](references/publishing.md) — 2FA, provenance, OIDC trusted publishing, token rules, package contents (`files` field + `npm pack --dry-run`); semantic-release guidance applies only when the release pipeline uses it.
- [references/upstream-source.md](references/upstream-source.md) — upstream attribution and evolution note.
