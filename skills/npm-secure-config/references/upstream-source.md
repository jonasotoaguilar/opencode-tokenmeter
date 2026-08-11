# Upstream Source and Evolution

This skill derives and adapts guidance from:

- **Repository**: [lirantal/npm-security-best-practices](https://github.com/lirantal/npm-security-best-practices) — "Awesome npm Security Best Practices".
- **Source file**: `README.md` at the `main` branch (fetched 2026-08-03).
- **License**: Apache-2.0.

## How this skill relates to the upstream

- The upstream is a curated list of best practices; this skill converts a subset into executable, version-gated configuration for npm, pnpm, and Bun.
- This skill does not copy the upstream verbatim. It separates npm from pnpm and Bun, pins version gates to primary sources, and replaces blanket recommendations with allowlist-based control.

## Additional primary sources (Bun and release tooling)

Bun guidance derives from official Bun documentation and release notes (checked 2026-08-09), not the lirantal repository:

- Bun docs: `bun.com/docs/pm/lifecycle`, `/pm/cli/install`, `/pm/cli/pm`, `/pm/cli/audit`, `/pm/cli/publish`, `/pm/bunx`, `/pm/lockfile`, `/pm/security-scanner-api`, `/pm/scopes-registries`, `/pm/npmrc`, `/runtime/bunfig`.
- Bun 1.3.5 fix for the default trusted-dependencies-list spoofing: CVE-2026-24910 / GHSA-xp39-vp6q-phvj.
- semantic-release on Bun-managed projects (checked 2026-08-09): `@semantic-release/npm` `lib/publish.js` and README (hardcodes `npm publish`); semantic-release GitBook CI/GitHub Actions recipes; npm provenance docs.

## Evolution warning

- The upstream README is community-maintained and changes frequently; specific commands, defaults, and minimum versions can drift.
- Version gates in this skill were verified against primary sources on 2026-08-03 (npm/pnpm), 2026-08-09 (Bun/semantic-release), and 2026-08-10 (npm 12 allowScripts / devEngines):
  - npm release notes and config docs: `allow-git` and `min-release-age` require npm 11.10.0+; lifecycle-script blocking via `allowScripts` + `npm install-scripts approve` requires npm 12.0.0+ (blocked by default, per npm 12.0.0 changelog and `npm help install-scripts`); `devEngines` shipped in npm 10.9.0 (PR #7766, release notes 2024-10-03; also in v11/v12 package-json docs); `overrides` for transitive security fixes documented in npm 12 package-json docs.
  - pnpm settings docs: dependency build scripts blocked by default (10.0+), `strictDepBuilds` (10.3+), `dangerouslyAllowAllBuilds` (10.9+), `minimumReleaseAge` (10.16+), `allowBuilds` and `blockExoticSubdeps` (10.26+), trust policies: `trustPolicy` (10.21+), `trustPolicyExclude` (10.22+), `trustPolicyIgnoreAfter` (10.27+), `trustLockfile` (11.3+).
  - Bun docs and release notes: text `bun.lock` default (1.2+), `bun ci` (1.2.21+), `bun audit` (1.2.15+), Security Scanner API (1.2.21+), cooldown `minimumReleaseAge` in seconds (1.3.0+), secure baseline requires 1.3.5+ (CVE-2026-24910).
- Before mutating any configuration, re-check against:
  - Installed tools: `npm --version`, `pnpm --version`, `bun --version`.
  - Official docs: `docs.npmjs.com/cli/v11/using-npm/config`, `pnpm.io/settings`, `bun.com/docs` (pm and runtime sections).
