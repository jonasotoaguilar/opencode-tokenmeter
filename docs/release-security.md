# Release pipeline security

The release pipeline publishes `opencode-tokenmeter-tui` to npm and creates the GitHub Release from a stable `vX.Y.Z` tag. Publication is protected by controls enforced in this repository (`.github/workflows/release.yml` + the `scripts/release-*` hooks) and by one-time administrative configuration on npmjs and GitHub that a maintainer must establish — see [One-time administrative setup](#one-time-administrative-setup). The package was created via the one-time authenticated bootstrap below (verified live as `opencode-tokenmeter-tui@1.0.0`); since that first publish, the OIDC trusted publisher has been configured and the workflow takes over for every subsequent release. The bootstrap procedure in [step 0](#one-time-administrative-setup) remains the documented fallback for creating a fresh package if it is ever unpublished.

## Controls enforced in this repository

| Control | Where / how |
|---|---|
| Tag-only publication | `on: push: tags: ["v*", "!v*-*"]` — pre-release tags excluded, branch pushes never trigger; pushing the stable tag IS the release authorization |
| Protected `release` environment | The publication job runs in `environment: release` (required reviewers + tag protection); the workflow does not work without it |
| Minimal job permissions | Workflow default `contents: read`; preflight adds `actions: read` (read-only CI conclusion); only the publication job receives `contents: write` + `id-token: write`; verify stays read-only. The publication job blanks `GITHUB_TOKEN` and only the publish step opts back in with `GH_TOKEN: ${{ github.token }}` |
| OIDC Trusted Publishing, no token fallback | npm exchanges the job's OIDC assertion for a short-lived registry token. No `NPM_TOKEN`/`NODE_AUTH_TOKEN` exists in the workflow or the `release` environment — a broken trusted-publisher binding fails loudly instead of silently falling back to a token |
| Modern npm pinned | `npm install -g npm@12` before the publish hook. Trusted Publishing requires npm >= 11.5.1 (Node >= 22.14.0) and a GitHub-hosted runner; setup-node's Node 22 bundles npm 10 |
| Provenance | `npm publish --provenance` plus `publishConfig.provenance: true`. Trusted publishing auto-generates provenance for public packages/repos; the explicit flag keeps the intent visible |
| Exact-tag checkout, no persisted credentials | `actions/checkout` with `fetch-depth: 0`, `fetch-tags: true`, `persist-credentials: false` in every job |
| Preflight → publish → verify order | Three jobs with explicit timeouts (30/45/15 min); publication is the only write-capable job; preflight runs the full CI gate set; verify confirms the npm entry and the GitHub Release from outside |
| Curated release notes | `docs/releases/` holds exactly ONE current release document, `docs/releases/<tag>.md`. A new release renames the previous document (`git mv`), replaces its content with the curated narrative body, and reviews it in git before tagging. The preflight hook fails the release when `docs/releases/` has zero or multiple documents, the document name does not match the tag, or the body is empty, placeholder-filled, malformed, or mismatched to the tag/version; the publish hook creates the GitHub Release from that file only (never a raw git-log dump, never `--generate-notes`) |
| Per-tag concurrency | `release-${{ github.ref }}` with `cancel-in-progress: false` — a second run on the same tag waits instead of cancelling the in-flight release |
| Fail closed | Every hook must exist and be executable or the run errors out; an already-published npm version or an existing GitHub Release blocks before any write |
| Runner cleanup | `if: always()` step removes generated release material (`$RUNNER_TEMP/release-material`) on every outcome; the runner is ephemeral regardless |
| Fix-forward / rollback | npm cannot republish the same version: a failed publish is fixed forward by cutting the next patch tag. GitHub Release creation is deterministic per tag (re-running reproduces its artifacts). Out-of-band npm deprecate / GitHub edit happens before the verification job completes |

## One-time administrative setup

Account authority on npmjs and GitHub — not performed from this repository, and not automated.

0. **Authenticated bootstrap publish (required first)**: the package must exist before a trusted publisher can be configured. Perform a one-time manual publish from a local clone with `npm login` (2FA), without pushing any `v*` tag (the release workflow's only trigger) and without committing — the working tree already carries the intended package identity and the temporary bootstrap version, and keeps both.

   ```bash
   npm whoami                                     # authenticated with 2FA
   bun install --frozen-lockfile
   bun run build                                  # explicit build: never rely on prepack
   npm publish --provenance=false --tag bootstrap --dry-run   # inspect the tarball first
   npm publish --provenance=false --tag bootstrap              # creates the package
   ```

   - The package identity is unscoped: the unscoped `opencode-tokenmeter` is rejected by the registry (npm E403 — too similar to the existing `opencode-token-meter`), so the npm package is `opencode-tokenmeter-tui`; the GitHub repository keeps its path `jonasotoaguilar/opencode-tokenmeter`. The former scoped package `@jonasotoaguilar/opencode-tokenmeter` was unpublished/deprecated in favor of this name. Confirm `npm view opencode-tokenmeter-tui version` returns E404 (never retry the blocked `opencode-tokenmeter` name) immediately before publishing.

   - The build is invoked explicitly because npm lifecycle scripts may be disabled (`ignore-scripts=true`), in which case `prepack` never runs — without the explicit build the tarball would ship stale or missing `dist/`.

   - `1.0.0-bootstrap.0` is a semver prerelease of the intended first stable `1.0.0`: it can never collide with the later stable release, and the dist-tag `bootstrap` keeps it off `latest` (a dist-tag is never removed implicitly).
   - `--provenance=false` is required: `publishConfig.provenance: true` would make the local publish attempt OIDC provenance, which only exists inside the CI workflow's OIDC identity — a manual publish cannot mint it. The bootstrap package therefore ships without a provenance attestation (expected and documented).
   - Verification: `npm view opencode-tokenmeter-tui@bootstrap version` returns the bootstrap version; `npm dist-tag ls opencode-tokenmeter-tui` shows `bootstrap` only.
   - Rollback: prefer `npm deprecate opencode-tokenmeter-tui@1.0.0-bootstrap.0 "bootstrap placeholder — do not use"` and remove the `bootstrap` dist-tag after the first stable release (`npm dist-tag rm opencode-tokenmeter-tui bootstrap`). Only `npm unpublish --force` within the 72h window when immediate removal is truly needed — unpublishing the package's only version can trigger npm's 24-hour republish block for that version.

1. **npmjs trusted publisher**: in the package's Access Tokens settings, choose *Publish with GitHub Actions* and bind `opencode-tokenmeter-tui` to:
   - owner/repo: `jonasotoaguilar/opencode-tokenmeter`
   - workflow filename: `release.yml`
   - environment: `release`
   The binding matches **literally** — renaming the workflow file or the environment breaks publishing.
2. **GitHub `release` environment**: create it with required reviewers (tag protection). No npm secrets are attached — OIDC replaces them.
3. **After the first successful OIDC publish**: remove the `NPM_TOKEN` secret from GitHub repository/environment secrets and revoke existing long-lived npm publishing tokens. Keep no publishing tokens; they would silently mask a broken OIDC setup.

Not covered by Trusted Publishing: administrative npm actions that are not publishes (deprecating a version, changing package metadata, access management) still require a traditional authenticated session (human `npm login` with 2FA) — never route those through the release workflow.

## Maintainer drift checklist

- [ ] The package exists on npm (the initial authenticated bootstrap publish ran before any trusted publisher was configured).
- [ ] Workflow file is still named `release.yml` and the publication job still uses `environment: release` — the npmjs binding matches these literally.
- [ ] No `NPM_TOKEN`/`NODE_AUTH_TOKEN` appears in `.github/workflows/release.yml` or the `release` environment's secrets.
- [ ] npmjs trusted publisher is configured for `opencode-tokenmeter-tui` with workflow `release.yml` and environment `release`.
- [ ] The npm 12 pin step (`npm install -g npm@12`) is present in the publication job before the publish hook.
- [ ] `docs/releases/` contains exactly one markdown file, `docs/releases/<tag>.md`, at every tagged commit with curated narrative notes (drift happens when a tag is cut without renaming/replacing the current release document).
- [ ] A first OIDC publish succeeded and the published package shows a provenance attestation.
- [ ] Old long-lived npm publishing tokens are revoked and the `NPM_TOKEN` secret is removed.
