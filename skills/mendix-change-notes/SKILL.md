---
name: mendix-change-notes
description: Write customer- or team-facing change notes / release notes for Mendix changes, based on the real model diff rather than commit messages. Use whenever the user wants to communicate what changed in a Mendix project to non-developers — release notes, changelog, sprint/demo summary, "what do I tell the customer", "write it up for the team", deployment notes, or a summary of what a release or story (e.g. TICKET-123) contains. Translates binary .mpr/.mxunit diffs into plain-language impact, and flags data-loss, migration and disabled-behaviour consequences that must be communicated.
---

# Customer / team change notes from real Mendix changes

Turns a commit range into language a non-developer can act on. Commit messages are not the
source of truth — the model diff is.

## Step 0 — prerequisites

This skill drives scripts that are **not** bundled with it:

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

**Never write change notes from commit messages alone**, and never fall back to `git diff` /
`git show` / reading the `.mpr` — Mendix stores its model in binaries, so any diff produced that
way is meaningless. Notes written without the real diff will confidently describe changes that
did not happen and miss the ones that did.

## Step 1 — get the real change set

```bash
git log --oneline --all --grep="TICKET-123"                 # commits for a story
git log --oneline <oldest>..<newest>                     # what the authors said
bash "$MXDIFF/build-history.sh" '<oldest>^..<newest>'    # ~30s per commit, incremental
bash "$MXDIFF/review.sh" '<oldest>..<newest>' --summary  # what actually changed
bash "$MXDIFF/mdl-diff.sh" <oldSha> <newSha> Module.SUB_Foo Module.ACT_Bar
```

Compare the two lists. Commits routinely contain changes their message does not mention, and
messages routinely describe intent the diff does not support. The diff wins — and the
discrepancy is itself worth reporting to the team.

## Step 2 — group by what the user experiences

Group by **feature or screen**, never by commit or by document. One feature usually spans a
page, several microflows and a domain-model change; the reader cares about the feature. A
cluster of new documents sharing a name prefix is one feature, not fifteen changes.

Sort by user impact, not technical size. A one-line editability change on a compliance field can
matter more than a 13,000-line new page.

## Step 3 — classify each item

- **New** — capability that did not exist.
- **Changed** — existing behaviour now works differently. Say what it did before; that is what
  the reader remembers.
- **Fixed** — was broken, now works. State the symptom the user would have noticed, not the
  cause. "The signature was not saved" beats "duplicated condition in the save microflow".
- **Deliberately disabled** — the diff shows `@excluded` activities. Real, user-visible, and
  almost never in the commit message. Describe what now happens instead (typically: the action
  completes and reports success without doing anything).
- **Internal** — refactors, renames, layout, mappings and JSON structures with no independent
  behaviour. One summary line, or omit entirely from a customer note. Never pad with these.

Defects that were introduced **and fixed inside the range** are not release notes. Leave them out
of the customer version; a single line in the team version at most.

## Step 4 — the consequences section (do not skip)

This is the part that gets missed and the part that causes incidents.

- **Data impact.** If a bug destroyed or corrupted data before the fix, existing records are
  still affected — the fix is not retroactive. Say so and say what the recovery action is
  ("these work orders must be re-signed"). Derive it from the *old* behaviour in the MDL diff.
- **No back-fill.** New integrations and new fields apply only to records created or processed
  after the release. Existing records are not sent or populated retroactively. State it
  explicitly; users assume otherwise.
- **Migration.** Any `DomainModels$DomainModel` change means schema migration. Distinguish
  additive changes (new attributes/associations — low risk) from type changes and deletions
  (can drop data). Non-persistable entities add nothing to the database — do not describe them
  as a migration.
- **Behaviour users must be told about** — fields becoming editable/read-only, changed
  validation, defaults, statuses, and anything now silently skipped.
- **Access.** Changed roles or entity access rules — who can now see or do something new. Also
  worth a line when new fields have *no* access rules, since they will not appear on screens.
- **Known open defects** in the release, if the review found any, with the practical
  consequence — especially where wrong data reaches an external system a third party can see.

## Rules

- Plain language, no Mendix jargon. No microflow, entity or widget names in a customer-facing
  note. A team version may carry them in a technical appendix.
- Write in the language the user is working in. For a Dutch customer, draft the customer note in
  Dutch and keep the team version in the team's working language.
- **Never invent business rationale.** Describe what changed and its effect. Mark inferences as
  inferences and ask for confirmation.
- Flag anything needing sign-off *before* sending — especially data-loss and "not retroactive"
  statements. Present those as drafts to confirm, not settled fact.
- If the diff shows something you cannot explain in user terms, put it in a short "needs input
  from the developer" section rather than guessing or dropping it.

## Output

1. A short summary line — what this release is about.
2. Grouped items: **New / Changed / Fixed / Disabled**, each 1–3 plain sentences.
3. **Before you deploy / what you need to know** — data impact, no back-fill, migration, access,
   known open defects.
4. **Needs confirmation** — inferences and anything unexplained, addressed to the user.

Offer both a customer version (no internals) and a team version (with the technical appendix)
when the audience is not stated.
