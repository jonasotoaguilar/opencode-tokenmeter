# Publishing and Token Security

Applies to npm, pnpm, and Bun-managed packages (all publish to the npm registry).

## Account and authentication

- Enable 2FA for publishing: `npm profile enable-2fa auth-and-writes` (or `auth-only` for login/profile changes only).
- Never commit tokens to a project `.npmrc` or any file in version control. Committed `.npmrc` files carry registry URLs only (e.g. `@myorg:registry=https://npm.myorg.com/`).
- Keep credentials in the user-level `~/.npmrc` or inject via environment variables (e.g. `NPM_TOKEN`) in CI.

## Provenance attestations

- Publish with provenance so consumers can verify the build origin: `npm publish --provenance`.
- Provenance requires the registry to be the default `registry.npmjs.org` (or a supporting proxy) and a public git URL; verify with the installed npm.

## OIDC trusted publishing

- Prefer OIDC trusted publishing over long-lived tokens: short-lived, workflow-scoped credentials that cannot be reused once leaked.
- Verified requirements (npm docs, 2026): npm CLI >= 11.5.1 and Node >= 22.14.0, plus a GitHub-hosted runner (self-hosted runners are not supported for npm trusted publishing).
- Initial package creation is an authenticated bootstrap: npm has no separate package-creation step, and a never-published package has no package settings page or `npm trust` target. The first `npm publish` (human `npm login` with 2FA, or a short-lived publish token) creates the package; configure the trusted publisher only afterwards.
- Provenance caveat: a manual/local publish cannot use GitHub OIDC provenance — provenance attestations come from the CI/CD workflow's OIDC identity. Do not pass `--provenance` for a local bootstrap publish; override `publishConfig.provenance` if set (e.g. `npm publish --provenance=false`).
- One-time setup on npmjs (requires account authority, outside CI): on the package's trusted-publisher settings, bind the package to the exact `owner/repo`, the exact workflow filename (e.g. `release.yml`), and — when the workflow uses one — the exact environment name (e.g. `release`). The binding matches literally: renaming the workflow or environment breaks publishing.
- CLI alternative (npm >= 11.15.0; requires write access, 2FA, and the package to already exist): `npm trust github <package> --file <workflow.yml> --repo <owner/repo> --env <environment> --allow-publish`. Verified synopsis (npm 12.0.2): positional `[package]`; `--repo`/`--repository` and `--env`/`--environment` are aliases. The npmjs.com package-settings form remains the universal path; this is its command-line equivalent.
- GitHub Actions workflow:

```yaml
permissions:
  id-token: write
steps:
  - run: npm publish
```

- The publish job must run on a GitHub-hosted runner with `id-token: write`; npm exchanges the OIDC assertion for a short-lived registry token per run.
- Do NOT inject `NPM_TOKEN`/`NODE_AUTH_TOKEN` into an OIDC publish job — a fallback token silently masks a broken trusted-publisher binding (publish keeps succeeding with the token while OIDC is misconfigured). The publish job's environment and workflow must not carry npm token secrets.
- `actions/setup-node` with `registry-url: https://registry.npmjs.org` is compatible; it configures the registry without injecting token auth.
- Runtime npm may be older than 11.5.1 even on modern Node (Node 22 bundles npm 10): install or pin a modern npm explicitly in the publish job before `npm publish` (e.g. `npm install -g npm@12`).
- Trusted publishing automatically generates provenance attestations for public packages/repos; keeping an explicit `npm publish --provenance` (or `publishConfig.provenance = true`) is acceptable and makes the intent explicit.
- After a successful migration: remove the now-unused `NPM_TOKEN` secret from the CI environment and revoke existing npm publishing tokens; keep publishing tokens only where OIDC cannot be used.
- Operational caveats: the trusted-publisher binding covers publishing only — administrative actions that are not publishes (deprecating, changing package metadata, access management, etc.) still require a traditional authenticated npm session (human `npm login` with 2FA or a scoped automation token); do not route those through the OIDC workflow.
- Also supported in GitLab CI/CD; trusted publishing automatically generates provenance attestations.

## Bun publishing (`bun publish`)

- `bun publish` supports OTP/token authentication, but Bun does not support npm provenance attestations or OIDC trusted publishing as of the verified docs (checked 2026-08-09).
- Where provenance or OIDC is required, publish with npm (guidance above); keep Bun as the install/package manager.
- Committed `bunfig.toml` carries registry URLs only; tokens go through environment indirection (e.g. `BUN_CONFIG_TOKEN`).

## Tag-triggered release workflows

Many release pipelines skip semantic-release entirely: a workflow triggers on a version tag and publishes directly. No semantic-release configuration is needed, but keep one rule in mind: `npm publish` publishes the version in `package.json`, not the tag's version. A tag `v2.0.0` with a `package.json` still at `1.5.0` publishes `1.5.0`. Sync the version inside the workflow before publishing:

```yaml
- name: Sync package.json version to the tag
  run: npm version "${GITHUB_REF_NAME#v}" --no-git-tag-version --allow-same-version
```

- `--no-git-tag-version` keeps npm from creating a commit/tag in CI (the tag already exists); `--allow-same-version` makes the step idempotent when the version already matches.
- `GITHUB_REF_NAME` holds the pushed tag name (bash expansion strips the `v` prefix; the default workflow shell is bash).
- npm also updates `package-lock.json` when it bumps the version; keep the lockfile committed and publish the synced tree.
- Invoke the project build explicitly before publishing: npm lifecycle scripts (e.g. `prepack`) do not run when scripts are disabled (`ignore-scripts=true`), so the tarball may ship stale or missing build output — never rely silently on prepack, for the bootstrap publish or release preparation.
- Alternative when the `npm version` command is undesirable: `npm pkg set version="${GITHUB_REF_NAME#v}"` (check the installed npm for workspace-aware behavior).
- The workflow owns the tag: there is no automatic tag or changelog, so decide and push the version tag deliberately.
- The release tag is the go/no-go: publish only from an explicit stable version tag, never from a branch push. Workflow trigger and job structure are project-owned; this skill covers the npm publishing-domain rules only.

## semantic-release (optional — only when release CI uses it)

semantic-release is one release mechanism, not the default. Many release workflows trigger on a version tag and publish directly from the workflow (see Tag-triggered release workflows above); those need no semantic-release configuration. Only apply this section when the project's release pipeline actually uses semantic-release.

- Bun-managed projects are compatible with semantic-release workflows: Bun remains the install/package manager (`bun ci` from the committed `bun.lock`).
- `@semantic-release/npm` hardcodes the `npm` executable and runs `npm publish`; it does not run or select `bun publish`. Release CI must provide npm (e.g. setup-node) alongside Bun.
- Because the plugin publishes with npm, the provenance and OIDC guidance above applies as-is. Prefer OIDC; the token fallback must be granular, expiring, and auth-only-2FA compatible.
- Enable provenance via `publishConfig.provenance = true` / npm configuration as supported by the current npm; do not invent Bun provenance.
- Tradeoff, not the default: a custom semantic-release exec plugin calling `bun publish` loses npm OIDC/provenance.

## Package contents (`files` field)

- Control what ships in the published tarball with the `files` allowlist in package.json: `"files": ["dist", "LICENSE"]`. The tarball ships exactly the matched entries (npm always adds package.json, README, and LICENSE), so nothing unlisted — tests, source, configs, secrets — leaks into the published artifact.
- Verify before every publish with `npm pack --dry-run` (prints the file list) or `npm pack` + `tar -tzf <package>-<version>.tgz` for a full review. Never publish without checking the dry-run output, especially after adding files to the repo root.
- Do not rely on the npmjs.org page to know what ships: inspect the tarball itself.

## Verification

- `npm whoami` and `npm config get //registry.npmjs.org/:_authToken` should show only expected credentials.
- In an OIDC publish job there is no persisted token: `npm config get //registry.npmjs.org/:_authToken` returning empty is expected, not a failure.
- Audit which tokens exist and rotate any that are long-lived or broadly scoped; prefer tokens scoped to specific packages or automation.
