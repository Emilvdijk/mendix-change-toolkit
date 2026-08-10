---
name: mendix-review
description: Code-review Mendix changes across one or more git commits. Use whenever the user wants to review, inspect, audit, or understand what changed in a Mendix project between commits, branches, or since a given commit — including "what did this commit do", "review the last N commits", "review all commits for CLE-123 / this story / this ticket", "what's in this PR", "what am I about to pull", "diff these commits". Mendix commits look empty in git (Bin NNN -> NNN bytes), so this skill reconstructs real, readable diffs from the .mpr/.mxunit binaries. Also use when a Mendix change needs risk assessment before deploying (domain-model migrations, security role changes, disabled or unreachable logic).
---

# Review Mendix changes across commits

Mendix stores everything in binary (`YourApp.mpr` + `mprcontents/**.mxunit`), so `git diff`
shows nothing but byte counts. This skill rebuilds genuine diffs.

**Safety:** only read-only mxcli commands (`describe`, `context`, `callers`, `callees`, `refs`,
`impact`, `search`, `show`). Never mxcli write/`exec`. Studio Pro may stay open — the scripts
read a separate worktree copy and will stop themselves if that copy is ever locked.

## Step 0 — prerequisites

This skill drives scripts that are **not** bundled with it. Resolve and check them first:

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
bash "$MXDIFF/doctor.sh"     # also checks git, node 18+, mxcli, mxlint 3.17+
```

If that path does not exist, **stop and tell the user.** Installing is `git clone` of the
`mendix-change-toolkit` bundle then `bash install.sh` (Windows:
`powershell -ExecutionPolicy Bypass -File install.ps1`), which installs to `~/.claude/mxdiff/`
and applies to every project on the machine. Ask the user for the repo URL if you don't have it.

**Never fall back to `git diff`, `git show`, or reading the `.mpr` directly.** Mendix stores its
model in binaries; any "diff" produced that way is meaningless or invented. No toolkit, no
review — say so rather than guessing.

## Step 1 — settle the range

Don't assume `HEAD` is what the user means.

```bash
git status -sb && git log --oneline -20
```

**By ticket/story** — the usual case:

```bash
git log --oneline --all --grep="CLE-378"
```

Check whether those commits are **contiguous**. If they are, the range is `<oldest>^..<newest>`
— use it, because git then combines them and detects renames across the whole set. If they are
scattered, pass them as a list instead (per-commit breakdown). Also look at the commits
immediately before and after: neighbours with related subjects but no ticket tag are common, and
worth raising as a scope question rather than silently including or excluding.

State the range you settled on.

## Step 2 — build the model history (once per range)

```bash
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'
```

~30s per commit, incremental — already-built commits are skipped. Run it in the background for
more than ~5 commits.

## Step 3 — triage

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary
```

Changed documents by module with `+/-` magnitude. Renames appear as `{A => B}` — never report
those as an unrelated delete plus add. Large `+/-` on a page is usually layout; small `+/-` on a
microflow is often the real behaviour change.

## Step 4 — read the logic

Pass every behaviour-bearing document in one call — the worktree checkouts are the slow part and
get shared:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Module.SUB_Foo Module.ACT_Bar
```

For properties (security roles, commit/refresh flags, XPath, widget settings, attribute types)
read the YAML instead:

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>'
```

New documents have no "before", so `mdl-diff` prints the full definition. For big new microflows
read the current state directly:

```bash
mxcli describe -p .mendix-cache/mxdiff-worktree/YourApp.mpr Module.SUB_New
```

## Step 5 — quality gate scoped to the change

```bash
bash "$MXDIFF/lint-diff.sh" <oldSha> <newSha>
```

**Filter the output.** It lints whole changed *documents*, and a `DomainModels$DomainModel` is
one document — so rule `002_0009` ("has a default value set") will list every attribute in the
module, nearly all pre-existing. Report only findings that name something this change actually
touched. Rules that reliably matter: `005_0001` (incomplete empty-string check), and anything
`Error`-severity.

## Step 6 — ground truth when something is unclear

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail
```

Raw `.mxunit` BSON. Authoritative, and the **only** source for sequence-flow edges and
`RefreshInClient` on delete actions. A document listed with `0 change(s)` was re-saved but is
semantically identical — say so rather than reporting it.

## What to look for

Evidence over impression: quote the diff hunk.

**Logic defects**
- **Unreachable or duplicated conditions** — a nested split re-testing its parent's condition
  leaves one branch dead.
- **`@excluded` activities** — `mdl-diff` renders these inline. They are excluded from the
  build, so an entire branch can be switched off while still visibly present. Check what the
  branch now falls through to: a disabled path that still `return true` and shows a success
  message to the user is a finding even when the exclusion is deliberate.
- **Computed-but-unused values** — e.g. `$Filtered = filter($List, X)` used only as an `if`
  guard while the *unfiltered* list is passed onward. Trace every new variable to where it is
  actually consumed.
- **Ignored return values** — a `$Success = call microflow ...` that is never tested.
- **Retrieves with `limit 1` and no sort** — non-deterministic if more than one row can match.

**Data and deployment**
- **Domain model changes** mean migration. Check `persistent entity` in
  `mxcli describe entity Module.Entity` (or `Persistable:` in the YAML) — non-persistable
  entities add nothing to the database. Call out attribute type changes, deletions and renames;
  they can destroy data. `mxcli impact -p <mpr> Module.Entity` gives blast radius.
- **New members without access rules.** New attributes and associations frequently keep
  `AccessRights: None`. Microflows are unaffected (they bypass entity access), so the feature
  works — but the members are invisible to pages. Compare the grants in
  `mxcli describe entity` against the new members.
- **Uncommitted changes relying on a caller** — `change $X (...)` with the commit happening in a
  parent flow's list. Verify the commit runs on every path, especially after `on error rollback`.
  For integrations this is an idempotency bug: the external call already happened, the local id
  did not persist, and the retry duplicates it.

**Security and UX**
- `AllowedModuleRoles` added/removed on microflows and pages; changed entity access rules.
- `Commit: "No"` / `RefreshInClient: false` on actions whose results the user should see.
- Widgets flipping `Editable: Never -> Always`, especially on compliance or audit fields.

**Process**
- **Anything the commit message does not mention** — flag it and ask whether it was intended.
- **Naming typos that reach the database or an API** (attribute and constant names) — cheapest
  to fix before there is production data, since a rename later is itself a migration.
- Developer-local config in `Settings$ProjectSettings`. Note that `PrivateValue` stores nothing
  in the `.mpr`, so no secret leaks — say so rather than raising a false alarm.
- **Defects introduced and fixed inside the range** — report as resolved, with a one-liner, so
  they are not re-raised later.

## Reporting

Lead with risk-ranked findings: document, what changed, why it matters, evidence. Then the
changed-document table. Separate **confirmed defects** from **items needing the author's
confirmation** — never present an inference about business intent as a finding. Close with a
short list of what was clean, so the reader knows it was checked.
