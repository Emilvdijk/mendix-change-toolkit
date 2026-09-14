---
name: mendix-change-report
description: Produce the complete Mendix change package in one pass — code review, test instructions, and customer/team change notes — from a commit range or a story/ticket id. Use when the user wants the full picture of a Mendix change set, "everything" about a release or a story like TICKET-123, a hand-off or release package, a PR write-up plus tests plus comms, or asks for more than one of review/tests/change-notes together. Also use before a release or deployment when the change set has not been analysed yet. Reconstructs real diffs from the binary .mpr/.mxunit files; costs more than the single-purpose skills because it collects once and produces all three deliverables.
---

# Complete Mendix change package

Review + test instructions + change notes for a commit range, from one shared pass over the real
model diff. Prefer this when more than one artifact is wanted: replaying commits is the expensive
step and it then happens once.

**Safety:** read-only mxcli commands only (`describe`, `context`, `callers`, `callees`, `refs`,
`impact`, `search`, `show`). Never mxcli write/`exec`. Studio Pro may stay open — the scripts read
a separate worktree copy and stop themselves if that copy is ever locked.

---

## Phase 0 — prerequisites

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

`doctor.sh` also flags two project-level things worth fixing before you start: `.mendix-cache`
not being git-ignored (add `/.mendix-cache/`), and a missing `mprcontents/` (pre-Mendix 10.18,
so `sweep.sh` is unavailable — the YAML and MDL paths still work).

**Never fall back to `git diff`, `git show`, or reading the `.mpr` directly.** Mendix stores its
model in binaries; any "diff" produced that way is meaningless or invented, and all three
deliverables built on it would be fiction. No toolkit, no report.

---

## Phase 1 — collect (once)

```bash
git status -sb && git log --oneline -20
```

**Settle the range and say what you chose.** By ticket:

```bash
git log --oneline --all --grep="TICKET-123"
```

If those commits are **contiguous**, use `<oldest>^..<newest>` — git then combines them and
detects renames across the set. If scattered, pass them as a list for a per-commit breakdown.
Check the neighbouring commits too: an untagged commit with a related subject is a scope question
worth raising, not something to silently include or exclude. "What I'm about to pull" is
`HEAD..origin/main`; "the last release" is `<tag>..HEAD`.

```bash
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'     # ~30s/commit, incremental
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary   # triage table
bash "$MXDIFF/invariants.sh" '<oldest>..<newest>'         # mechanical defect checks - run BEFORE reading
bash "$MXDIFF/review.sh" '<oldest>..<newest>'             # full YAML property diffs
bash "$MXDIFF/lint-diff.sh" <oldSha> <newSha>             # quality gate, changed docs only
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Module.SUB_Foo Module.ACT_Bar Module.SUB_Baz
```

**Subtract the export noise from the triage table before counting anything.** `+1/-1` rows whose
only changed line is `pseudocode:`, every `.flow.txt`, and `R100 {X => X_TRUNCATED_<hash>_}` at
`+0/-0` are all tooling artefacts. On one real range this took 340 documents down to 98.

**`invariants.sh` is not optional here.** Reading does not scale with range size but checking
does, and this skill is usually pointed at the widest ranges. Its output is candidates: confirm
each against the document before it becomes a finding in Section A, a test in Section B, or a
sentence in Section C. `cleared-association-consumed` and `enum-guard-mismatch` in particular
describe defects that span three documents and will not be found by reading one at a time.

**Read by risk class, not by diff size.** New microflows and nanoflows get read in full every
time — a new document has no "before", so diff magnitude ranks it at the bottom exactly when it
deserves the most attention. Pages get their properties read (security, conditional visibility,
editability, data sources) and their layout ignored.

New documents have no "before"; read their current state directly:

```bash
mxcli describe -p .mendix-cache/mxdiff-worktree/YourApp.mpr Module.SUB_New
mxcli describe -p .mendix-cache/mxdiff-worktree/YourApp.mpr entity Module.Entity
```

**Trace entry points** so tests are executable. `callers`/`refs` **do not index page-button
microflow calls** and will report "no callers" for a microflow a button calls daily — always
confirm against the exported model:

```bash
mxcli callers -p <project>.mpr Module.SUB_Foo
grep -rl "ACT_Foo" .mendix-cache/model-history --include="*.yaml"
```

Ground truth when sources disagree, or for flow edges / `RefreshInClient`:

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail
```

Tool division: YAML gives properties, security and commit flags; MDL gives readable logic; BSON
gives flow edges and settles disputes. Renames appear as `{A => B}` — never report those as an
unrelated delete plus add. A document at `0 change(s)` was re-saved but is semantically identical.

**Filter the lint output.** It lints whole changed *documents*, and a `DomainModels$DomainModel`
is one document — rule `002_0009` will list every attribute in the module, nearly all
pre-existing. Report only findings naming something this change touched. `005_0001` (incomplete
empty-string check) and `Error`-severity rules are the ones that reliably matter.

---

## Phase 2 — produce all three sections

### Section A — Review

Risk-ranked findings: document, what changed, why it matters, diff hunk as evidence.

Logic: unreachable/duplicated conditions; **`@excluded` activities** (a whole branch switched off
while still visible — check what it now falls through to, and whether the user still sees
success); **computed-but-unused values** (a `filter(...)` used only as an `if` guard while the
unfiltered list is passed on); ignored return values; `limit 1` retrieves with no sort.

Data/deployment: domain-model migrations — distinguish `persistent entity` from non-persistable
(the latter add nothing to the database); attribute type changes and deletions; **new members
left with no access rules** (works server-side, invisible on pages); uncommitted `change $X (...)`
relying on a caller's commit list, which for integrations is an idempotency bug — the remote call
happened, the local id did not persist, the retry duplicates it.

Security/UX: `AllowedModuleRoles`, entity access rules, `Commit: "No"`, `RefreshInClient: false`,
editability flips on compliance fields.

Process: **anything the commit message does not mention**; naming typos that reach a database
column or API; developer-local settings (note that `PrivateValue` leaks no secret — noise, not an
incident); defects introduced *and fixed* inside the range, reported as resolved so they are not
re-raised.

Separate confirmed defects from items needing the author's confirmation. Close with what was
clean, so the reader knows it was checked.

### Section B — Test instructions

Numbered `T1…Tn`, each with role/environment preconditions, steps and expected result. Derive
from the diff, not the commit message.

Cover: happy path per fix/feature (state the old broken behaviour for bug fixes); the other side
of every changed condition; empty/boundary cases; **each caller separately** where entry points
reach the same logic differently; **disabled paths** (`@excluded`) — test what happens instead;
regression on untouched logic in the same flow; integration error paths **including retry after
failure, checking the remote side for duplicates**; migration if the domain model changed;
denied-access tests if security changed.

Where the review found a defect, write the test to **expose** it and state both intended and
current expected results. Use human-visible captions and tab names, never internal widget names.
If a new field has no access rules, say how the tester should verify it instead (database, log,
debug flow).

### Section C — Change notes

Grouped by feature/screen as **New / Changed / Fixed / Deliberately disabled**, plain language,
no Mendix jargon. Write the customer note in the user's working language (Dutch customer → Dutch
note) and keep the team version separate.

Then **Before you deploy**: data impact (a fix is not retroactive — records damaged by the old
behaviour stay damaged); **no back-fill** (new integrations and fields apply only to records
processed after the release); migration and backup needs, additive vs destructive; access
changes; and any known open defects with their practical consequence — especially where wrong
data reaches an external system a third party can see.

Defects introduced and fixed within the range are not release notes.

---

## Rules across all three sections

- Evidence over impression: quote the diff.
- Never invent business rationale. Mark inferences as inferences and collect them in a single
  **Needs confirmation** list at the end, addressed to the user.
- Report faithfully: if a document could not be analysed, say which and why.
- Draft — do not send — anything customer-facing, especially data-loss statements.
- **State coverage.** End the Review section with `Reviewed N of M changed documents` and name
  every behaviour-bearing document not opened. "Read it, it was fine" and "never opened it" look
  identical to a reader otherwise, and the second is what lets a bug reach a tester.
- **One row per document in any changed-document table.** Collapsing a module into
  `BackgroundTask (new module) | 16 microflows, 4 enums` reads as coverage while being a list of
  things nobody looked at. A whole new module deserves its own pass — say so rather than folding
  it into a wider range.

## Output

One document: a one-paragraph summary of the range and the commits it covers, then Review, Test
instructions, Change notes, then **Needs confirmation**. Write it to a file and offer it to the
user rather than only printing it — these run long. Note any tool caveat that shaped the analysis
(e.g. an entry point that `refs` missed) so the next reader can trust the method.
