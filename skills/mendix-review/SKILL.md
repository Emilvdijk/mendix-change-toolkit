---
name: mendix-review
description: Code-review Mendix changes across one or more git commits. Use whenever the user wants to review, inspect, audit, or understand what changed in a Mendix project between commits, branches, or since a given commit — including "what did this commit do", "review the last N commits", "review all commits for TICKET-123 / this story / this ticket", "what's in this PR", "what am I about to pull", "diff these commits". Mendix commits look empty in git (Bin NNN -> NNN bytes), so this skill reconstructs real, readable diffs from the .mpr/.mxunit binaries. Also use when a Mendix change needs risk assessment before deploying (domain-model migrations, security role changes, disabled or unreachable logic).
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

If that path does not exist, **stop and tell the user** and offer to install it:

```bash
git clone https://github.com/Emilvdijk/mendix-change-toolkit.git
cd mendix-change-toolkit && bash install.sh   # Windows: install.ps1 via PowerShell
```

That installs to `~/.claude/mxdiff/` and applies to every project on the machine. The repo is
private: if the clone fails with a permission error, the user needs to be granted access to it.

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
git log --oneline --all --grep="TICKET-123"
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

**Subtract the export noise before counting anything.** Two artefacts routinely inflate the
table several-fold, and both are tooling, not model change:

- `+1/-1` rows whose only changed line is `pseudocode:` — the toolkit moved between storing
  pseudocode in a sibling `.flow.txt` and inlining it. Same for every `.flow.txt` in the diff.
- `R100 {X => X_TRUNCATED_<hash>_}` at `+0/-0` — the long-filename truncation scheme changed.

Say how many documents survive the filter. On one real range this was 340 → 98.

**Then declare the plan before reading anything.** Count the behaviour-bearing documents
(microflows, nanoflows, domain models, enums, mappings — pages do not count) and state:

- the range, and how many documents genuinely changed;
- whether this is a **sweep** (aggregate risk: migrations, security, secrets, settings — fine at
  any range size) or a **deep pass** (logic correctness — roughly 25 behaviour-bearing documents
  before quality falls off);
- if the range is too big for a deep pass, say so **now** and offer to split by module or ticket.

Getting this wrong silently is the main failure mode of this skill: a wide range produces a
confident-looking report that never opened two thirds of the new logic.

## Step 4 — read the logic

Pass every behaviour-bearing document in one call — the worktree checkouts are the slow part and
get shared:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Module.SUB_Foo Module.ACT_Bar
```

**Read by risk class, never by diff size.** Diff magnitude is exactly the signal that does not
exist on a new document: `+310/-0` tells you nothing about where the risk is, so added files fall
through a magnitude-ranked review every time. Use this table instead:

| Document | How much to read | Why |
|---|---|---|
| **New microflow / nanoflow** | **In full, always** | No "before" means no diff signal at all, and new logic is where the bugs are. Never sample these. |
| Modified microflow / nanoflow | The logic diff, plus enough context to see which branch changed | |
| Domain model | Structural parse: entities and attributes added/removed/retyped, persistability, access rules | Migration and security live here |
| Enum, constant, mapping, JSON structure | Full, they are small | A single wrong enum value silently reroutes a whole flow |
| **Page / snippet** | **Properties only** — security roles, conditional visibility, editability, data sources. Never the layout | A page diff is routinely 100k+ lines of markup with nothing behavioural in it. Skipping layout is what makes the budget work |

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

**Keep a worklist.** Every behaviour-bearing document ends the review as either READ or
SKIPPED-with-a-reason. "Not read" and "read, nothing found" must never look the same in the
output — see Reporting.

## Step 5 — quality gate scoped to the change

```bash
bash "$MXDIFF/lint-diff.sh" <oldSha> <newSha>
```

**Filter the output.** It lints whole changed *documents*, and a `DomainModels$DomainModel` is
one document — so rule `002_0009` ("has a default value set") will list every attribute in the
module, nearly all pre-existing. Report only findings that name something this change actually
touched. Rules that reliably matter: `005_0001` (incomplete empty-string check), and anything
`Error`-severity.

## Step 6 — mechanical invariant checks

```bash
bash "$MXDIFF/invariants.sh" '<oldest>..<newest>'          # scoped to changed documents
bash "$MXDIFF/invariants.sh" '<oldest>..<newest>' --all    # whole model, for an audit
```

**Run this on every review, and run it before you start reading.** Reading does not scale with
range size; checking does. These checks cost the same per document whether the range is 4
documents or 400, so they are the only thing that stops a wider range letting more through.
Each check exists because a real defect got past a manual review.

| Check | Severity | Catches |
|---|---|---|
| `enum-guard-mismatch` | HIGH | A document writes `Entity.Attr = X` but every XPath guard on that same entity's attribute tests a disjoint set. Copy-paste slips that silently reroute a flow. Entity-qualified on purpose — comparing bare attribute names misfires on every `Status` in the model |
| `cleared-association-consumed` | HIGH | A creator sets a dispatch attribute to `V` and clears association `A`, but the handler `V` dispatches to retrieves over `A`. Three documents deep, so no per-document read finds it |
| `secret-shared-value` | HIGH | API keys and encryption keys stored as `Settings$SharedValue` — committed to the `.mpr`, therefore permanent in git |
| `anonymous-grant` | HIGH | An entity that *newly* grants a role named `Anonymous`/`Guest` |
| `persistent-data-removed` | HIGH | A persistable entity deleted, or an attribute dropped from one — irreversible on deploy |
| `gate-constant-never-configured` | MEDIUM | A new Boolean constant defaulting to `False` that gates logic and is set in no configuration — the feature ships inert |
| `guard-already-enforced` | MEDIUM | A list is re-filtered inside a loop against a condition its own retrieve XPath already enforced — dead branch plus a wasted retrieve |
| `retrieve-nondeterministic` | MEDIUM | `SingleObject: true` with no sort order |
| `date-format-guard-inconsistent` | MEDIUM | A document that guards some `formatDateTime*` calls against empty and leaves others bare |
| `pair-skew` | MEDIUM | A document dominated by one domain family with a stray line referencing a rival one. Heuristic backstop for `enum-guard-mismatch` |
| `unused-result` | LOW | A result variable assigned and never read |

`cleared-association-consumed` reads the dispatch table out of the rendered `pseudocode:` block,
so it only works on documents the toolkit has rendered pseudocode for. It is silent rather than
wrong when that is missing.

The output is **candidates, not findings**. `pair-skew` in particular is heuristic. Open every
candidate, confirm it against the document, and drop the ones that do not hold — then report the
survivors with evidence like any other finding. Never paste this output into a report as-is.

## Step 7 — ground truth when something is unclear

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

**State coverage explicitly.** The report must end with a line of the form

> Reviewed 23 of 98 changed documents. Not opened: *(list them)*.

and name every behaviour-bearing document that was not read. A reader cannot tell the difference
between "read it, it was fine" and "never opened it" unless you tell them, and the second one is
what lets a bug reach a tester.

**One row per document in the changed-document table.** Never collapse several documents into a
single row — `BackgroundTask (new module) | 16 microflows, 2 nanoflows, 4 enums` reads as
coverage while actually being the list of things nobody looked at. If the table gets long, group
by module with the documents still individually listed.

**A whole new module always gets its own pass.** Inside a wider range it will be summarised into
a row and never read. Say so and offer the separate review rather than folding it in.
