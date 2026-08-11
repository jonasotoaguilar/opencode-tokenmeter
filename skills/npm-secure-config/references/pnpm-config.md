# pnpm Secure Configuration

Version gates verified against `pnpm.io/settings` (checked 2026-08-03) and the upstream README. Always confirm with the installed `pnpm --version` before applying.

## Secure `pnpm-workspace.yaml` template

```yaml
# pnpm secure configuration — gate each key by installed version
# Check with: pnpm --version

# pnpm 10.0+: dependency postinstall scripts are blocked by default.
# Allow only packages you reviewed; package names only — version selectors
# are removed from this list in pnpm 11 (use allowBuilds for version pins).
onlyBuiltDependencies:            # pnpm 10.0+; deprecated, replaced by allowBuilds
  - esbuild
  - '@prisma/client'

strictDepBuilds: true             # pnpm 10.3+ (default true): fail install on unreviewed build scripts
a
allowBuilds:                      # pnpm 10.26+: explicit allow/deny map
  esbuild: true
  core-js: false                  # deny a package even if otherwise approved

minimumReleaseAge: 20160          # pnpm 10.16+: cooldown in MINUTES (20160 = 2 weeks)
minimumReleaseAgeExclude:         # trusted packages bypass the cooldown
  - '@types/react'
  - typescript

blockExoticSubdeps: true          # pnpm 10.26+: reject git/tarball transitive dependencies
```

## Hard rules

- Never set `dangerouslyAllowAllBuilds: true` (pnpm 10.9+): it runs every dependency's build scripts, current and future, without review.
- `allowBuilds` (pnpm 10.26+) replaces `onlyBuiltDependencies` and `ignoredBuiltDependencies` (deprecated; version-selector syntax is removed from them in pnpm 11). Keep version-selective allowlisting in `allowBuilds` keys only.
- Git-hosted dependencies are never approved by package name alone; approve by resolved path or repository URL (see `pnpm.io/settings/build`).
- Trust policies (dependency-resolution settings), each gated by installed version:
  - `trustPolicy` (pnpm 10.21+, `no-downgrade`): fail installs when a package's trust evidence drops vs. earlier releases.
  - `trustPolicyExclude` (10.22+): package selectors exempt from the trust policy check.
  - `trustPolicyIgnoreAfter` (10.27+): ignore the check for packages published more than N minutes ago.
  - `trustLockfile` (11.3+): skip re-applying `minimumReleaseAge`/`trustPolicy` to the loaded lockfile — leave `false` when outside collaborators can edit it.

## Lockfile

- `pnpm-lock.yaml` is structurally resistant to injection: pnpm does not install packages listed in the lockfile but absent from `package.json`, and the format has no mutable tarball sources. Keep it committed; lockfile-lint targets npm/yarn lockfiles, not `pnpm-lock.yaml`.
- Review lockfile diffs in PRs anyway — a malicious dependency can still enter through `package.json` ranges.

## Ad-hoc execution

- Prefer `pnpm dlx <pkg>@<version>` over global installs.
- `pnpm approve-builds` interactively writes `onlyBuiltDependencies` entries — review each package it suggests before approving.
