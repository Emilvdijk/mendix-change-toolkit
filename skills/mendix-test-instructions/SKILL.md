---
name: mendix-test-instructions
description: Write test instructions for Mendix changes, derived from what actually changed in the commits rather than guesswork. Use whenever the user wants test steps, a test plan, test cases, acceptance/QA instructions, a regression checklist, or "how do we test this" for a Mendix project — for a single commit, a story/ticket like CLE-123, a release, a branch, or everything they are about to pull. Reconstructs the real diff from the binary .mpr/.mxunit files, traces how a user reaches the changed logic, and produces numbered, executable steps with preconditions, roles and expected results.
---

# Test instructions from real Mendix changes

Test steps grounded in the actual model diff — not in the commit message, which is frequently
incomplete or wrong about scope.

**Safety:** read-only mxcli commands only. Studio Pro may stay open; the scripts read a separate
worktree copy.

## Step 0 — prerequisites

This skill drives scripts that are **not** bundled with it:

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
bash "$MXDIFF/doctor.sh"     # also checks git, node 18+, mxcli, mxlint 3.17+
```

If that path does not exist, **stop and tell the user.** Installing is `git clone` of the
`mendix-change-toolkit` bundle then `bash install.sh` (Windows:
`powershell -ExecutionPolicy Bypass -File install.ps1`), which installs to `~/.claude/mxdiff/`
and applies to every project on the machine. Ask the user for the repo URL if you don't have it.

**Never fall back to `git diff`, `git show`, or reading the `.mpr` directly.** Mendix stores its
model in binaries; any "diff" produced that way is meaningless or invented — and test steps
derived from it would be fiction. No toolkit, no test instructions.

## Step 1 — establish what changed

```bash
git log --oneline --all --grep="CLE-123"                    # commits for a ticket
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'       # ~30s per commit, incremental
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Module.SUB_Foo Module.ACT_Bar
```

You cannot write good tests without the MDL step. The diff tells you the *behaviour* that
changed; the commit message usually does not.

## Step 2 — find how a user reaches the changed logic

A test step is only executable if the tester can trigger it through the UI.

```bash
mxcli callers -p <project>.mpr Module.SUB_Foo
mxcli context -p <project>.mpr Module.SUB_Foo --depth 2
```

**`callers` and `refs` do not index page-button microflow calls.** They will happily report
"no callers found" for a microflow that a button calls every day. Always confirm against the
exported model before concluding anything is unreachable:

```bash
grep -rl "ACT_SalesInvoice_SendInvoice" .mendix-cache/model-history --include="*.yaml"
```

The hits name the pages and microflows that reference it. Walk up until you reach a page,
button, or scheduled/after-startup event — that is the start of the test. If a changed
sub-microflow is called from several places, **each caller is a separate test case**, because
the surrounding state differs and the callers often differ from each other (one may filter its
input while another does not).

For changed pages/snippets, get the widget's label, bound attribute and containing tab:

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail    # shows the widget path
```

Use the human-visible caption ("LMRA Uitgevoerd?" on tab "Uitvoerings gegevens"), never the
internal name like `radioButtons4` — a tester cannot find that.

## Step 3 — determine the roles needed

`mxcli describe` ends microflows with `grant execute on microflow ... to <roles>;`. State the
required role in the preconditions — a tester in the wrong role produces a false failure. Check
entity access too when the test needs to *see* data: new attributes and associations often ship
with no access rights, so a value can be set server-side yet be invisible on every page. If so,
say how the tester should verify it instead (database, log, or a debug flow).

## Step 4 — write the instructions

Structure: **precondition → numbered steps → expected result**. One behaviour per test, numbered
`T1`, `T2`, … so they can be referenced in a ticket.

Cover, in this order:

1. **Happy path** of each fix/feature. For a bug fix, state the old broken behaviour too, so a
   regression is recognisable.
2. **The other side of every changed condition.** A changed `if` is at least two tests. If a
   branch was deleted, test that its case now behaves the new way.
3. **Empty and boundary cases** visible in the diff — empty retrieves, zero quantities, empty
   associations, `head()` on an empty list, records with no file contents.
4. **Known-divergent callers.** Where two entry points reach the same changed logic by different
   routes, test both and explicitly compare. This is where filtering and validation differences
   surface.
5. **Disabled paths.** If the diff shows `@excluded` activities, write a test for what now
   happens instead — typically "action silently does nothing and still reports success". Mark it
   as behaviour to confirm with the business rather than a pass/fail.
6. **Regression** on untouched logic in the same flow — it was re-saved, and it runs on the same
   path. Read the unchanged parts of the MDL to derive these.
7. **Error paths** for integrations: unavailable token/credentials, and the remote system
   rejecting the call. For integrations also test **retry after a failure** and check for
   duplicates on the remote side — a local id that is set but not committed before a rollback
   causes double-sends.
8. **Data migration**, if any `DomainModels$DomainModel` changed — "existing records still load
   and display correctly" against production-like data.
9. **Security**, if roles or access rules changed — test with a role that should *not* have
   access, not only one that should.

## Rules

- Every step must be executable by someone who has not read the code. No internal names.
- Where the diff shows a defect, write the test so it **exposes** it, and state both the intended
  and the current expected result. Do not quietly write the test to match buggy behaviour.
- Never invent business intent. Where the desirability of a behaviour is unclear, write the test
  for the behaviour as implemented **and** add an explicit "confirm with the business" note.
- If a change is not user-observable (refactor, rename, layout, new mappings/JSON structures used
  only by another tested flow), say so rather than fabricating a test.
- Call out any change you could not derive a test for, and why.

## Output

Numbered tests with environment/role preconditions, steps and expected results; then a short
"needs confirmation" section; then an explicit note of what was deliberately left untested.
