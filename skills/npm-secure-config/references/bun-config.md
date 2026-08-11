# Bun Secure Configuration

Version gates verified against official Bun docs and release notes (checked 2026-08-09). Always confirm with the installed `bun --version` before applying.

## Version gate

- Secure baseline requires Bun 1.3.5+: fixes spoofing of the default trusted-dependencies list (CVE-2026-24910 / GHSA-xp39-vp6q-phvj). Upgrade older Bun before hardening.

## Secure `bunfig.toml` (project level, committed)

```toml
# Bun secure configuration — gate each key by installed version
# Check with: bun --version && bun install --help

[install]
# Lifecycle scripts are default-deny. The allowlist is NOT a bunfig key:
# it lives in package.json (trustedDependencies) — see "Lifecycle scripts".
# Never use bun pm trust --all as a blanket baseline.

# Install cooldown in SECONDS (Bun 1.3.0+; npm=days, pnpm=minutes, Bun=seconds)
minimumReleaseAge = 604800                 # 7 days
minimumReleaseAgeExcludes = ["@myorg/*"]   # trusted packages bypass the cooldown
```

- Persistent defaults can live in user-level `~/.bunfig.toml` or `$XDG_CONFIG_HOME/.bunfig.toml`; user config is merged with project config.

## Lifecycle scripts

- Default-deny: only packages listed in `trustedDependencies` run postinstall scripts.
- The allowlist belongs in `package.json`, e.g. `"trustedDependencies": ["esbuild", "@myorg/tool"]` — it is NOT a `bunfig.toml` `[install]` key. Review each package before adding; this is the explicit reviewed-list mitigation for CVE-2026-24910 spoofing.
- Review what would run: `bun pm untrusted` lists packages with lifecycle scripts that are not yet trusted.
- Trust narrowly, package by package: `bun pm trust <pkg>` adds to the allowlist. The blanket form is `bun pm trust --all` — never use it as the baseline.

## Lockfile and CI

- `bun.lock` is the text lockfile (default since Bun 1.2); keep it committed.
- CI: `bun ci` (Bun 1.2.21+) or `bun install --frozen-lockfile` for deterministic installs.
- Do NOT claim lockfile-lint covers bun.lock — it does not; review `bun.lock` diffs in PRs instead.

## Audit and security scanner

- `bun audit` since Bun 1.2.15; the optional Security Scanner API since 1.2.21. Verify optional flags with `bun audit --help` on the installed version before using them.
- Limitation: audit may skip non-default registries — document that in CI expectations.

## Auth

- bunfig.toml supports registry/scopes with environment-variable references; Bun also reads a subset of `.npmrc`.
- Never commit tokens. Use environment indirection (e.g. `BUN_CONFIG_TOKEN`) in CI; committed config carries registry URLs only.

## Ad-hoc execution

- `bunx <pkg>@<version>` pins ad-hoc tools; `--no-install` exists in modern Bun.

## Publishing

- `bun publish` supports OTP/token auth but NOT npm provenance/OIDC trusted publishing. Where provenance or OIDC is required, publish with npm (see [publishing.md](publishing.md)).

## Verification checks

```bash
bun --version                 # >= 1.3.5
bun pm untrusted              # no surprises outside the allowlist
bun install --frozen-lockfile # deterministic install
bun audit                     # vulnerability gate (1.2.15+)
```

- Bun has no config introspection: `bun config` is a subcommand reserved for future use, so effective bunfig values cannot be read back. Confirm cooldown support with `bun install --help` (`--minimum-release-age=<val>`) and validate behavior by running an install.

## Official sources

- https://bun.com/docs/pm/lifecycle — lifecycle scripts and trustedDependencies.
- https://bun.com/docs/pm/cli/install — install flags, `--frozen-lockfile`.
- https://bun.com/docs/pm/cli/pm — `bun pm trust` / `bun pm untrusted`.
- https://bun.com/docs/pm/cli/audit — audit command.
- https://bun.com/docs/pm/cli/publish — publishing and auth.
- https://bun.com/docs/pm/bunx — ad-hoc execution.
- https://bun.com/docs/pm/lockfile — text lockfile.
- https://bun.com/docs/pm/security-scanner-api — Security Scanner API (1.2.21+).
- https://bun.com/docs/pm/scopes-registries — registries and scopes.
- https://bun.com/docs/pm/npmrc — `.npmrc` subset support.
- https://bun.com/docs/runtime/bunfig — `bunfig.toml` config.
- Bun release notes (1.2.15, 1.2.21, 1.3.0, 1.3.5) and GHSA-xp39-vp6q-phvj (CVE-2026-24910).
