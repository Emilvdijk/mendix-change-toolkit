---
name: mendix-change-notes
description: Write customer- or team-facing change notes / release notes for Mendix changes, based on the real model diff rather than commit messages. Use whenever the user wants to communicate what changed in a Mendix project to non-developers — release notes, changelog, sprint/demo summary, "what do I tell the customer", "write it up for the team", deployment notes, or a summary of what a release contains. Translates binary .mpr/.mxunit diffs into plain-language impact, and flags data-loss and migration consequences that must be communicated.
---

# Customer / team change notes from real Mendix changes

Turns a commit range into language a non-developer can act on. The commit messages are not
the source of truth — the model diff is.

**Safety:** close Studio Pro first — mxcli can corrupt an open project. Read-only mxcli only.

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
```

## Step 1 — get the real change set

```bash
bash "$MXDIFF/doctor.sh"                                 # first run only
git log --oneline <oldest>..<newest>                     # what the authors said
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'    # ~30s per commit, incremental
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary  # what actually changed
```

Compare the two. Commits routinely contain changes their message does not mention, and
messages routinely describe intent that the diff does not support. Where they disagree,
the diff wins — and the discrepancy is itself worth reporting to the team.

Read the behaviour for anything user-facing:

```bash
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Project.SUB_Foo Project.ACT_Bar
```

## Step 2 — group by what the user experiences

Group by **feature or screen**, never by commit or by document. A single feature usually
spans a page, several microflows and a domain-model change; the reader cares about the
feature. New folders and a cluster of new documents sharing a prefix (e.g. everything named
`*WorkOrderPlanner*`) are one new feature, not fifteen changes.

Sort by user impact, not technical size. A one-line editability change on a compliance field
can matter more than a 13,000-line new page.

## Step 3 — classify each item

- **New** — capability that did not exist.
- **Changed** — existing behaviour now works differently. Say what it did before, since that
  is what the reader remembers.
- **Fixed** — was broken, now works. State the symptom the user would have noticed, not the
  cause. "The signature was not saved" beats "duplicated condition in the save microflow".
- **Internal** — refactors, renames, layout. Usually one summary line, or omitted for a
  customer-facing note. Never pad the note with these.

## Step 4 — the consequences section (do not skip)

This is the part that gets missed and the part that causes incidents.

- **Data impact.** If a bug destroyed or corrupted data before the fix, existing records are
  still affected — the fix is not retroactive. Say so explicitly and say what the recovery
  action is (e.g. "these work orders must be re-signed"). Derive this from the *old*
  behaviour in the MDL diff.
- **Migration.** Any `DomainModels$DomainModel` change means schema migration. Attribute type
  changes and deletions can drop data. Flag for a backup and a staging run first.
- **Behaviour users must be told about.** Fields becoming editable/read-only, changed
  validation, changed defaults, changed statuses.
- **Access.** Changed `AllowedModuleRoles` or entity access rules — who can now see or do
  something they could not before.

## Rules

- Plain language, no Mendix jargon. No microflow names, entity names, or widget names in a
  customer-facing note. A team-facing note may include them in a technical appendix.
- **Never invent business rationale.** Describe what changed and its effect. If you infer
  intent, mark it as an inference and ask for confirmation.
- Flag anything that needs sign-off *before* sending — especially data-loss statements.
  Present those as drafts for the user to confirm, not as settled fact.
- If the diff shows a change you cannot explain in user terms, list it in a short "needs
  input from the developer" section rather than guessing or silently dropping it.

## Output

1. A short summary line — what this release is about.
2. Grouped items: **New / Changed / Fixed**, each 1–3 plain sentences.
3. **Before you deploy / what you need to know** — data impact, migration, actions required.
4. **Needs confirmation** — inferences and anything unexplained, addressed to the user.

Offer both a customer version (no internals) and a team version (with the technical
appendix) when the audience is not stated.
