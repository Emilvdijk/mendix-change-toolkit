---
name: mendix-test-instructions
description: Write test instructions for Mendix changes, derived from what actually changed in the commits rather than guesswork. Use whenever the user wants test steps, a test plan, test cases, acceptance/QA instructions, a regression checklist, or "how do we test this" for a Mendix project — for a single commit, a release, a branch, or everything they are about to pull. Reconstructs the real diff from the binary .mpr/.mxunit files, traces how a user reaches the changed logic, and produces numbered, executable steps with preconditions, roles and expected results.
---

# Test instructions from real Mendix changes

Produces test steps grounded in the actual model diff — not in the commit message, which is
frequently incomplete or wrong about scope.

**Safety:** close Studio Pro first — mxcli can corrupt an open project. Read-only mxcli
commands only.

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
```

## Step 1 — establish what changed

```bash
bash "$MXDIFF/doctor.sh"                                    # first run only
git status -sb && git log --oneline -15                     # settle the range
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'       # ~30s per commit, incremental
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary
```

Then read the logic for each changed flow:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Project.SUB_Foo Project.ACT_Bar
```

You cannot write good tests without this step. The diff tells you the *behaviour* that
changed; the commit message usually does not.

## Step 2 — find how a user reaches the changed logic

A test step is only executable if the tester can trigger it through the UI. For each changed
microflow/nanoflow, find its entry points:

```bash
mxcli callers -p <project>.mpr Project.SUB_Foo
mxcli context -p <project>.mpr Project.SUB_Foo --depth 2
```

Walk up until you reach a page, button, or scheduled/after-startup event. That is the
starting point of the test. If a changed sub-microflow is called from three pages, each
caller is a separate test case, because the surrounding state differs.

For changed pages/snippets, get the widget's label, bound attribute and containing tab so
the tester can find it on screen:

```bash
bash "$MXDIFF/sweep.sh" <oldSha> <newSha> detail    # shows the widget path
node "$MXDIFF/findwidget.js" <decoded.bin> <widgetName>
```

Use the human-visible caption (e.g. "LMRA Uitgevoerd?" on tab "Uitvoerings gegevens"), never
the internal widget name like `radioButtons4` — a tester cannot find that.

## Step 3 — determine the roles needed

Check who can execute the changed logic:

```bash
bash "$MXDIFF/review.sh" '<oldest>..<newest>' | grep -A3 AllowedModuleRoles
```

`mxcli describe` also emits `grant execute on microflow ... to <roles>;`. State the required
role in the test preconditions — a tester logged in as the wrong role gets a false failure.

## Step 4 — write the instructions

Structure every test as: **precondition → numbered steps → expected result**. One behaviour
per test. Number them `T1`, `T2`, … so they can be referenced in a ticket.

Cover these categories, in this order:

1. **The happy path of the fix/feature** — the thing that was broken now works, or the new
   capability does what it should. Where a bug is being fixed, state the old broken
   behaviour too, so the tester can recognise a regression.
2. **The other side of every changed condition.** If the diff changed an `if`, there are at
   least two tests. If a branch was deleted, test that its case now behaves the new way.
3. **Empty / boundary cases** visible in the diff — empty retrieves, zero quantities, empty
   associations, `head()` on an empty list.
4. **Regression around the change.** Logic in the *same* flow that was not touched but runs
   on the same path still needs a smoke test, because the flow was re-saved. Read the
   unchanged parts of the MDL and derive these.
5. **Data migration**, if any `DomainModels$DomainModel` changed. Attribute type changes and
   deletions need an explicit "existing records still load and display correctly" test
   against a copy of production-like data.
6. **Security**, if `AllowedModuleRoles` or access rules changed — test with a role that
   should *not* have access, not only with one that should.

## Rules

- Every step must be executable by someone who has not read the code. No internal names.
- Never invent business intent. If the diff shows behaviour whose *desirability* is unclear
  (e.g. an existing signature is deleted when a checkbox is ticked), write the test for the
  behaviour as implemented **and** add an explicit "confirm with the business" note.
- If a change is not user-observable (refactor, rename, layout), say so rather than
  fabricating a test for it.
- Call out any change you could not derive a test for, and why.

## Output

A numbered list of tests, each with environment/role preconditions, steps, and expected
results — followed by a short "needs confirmation" section for anything ambiguous, and a
note of what was deliberately left untested.
