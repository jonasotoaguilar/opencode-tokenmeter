<!-- ⚠️ READ BEFORE SUBMITTING
  Every PR must be linked to an issue that has the "status:approved" label.
  PRs without a linked approved issue will be automatically rejected by CI.
  See the issue templates and PR checks for the contribution workflow.
-->

## 🔗 Linked Issue

<!-- REQUIRED:
  - Tracker PR or default-branch PR: use `Closes #NNN`
  - Child PR in feature-branch-chain: use `Related to #NNN`
  - Do NOT include both.
-->

<!-- Tracker or default-branch PR -->
Closes #

<!-- Child PR in feature-branch-chain -->
Related to #

<!-- Use EXACTLY ONE:
  - Tracker / default-branch PR: Closes #42
  - Child PR in feature-branch-chain: Related to #42
-->

---

## 🏷️ PR Type

What kind of change does this PR introduce?

- [ ] `type:bug` — Bug fix (non-breaking change that fixes an issue)
- [ ] `type:feature` — New feature (non-breaking change that adds functionality)
- [ ] `type:docs` — Documentation only
- [ ] `type:refactor` — Code refactoring (no functional changes)
- [ ] `type:chore` — Build, CI, or tooling changes
- [ ] `type:breaking-change` — Breaking change (fix or feature that changes existing behavior)

---

## 📝 Summary

<!-- Provide a clear and concise description of what this PR does and why. -->

---

## 📂 Changes

| File / Area | What Changed |
|-------------|-------------|
| `path/to/file` | Brief description |

---

## Chain Context

<!-- Fill ONLY if this PR is part of a chain.
  IMPORTANT:
  - Keep this heading EXACTLY as `## Chain Context` (no emoji/prefix changes), CI parses it literally.
  - Tracker PRs target `main` and use `Position | tracker`.
  - Child PRs target the tracker branch or the immediate parent branch, never `main`.
  - Child PRs use `Position | N of total`.
  - Tracker PRs must keep the Chain Status table below and list every child PR in the chain.
-->

| Field | Value |
|-------|-------|
| Chain | <feature or stack name> |
| Tracker PR | <#NNN, "self" for tracker drafts before the PR number exists, or "Not needed"> |
| Position | <"tracker" for tracker PRs, or "N of total" for child PRs> |
| Base | `<target branch>` |
| Depends on | <PR/issue/link or "None"> |
| Follow-up | <next PR or "None"> |
| Review budget | <changed lines> / 400 |
| Starts at | <branch, PR, or state this builds on> |
| Ends with | <standalone result delivered by this PR> |

### Chain Overview

```text
<!-- For a single PR: just "📍 This PR"
     For a chain: show the full dependency tree marking this PR with 📍 -->

📍 This PR
```

### Chain Status

<!-- Tracker PRs: list every child PR row in review order.
     Child PRs: keep this table only as local review context. -->

| PR | Scope | Status |
|----|-------|--------|
| #<!-- PR number --> | <!-- brief scope --> | 🟡 Open |

---

## 🧪 Test Plan

<!-- Describe how you tested this change. List the actual commands you ran
     (must match the project's stack — do not paste commands from a different
     ecosystem). Examples by stack:
       - pnpm:    pnpm run lint && pnpm vitest run
       - npm:     npm test
       - Go:      go test ./...
       - Python:  pytest
       - Rust:    cargo test
     Replace the example below with what YOU ran. -->

```bash
# <stack> test command(s) you actually ran
```

- [ ] Lint passes (or N/A — no linter configured)
- [ ] Format check passes (or N/A)
- [ ] Type check passes (or N/A — no type checker configured)
- [ ] Tests pass
- [ ] Manually tested locally

---

## 🤖 Automated Checks

The following checks run automatically on this PR:

| Check | Status | Description |
|-------|--------|-------------|
| Check PR Cognitive Load | ⏳ | PR should stay within 400 changed lines (`additions + deletions`) or use maintainer-applied `size:exception` |
| Check Issue Reference | ⏳ | Tracker/default PR: `Closes/Fixes/Resolves #N`; child PR: `Related to #N` |
| Check Issue Has `status:approved` | ⏳ | Linked issue must have been approved before work began |
| Check PR Has `type:*` Label | ⏳ | Exactly one `type:*` label must be applied |

---

## ✅ Contributor Checklist

- [ ] PR is linked to an issue with `status:approved`
- [ ] PR stays within 400 changed lines, or I have requested/obtained maintainer-applied `size:exception` with rationale documented
- [ ] Tracker/default PR uses `Closes #N`, child PR uses `Related to #N`
- [ ] If chained, this PR targets tracker/parent branch, not `main`
- [ ] I have added the appropriate `type:*` label to this PR
- [ ] Lint and format checks pass
- [ ] Tests pass
- [ ] I have updated documentation if necessary
- [ ] My commits follow [Conventional Commits](https://www.conventionalcommits.org/) format
- [ ] My commits do not include `Co-Authored-By` trailers

---

## 💬 Notes for Reviewers

<!-- Optional: anything you want reviewers to pay special attention to. -->
