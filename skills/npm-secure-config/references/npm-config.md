# npm Secure Configuration

Version gates verified against npm release notes, `docs.npmjs.com/cli/v11/using-npm/config`, and `docs.npmjs.com/cli/v12/configuring-npm/package-json` (checked 2026-08-10). Always confirm with the installed `npm --version` before applying.

## Secure `.npmrc` (project level, committed)

```ini
# npm secure configuration — requires npm 11.10.0+
# Check with: npm --version && npm config get <key>

# Block dependencies fetched from git references (git+ssh://, github:)
allow-git=none

# Install cooldown: only versions published more than N days ago
min-release-age=3

# Exempt trusted packages from the cooldown (optional; npm 11.10.0+)
min-release-age-exclude[]=@myorg/*
```

All settings above are npm 11.10.0+. On older npm, fall back to per-install flags: `npm install --ignore-scripts` and `npm install --before="$(date -d '7 days ago')"`.

## Audit and signature verification

```ini
# .npmrc — audit defaults
audit=true
```

- CI gate: `npm audit --audit-level=high` (fail on findings). Do not rely on `npm audit fix` alone — it can be blocked by the cooldown window.
- Verify registry signatures and provenance attestations of installed packages with the documented command: `npm audit signatures` (`--json --include-attestations` for full sigstore bundles). Run on the latest npm CLI, since attestation formats evolve.

## Lifecycle scripts (npm)

- npm 12.0.0+ blocks dependency lifecycle scripts by default: only packages covered by the root project's `allowScripts` field in `package.json` run them (`preinstall`, `install`, `postinstall`, and `prepare` for non-registry sources).
- Record approvals with `npm install-scripts approve` (or the `npm approve-scripts` alias); `npm rebuild` executes newly approved scripts. `npm install-scripts prune` removes stale entries; `--allow-scripts-pending` lists unreviewed packages without modifying package.json.
- Approvals default to pinned entries (`pkg@1.2.3`) so the approval stays narrowed to the reviewed version; pass `--no-allow-scripts-pin` to allow any future version. Denials (`npm deny-scripts`) always write name-only entries.
- `strict-allow-scripts=true` in `.npmrc` turns the policy from a warning into a hard error: any dependency with unreviewed install scripts fails the install.
- `--allow-scripts` is restricted to one-off and global contexts (`npm exec`, `npx`, `npm install -g`); passing it to a project-scoped `npm install`, `ci`, `update`, or `rebuild` is an error — team policy belongs in `allowScripts` or `.npmrc`.
- `--dangerously-allow-all-scripts` bypasses the policy entirely: migration escape hatch only, never a baseline (mirrors pnpm `dangerouslyAllowAllBuilds`).
- npm < 12.0.0: keep `ignore-scripts=true` (global or per-install `--ignore-scripts`). When a dependency genuinely requires build scripts, review it first, then run its install with scripts enabled for that step only: `npm install --ignore-scripts=false <pkg>` — never blanket-disable the guard.

## Lockfile integrity (CI)

- Use `npm ci` for deterministic installs in CI: it installs exactly the versions in `package-lock.json` and aborts on any inconsistency; `npm ci --omit=dev` for production-only installs.
- Keep `package-lock.json` committed; reject PRs that modify the `resolved`/`integrity` of existing entries.

```bash
npm install --save-dev lockfile-lint
npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https
```

Wire as a `preinstall` script or a separate CI job that runs before installs.

## Transitive dependency overrides

- Force a vulnerable transitive dependency to a patched version with the `overrides` field (root package.json only): npm docs — "replacing the version of a dependency with a known security issue". Verified in npm 12 package-json docs; check `npm help package-json` on the installed version.
- Syntax: `"overrides": { "@npm/foo": "1.0.0" }` for an exact version, or nested keys for scoped replacement. A `$`-prefixed value references a direct dependency's spec (e.g. `"@npm/foo": "$@npm/foo"`).
- Use overrides only for transitive convergence or security fixes, and document why — an override can skip the dependency's own declared ranges. Re-run `npm audit` after applying to confirm the vulnerable entry is gone.

## Toolchain pinning (devEngines, packageManager, engine-strict)

- `engines` (node/npm ranges) is advisory unless `engine-strict=true` in `.npmrc` turns violations into errors. Verified config key; check `npm config get engine-strict`.
- `devEngines` (npm 10.9.0+; verified in v11 and v12 package-json docs and the v10.9.0 release notes) runs before `install`, `ci`, and `run` commands and can fail the environment when `runtime` or `packageManager` do not match: `"devEngines": { "runtime": { "name": "node", "version": ">=20", "onFail": "error" }, "packageManager": { "name": "npm", "version": ">=11", "onFail": "error" } }`. This pins the toolchain for everyone touching the repo, not just CI.
- The `packageManager` field in package.json (Corepack convention) records the exact manager version; keep it in sync with devEngines when both are used.
- Gate by installed version: older npm treats `devEngines` as unknown config and ignores it — verify with `npm help package-json`.

## Ad-hoc execution

- Prefer `npx <pkg>@<version>` over global installs so packages do not run continuously.
- Consider `npq` as a wrapper that audits a package before install (vulnerabilities, age, typosquatting, signatures, install scripts).
