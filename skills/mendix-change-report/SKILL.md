---
name: mendix-change-report
description: Produce the complete Mendix change package in one pass — code review, test instructions, and customer/team change notes — from a commit range. Use when the user wants the full picture of a Mendix change set, "everything" about a release, a hand-off or release package, a PR write-up plus tests plus comms, or asks for more than one of review/tests/change-notes together. Also use before a release or deployment when the change set has not been analysed yet. Reconstructs real diffs from the binary .mpr/.mxunit files; costs more than the single-purpose skills because it collects once and produces all three deliverables.
---

# Complete Mendix change package

Review + test instructions + change notes for a commit range, produced from one shared pass
over the real model diff. Prefer this when the user needs more than one of those artifacts;
the expensive step (replaying commits) then happens once.

**Safety:** close Studio Pro before running anything — mxcli can corrupt an open project.
Read-only mxcli commands only (`describe`, `context`, `callers`, `callees`, `refs`, `impact`,
`search`, `show`). Never mxcli write/`exec`.

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
```

---

## Phase 1 — collect (do this once)

```bash
bash "$MXDIFF/doctor.sh"          # first run on a machine/project
git status -sb && git log --oneline -20
```

Settle the range explicitly and say what you chose. "What I'm about to pull" is
`HEAD..origin/main`; "the last release" is `<tag>..HEAD`; "this commit" is `<sha>^..<sha>`.
If the user is behind the remote, note it — objects already fetched work offline even if
`git pull` cannot authenticate.

```bash
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'
```

~30s per commit, incremental. For more than ~5 commits run it in the background and continue
when it completes.

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary   # triage table
bash "$MXDIFF/review.sh" '<oldest>..<newest>'             # full YAML property diffs
bash "$MXDIFF/lint-diff.sh" <oldSha> <newSha>             # quality gate, changed docs only
```

Then read the logic for every behaviour-bearing document in one call:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Project.SUB_Foo Project.ACT_Bar Resource.SUB_Baz
```

Trace entry points for anything user-facing, so tests are executable:

```bash
mxcli callers -p <project>.mpr Project.SUB_Foo
mxcli context -p <project>.mpr Project.SUB_Foo --depth 2
```

Use ground truth whenever sources disagree, or for flow edges / `RefreshInClient`:

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail
```

Note the tool division: the YAML diff gives properties, security and commit flags; MDL gives
readable logic; BSON gives flow edges and settles disputes. Renames appear as `{A => B}` in
the review table — never report those as an unrelated delete plus add.

---

## Phase 2 — produce all three sections

### Section A — Review

Risk-ranked findings, each with the document, what changed, why it matters, and the diff hunk
as evidence. Look for: unreachable/duplicated conditions, domain-model migrations, security
role changes, `Commit: "No"` / `RefreshInClient: false`, editability flips on compliance
fields, and **anything the commit message does not mention**. Separate confirmed defects from
items needing the author's confirmation. Note when developer-local settings were committed —
and that `PrivateValue` leaks no secret, so it is noise, not an incident.

### Section B — Test instructions

Numbered `T1…Tn`, each with role/environment preconditions, steps, and expected result.
Derive from the diff, not the commit message. Cover: the happy path of each fix/feature; the
other side of every changed condition; empty/boundary cases; regression on untouched logic in
the same flow; data migration if the domain model changed; and denied-access tests if
security changed. Use human-visible captions and tab names, never internal widget names.
State the old broken behaviour for bug fixes so a regression is recognisable.

### Section C — Change notes

Grouped by feature/screen as **New / Changed / Fixed**, in plain language with no Mendix
jargon. Then a **Before you deploy** section covering data impact (a fix is not retroactive —
records damaged by the old behaviour stay damaged), migration and backup needs, behaviour
users must be told about, and access changes. Offer a customer version and a team version
when the audience is unstated.

---

## Rules across all three sections

- Evidence over impression: quote the diff.
- Never invent business rationale. Mark inferences as inferences and collect them in a single
  **Needs confirmation** list at the end, addressed to the user.
- Report faithfully: if a document could not be analysed, say which and why, rather than
  omitting it silently.
- Draft — do not send — anything customer-facing, especially data-loss statements.

## Output

Deliver the three sections in one document (Review, Test instructions, Change notes), preceded
by a one-paragraph summary of the range analysed and the commits it covers, and followed by
the **Needs confirmation** list. Write it to a file and offer it to the user rather than only
printing it, when it is long.
