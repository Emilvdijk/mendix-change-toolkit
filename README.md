# mendix-change-toolkit

Real diffs for Mendix projects, and eight Claude skills built on them — from triaging a story
nobody has started to building one into the model.

Mendix stores the whole model in binaries (`YourApp.mpr` + `mprcontents/**.mxunit`), so a
commit shows up in git as `Bin 446464 -> 446464 bytes` and nothing else. This toolkit
reconstructs genuine, readable, combinable diffs, and the skills read them: code review, test
instructions, customer/team change notes, story triage and implementation plans.

**One skill writes.** `mendix-build` authors documents into the working copy — the thing every
other skill here refuses to do. It still never commits, never pushes, never switches branch, and
stops at every step only a person can take.

Portable by design: copy this folder to any machine, install once, and it works against any
Mendix project on that machine. Nothing is project-specific.

---

## 1. Dependencies

| Tool | Why | Check |
|---|---|---|
| **git** | everything is git-based | `git --version` |
| **bash** | the scripts are bash | `bash --version` |
| **node** (18+) | BSON decoding, pseudocode expansion | `node --version` |
| **mxcli** | readable MDL logic, callers/impact | `mxcli --version` |
| **mxlint** (**3.17+**) | YAML model export, `lint --diff` | `mxlint version` |

Two more are needed only by the skills that touch a live project, and both come with Studio Pro
rather than being installed:

| Tool | Needed by | Note |
|---|---|---|
| **Studio Pro MCP server** | `mendix-build`, `explain-mendix-doc-complete` | the server *is* Studio Pro, so the project must be open; default `localhost:7782` |
| **`mx.exe`** | `mendix-build` (Step 4b) | `C:Program FilesMendix<version>modelermx.exe` — the version must match the project |

Last verified against **mxcli v0.24.0** and **mxlint v3.18.0** on Mendix 11.12.4, reading
2026-10-02 and writing 2026-10-06.

**[MODEL-READING.md](MODEL-READING.md) is the capability matrix** — mxcli vs mxlint vs the
Studio Pro MCP vs raw BSON, measured on the same documents, with the sizes. Read it before
deciding which tool answers a question; these tools' blind spots have moved between releases and
two moved between mxcli v0.16 and v0.24.

**[WRITING-TO-THE-MODEL.md](WRITING-TO-THE-MODEL.md) is the same thing for writes** — field notes
from instrumented write runs, each dated: what the MCP and mxcli can each author, the steps that
have no tool at all, the three validators and what each one cannot see. It grows a section per run
and corrects itself where a later run disproves an earlier conclusion, so read the dates rather
than assuming it settled. `mendix-build` reads it before it starts, and so should anyone trusting
a claim about what an agent can author.

The short version: **mxcli reads everything** and is the default. The **Studio Pro MCP** supplies
one short list of flags mxcli cannot render at all (`commit`, `refreshInClient`,
`errorHandlingType`, `allowedModuleRoles`, `applyEntityAccess`) and is useless for anything else.
**mxlint** is what `build-history.sh` replays to make commits diffable.

**mxlint must be 3.17 or newer.** The git-backed modelsource workflow (`init`, `commit`,
`lint --diff`) does not exist in older builds. `build-history.sh` and `review.sh` still work
without it; `lint-diff.sh` does not.

### Installing the dependencies

**Windows** — Git for Windows provides both `git` and the Git Bash shell the scripts need.
Install Node from nodejs.org (or `winget install OpenJS.NodeJS`).

**mxcli and mxlint** are single self-contained binaries. Download the build for your OS and
architecture and put it somewhere on your `PATH` — on Windows a folder like `C:\Tools` added
to `PATH` works well; on macOS/Linux `~/.local/bin` or `/usr/local/bin`. Then make them
executable (`chmod +x` on macOS/Linux) and confirm with `mxcli --version` / `mxlint version`.

- **mxcli** is distributed through GitHub releases. If you already have mxcli on one machine
  it can fetch a build for another platform for you:
  ```bash
  mxcli setup mxcli --os linux --arch amd64
  ```
- **mxlint** comes from the `mxlint` GitHub organisation (the same org that hosts
  `mxlint/mxlint-rules`). On first `lint` run it downloads its rule pack from there
  automatically, so that one run needs network access; everything else works offline.

Verify the whole setup at any time from inside a Mendix project:

```bash
bash ~/.claude/mxdiff/doctor.sh
```

---

## 2. Install the toolkit

```bash
git clone https://github.com/Emilvdijk/mendix-change-toolkit.git
cd mendix-change-toolkit
bash install.sh
```

Installs to `~/.claude/` — tools in `~/.claude/mxdiff/`, skills in `~/.claude/skills/`, so
they are available in **every** project on that machine.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Project-local instead of user-wide (`<repo>/.claude/`):

```bash
bash install.sh --project
```

Re-running is safe; it overwrites only its own files. To install elsewhere, set
`MXDIFF_HOME` to wherever the `mxdiff` folder ended up.

**Sharing with your team:** Each person clones it
and runs `install.sh`. Note that many Mendix projects git-ignore `/.claude`, so a project-local
install will not travel through the project repo by itself. `git pull && bash install.sh` picks
up later updates.

---

## 3. The skills

Three take a story from unread to built, each reading the previous one's report:

| Skill | Use it for | Writes? |
|---|---|---|
| `mendix-scout` | is this story ready to pick up, and what has nobody answered | no |
| `mendix-plan` | how to build it: which documents change, which get added, in what order | no |
| `mendix-build` | **execute the plan against the model** | **yes** |

Scout is cheap and deliberately shallow; plan is the deep pass and goes properly into the
codebase. Neither decides anything — they report options and open questions for a developer.

The other five start from a change that already exists, and read commits rather than a report:

| Skill | Use it for | Writes? |
|---|---|---|
| `mendix-review` | code review of a commit range | no |
| `mendix-test-instructions` | executable test steps derived from the real diff | no |
| `mendix-change-notes` | customer/team-facing release notes | no |
| `mendix-change-report` | review + tests + notes in one pass (collects once) | no |
| `explain-mendix-doc-complete` | one document, at the highest fidelity available | no |

Invoke by name (`/mendix-review`) or just describe the task — the descriptions are written to
trigger on things like "review the last 5 commits", "how do we test this", "what do I tell
the customer", "what am I about to pull", "plan this story", "is this ready to pick up".

Use `mendix-change-report` when more than one artifact is wanted: replaying commits is the
expensive step and it happens once instead of three times.

### mendix-build is the exception, and it is deliberate

Every other skill is read-only by construction. `mendix-build` authors into the model, so it
carries its own rules, and they are load-bearing rather than cautious:

- **Working copy only.** Never commits, never pushes, never switches branch, never touches a
  remote. A build leaves work for a person to review and commit.
- **It stops rather than improvising.** The write loop cannot close without a person: saving an
  MCP write, "Update security", closing Studio Pro before mxcli writes the `.mpr`, opening it
  before the MCP answers, and running the app all have no tool at all. Measured over two write
  runs — see §1 and §15 of [WRITING-TO-THE-MODEL.md](WRITING-TO-THE-MODEL.md).
- **If the plan is wrong it says so and stops.** It executes a plan; it does not write one.

---

## 4. Using the tools directly

Run from inside the Mendix project. **These scripts are read-only** — only read-only mxcli verbs,
and **Studio Pro may stay open**, because they read a separate worktree copy and abort if that copy
is ever locked. (Writing is `mendix-build` alone, and it has the opposite requirement: mxcli
cannot write the `.mpr` while Studio Pro holds it open. See
[WRITING-TO-THE-MODEL.md](WRITING-TO-THE-MODEL.md).)

```bash
MXDIFF=~/.claude/mxdiff

# once per range: replay commits into a YAML git mirror (~30s/commit, incremental)
bash $MXDIFF/build-history.sh '<baseSha>^..HEAD'

# what changed - combined across the whole range
bash $MXDIFF/review.sh <baseSha>..HEAD --summary

# non-contiguous commits: per-commit breakdown, reveals hotspots
bash $MXDIFF/review.sh <sha1> <sha2> <sha3> --summary

# just the document names, for scripting
bash $MXDIFF/review.sh <baseSha>..HEAD --docs

# readable before/after logic (pass several docs; checkouts are shared)
bash $MXDIFF/mdl-diff.sh <baseSha> HEAD MyModule.SUB_MyFlow

# lint only the changed documents
bash $MXDIFF/lint-diff.sh <baseSha> HEAD

# raw BSON ground truth - no export, no worktree needed
bash $MXDIFF/sweep.sh <baseSha> HEAD detail

# mechanical checks over the range; emits CANDIDATES a reviewer must confirm
bash $MXDIFF/invariants.sh <baseSha>..HEAD
```

`invariants.sh` is the one tool here that does not describe a change — it looks for defect
classes a manual review misses, each derived from one that got through. It needs the mirror, so
run `build-history.sh` first, and it never produces findings: a reviewer opens the document and
confirms before anything reaches a human.

### How it works

`build-history.sh` checks out each commit into a reusable worktree, runs `mxlint export`
(~1260 YAML files, no `$ID` or coordinate noise), and commits the result into
`.mendix-cache/model-history` tagged `mx-<shortsha>`.

Once the model is text in git, **every** comparison is `git diff` — which is exactly why
combining arbitrary commits, detecting renames, and grouping by module all come for free.

All generated data lives in `.mendix-cache/` (git-ignored in a standard Mendix project).
Delete it any time; it rebuilds.

### Which tool answers which question

| Question | Tool |
|---|---|
| Which documents changed, across N commits? | `review.sh --summary` |
| Properties, security roles, commit/refresh flags, XPath? | `review.sh` (full) |
| What does the logic now do differently? | `mdl-diff.sh` |
| Does the change introduce quality/security issues? | `lint-diff.sh` |
| Sources disagree / need certainty / flow edges? | `sweep.sh` |
| Every place that deletes / commits / retrieves X? | `node actions.js --type Delete --match X` |
| Did the mirror miss anything this range changed? | `mirror-gaps.sh` |
| Where is this document used — is this snippet placed? | `usages.js` |
| Mechanical defect candidates over a range? | `invariants.sh` |
| Does the whole project still check? | `mx.exe check` (ships with Studio Pro, §5) |

---

## 5. Verified limits

Found by testing, not assumed:

- **`mxcli diff-local` was broken at v0.16.0** — `Error: mprcontents directory not found` on
  every ref, both shells, relative and absolute paths. That is why this toolkit exists.
  **Re-tested on v0.24.0: it now connects and reports cleanly.** Only checked against a clean
  tree, so whether its diff is correct on a dirty one is untested — the scripts below remain the
  trusted path, but this is worth re-evaluating.
- **`mxcli describe module X` does not dump module contents** despite its help text; it emits
  only `create module X;` plus the module roles. MDL is per-document. (Still true on v0.24.0.)
- **mxcli cannot show `commit`, `refreshInClient`, `errorHandlingType`, `applyEntityAccess` or
  `allowedModuleRoles`** in any output format — `-f json` only wraps the same MDL string. These
  decide whether a change persists and who may run it, so they have to come from mxlint's YAML
  or the Studio Pro MCP. See [MODEL-READING.md](MODEL-READING.md).
- **Multi-clause XPath truncation is FIXED** as of v0.24.0. Older notes warning that mxcli drops
  every clause after the first no longer apply; both clauses render.
- **mxlint drops `Flows:` entirely** — sequence-flow edges are ID-based and IDs are stripped.
  Control flow survives only as the `pseudocode` scalar, whose `L001` labels **renumber**,
  producing fake `GOTO L021 -> L018` churn. Use `mdl-diff.sh` for flow logic. The expanded
  `.flow.txt` files are a fallback for documents mxcli cannot describe.
- **mxlint needs native paths** in its config (`C:/...` on Windows); MSYS `/c/...` fails with
  "error finding MPR file". Handled by `to_native()` in `lib.sh`.
- **Marketplace/appstore modules are skipped** by mxlint export, so they never appear in
  YAML diffs. `sweep.sh` still sees them. (Observed on one project: `NanoflowCommons`, `OIDC`.)
  **This is not a marginal gap: layouts are normally marketplace-owned.** One app: 33 layouts,
  0 of them in the app's own module, so the mirror contains no layout at all and a change to
  one is invisible to `review.sh --summary`, `lint-diff.sh` and `invariants.sh` alike. Run
  `mirror-gaps.sh` on every range.
- **`mxcli describe` auto-detect does not know layouts.** `describe Module.Layout` answers
  "no describable document named ...", which reads like the document being undescribable;
  `describe layout Module.Layout` returns all 72 lines of it. `mdl-diff.sh` therefore accepts
  `<type>:<Module.Name>`, and `mirror-gaps.sh` prints the typed form for you.
- **`mxcli refs` and `mxcli impact` do not index snippet-call placement.** A snippet sitting on
  a layout reports `(no references found)` from both — measured on v0.24.0, two snippets, both
  placed. Microflow calls and widget actions ARE indexed, which is what makes the silence
  convincing. `usages.js` reads the BSON and finds it.
- **`mxcli`'s `CATALOG.ACTIVITIES` omits activities inside loops** (v0.24.0). A loop or while
  body is invisible to it: a catalog sweep for `DeleteObjectAction` found 150 deletes where the
  BSON holds 160, and the 10 it missed, all in loop bodies, included the delete that was the bug.
  `actions.js` answers any "every place that does X" question from the BSON and reports loop
  depth.
- **`mxcli describe microflow X` returns "not found" for a nanoflow.** Use
  `describe nanoflow X`; a sweep that only describes microflows silently skips every nanoflow.
- **`mxcli refs` does not index user-role membership either.** `refs <Module>.<Role>` answers
  `(no references found)` while project user roles still hold that module role — measured after a
  module delete, where two of them did. Deleting a module does NOT clean the user roles up, and
  Studio Pro reports nothing while security is `Off`. Read `describe user role`.
- **Nothing can rename a layout**, in any tool: `mxcli rename` has no layout type, and the MCP does
  not know `Pages$Layout` / `Forms$Layout`. A layout copied in Studio Pro keeps the `<Name>_2` it
  was given until a person renames it there.
- **There is a third validator nobody mentions:** `mx.exe check <App>.mpr`, shipped with Studio Pro
  at `C:/Program Files/Mendix/<version>/modeler/`. It runs Studio Pro's consistency check over the
  WHOLE project, headless. Measured: 50 documents clean over the MCP, then one error at `Security`
  from `mx.exe check` — a class `ped_check_errors` cannot open at all. Snippets, layouts and
  navigation are expected to be covered for the same reason and have not been proven here.
  Run it on a copy, or with Studio Pro closed, and match the version to the project.
- **mxlint truncates long filenames** on export —
  `SUB_Invoice_SendRemi_TRUNCATED_46aa2_icroflow.yaml`. A document with a long name cannot be
  found by filename; grep the contents or use the generated `app.yaml` path map. Pages are
  written as `Forms$Page.yaml`, not `Pages$Page.yaml`.
- **mxlint's page export is enormous** — 7.4 MB of YAML for one page
  (`Scheduling.Board_Overview`), against 90 KB from `mxcli describe page`. Fine for diffing,
  unusable for reading.
- **The Studio Pro MCP is not a page reader.** `pg_read_page` returns 211 bytes with every widget
  list elided to `"..."`, and its `depth` argument only truncates further. It expands one level
  per call for every document type. Use it for flags, never for structure.
- A full `mxlint export` of this project takes **18.5 s** (1,411 files, 24 content roots).
- `sweep.sh` needs MPR v2 (`mprcontents/`, Mendix 10.18+).

## 6. Layout

```
install.sh / install.ps1     installers
MODEL-READING.md             which reader gives which fact, measured; the MCP; safety rules
WRITING-TO-THE-MODEL.md      what an agent can author, measured; the gates; the validators
tools/
  lib.sh                     shared helpers, path + repo resolution
  doctor.sh                  dependency and project check
  build-history.sh           replay commits -> YAML mirror repo
  review.sh                  changed-document tables + YAML diffs
  mdl-diff.sh                readable before/after logic via mxcli MDL (<type>:<Module.Name> too)
  lint-diff.sh               mxlint over only the changed documents
  sweep.sh                   raw BSON ground-truth diff
  invariants.sh              mechanical defect checks over a range (candidates, not findings)
  invariants.js              the checks themselves, each named for the defect it came from
  mxunit.js                  BSON decoder for .mxunit files
  mxdiff.js                  structural diff, ID-aligned, noise-filtered
  info.js                    "$Type|Name" of a unit
  mirror-gaps.sh             documents the range changed that the YAML mirror cannot see
  mirror-gaps.js             its census, upgrade detection and name resolution
  findwidget.js              locate a widget inside a page/snippet
  usages.js                  who references a document, from BSON (finds snippet placement)
  actions.js                 every activity of one action type (delete/commit/...), loops included
  expand-pseudocode.js       split mxlint pseudocode into diffable .flow.txt
  package.json               pins nothing; marks tools/ as CommonJS for node
skills/
  mendix-scout/                  is the story ready to pick up
  mendix-plan/                   how to build it
  mendix-build/                  build it — the only skill that writes
  mendix-review/
  mendix-test-instructions/
  mendix-change-notes/
  mendix-change-report/
  explain-mendix-doc-complete/   one document, read at the highest fidelity available
```
