---
name: mendix-review
description: Code-review Mendix changes across one or more git commits. Use whenever the user wants to review, inspect, audit, or understand what changed in a Mendix project between commits, branches, or since a given commit — including "what did this commit do", "review the last N commits", "what's in this PR", "what am I about to pull", "diff these commits". Mendix commits look empty in git (Bin NNN -> NNN bytes), so this skill reconstructs real, readable diffs from the .mpr/.mxunit binaries. Also use when a Mendix change needs risk assessment before deploying (domain-model migrations, security role changes, unreachable logic).
---

# Review Mendix changes across commits

Mendix stores everything in binary (`ArgoERP.mpr` + `mprcontents/**.mxunit`), so `git diff`
shows nothing but byte counts. This skill rebuilds genuine diffs.

**Safety, non-negotiable:** close Studio Pro before running anything here — mxcli can corrupt
an open project. Only read-only mxcli commands are used (`describe`, `context`, `callers`,
`callees`, `refs`, `impact`, `search`, `show`). Never run mxcli write/`exec` commands.

Toolkit location (bash; on Windows use Git Bash):

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
```

## Step 0 — verify the environment (first run on a machine/project only)

```bash
bash "$MXDIFF/doctor.sh"
```

Fix anything it reports before continuing. Run from inside the Mendix project.

## Step 1 — settle the range

Confirm exactly which commits are in scope. Don't assume `HEAD` is what the user means —
check whether they are behind the remote:

```bash
git status -sb && git log --oneline -15
```

If they said "what am I about to pull", the range is `HEAD..origin/main`. If they said
"the last commit", it is `<sha>^..<sha>`. State the range you settled on.

## Step 2 — build the model history (once per range)

```bash
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'
```

Replays each commit into `.mendix-cache/model-history`, a git repo of exported YAML tagged
`mx-<shortsha>`. Roughly 30s per commit; incremental, so already-built commits are skipped.
Run it in the background for long ranges and continue once it finishes.

## Step 3 — triage

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary
```

A table of changed documents by module with `+/-` magnitude. Renames are detected here
(`{A => B}`) — do not report those as an unrelated delete plus add.

Prioritise from this table. Large `+/-` on a page is usually layout; small `+/-` on a
microflow is often the actual behaviour change.

## Step 4 — read the logic that changed

For every changed microflow/nanoflow that matters, get the readable before/after. Pass them
all in one call — the worktree checkouts are the slow part and get shared:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Project.SUB_Foo Project.ACT_Bar
```

This is nested MDL with real variable names. Use its output as the evidence in your review.

For property-level changes (security roles, commit/refresh flags, XPath, widget settings,
attribute types), read the YAML bodies instead:

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>'
```

## Step 5 — quality gate scoped to the change

```bash
bash "$MXDIFF/lint-diff.sh" <oldSha> <newSha>
```

Lints only the changed documents, so findings are about this change rather than the
project's whole backlog.

## Step 6 — ground truth when something is unclear

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail
```

Decodes the raw `.mxunit` BSON. Authoritative, and the **only** source for sequence-flow
edges and `RefreshInClient` on delete actions. Use it whenever the YAML and MDL seem to
disagree, or when you need to prove a branch was added/removed.

## What to actually look for

Report findings with evidence (the diff hunk), not impressions.

- **Unreachable or duplicated conditions** — a nested split re-testing its parent's
  condition makes one branch dead. Real defects hide here.
- **Domain model changes** (`DomainModels$DomainModel`) — these mean schema migration.
  Always call out attribute type changes, deleted attributes/entities, and renames; they
  can destroy data. Check `mxcli impact -p <mpr> <Module.Entity>` for blast radius.
- **Security** — `AllowedModuleRoles` added/removed on microflows and pages; entity access
  rules. A page or microflow becoming reachable by more roles is a finding.
- **Commit / refresh flags** — `Commit: "No"`, `RefreshInClient: false` on actions whose
  results the user should see.
- **Editability / visibility** — widgets flipping `Editable: Never -> Always`, especially on
  compliance or audit fields.
- **Changes not mentioned in the commit message** — flag them explicitly and ask whether
  they were intentional.
- **Developer-local config** in `Settings$ProjectSettings` (personal server configurations,
  constants). Note that `PrivateValue` stores nothing in the `.mpr`, so no secret leaks —
  say so rather than raising a false alarm.

## Reporting

Lead with the risk-ranked findings, each with: the document, what changed, why it matters,
and the evidence. Then the full changed-document table. Separate **confirmed defects** from
**things needing the author's confirmation** — do not present an inference about business
intent as a finding.

Use `mxcli context -p <mpr> <Module.Doc> --depth 2` or `mxcli callers` when you need to say
what else a changed microflow affects.
