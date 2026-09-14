# mendix-change-toolkit

Real diffs for Mendix projects, and four Claude skills built on them.

Mendix stores the whole model in binaries (`YourApp.mpr` + `mprcontents/**.mxunit`), so a
commit shows up in git as `Bin 446464 -> 446464 bytes` and nothing else. This toolkit
reconstructs genuine, readable, combinable diffs — for code review, test instructions, and
customer/team change notes.

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

| Skill | Use it for |
|---|---|
| `mendix-review` | code review of a commit range |
| `mendix-test-instructions` | executable test steps derived from the real diff |
| `mendix-change-notes` | customer/team-facing release notes |
| `mendix-change-report` | all three in one pass (collects once) |

Invoke by name (`/mendix-review`) or just describe the task — the descriptions are written to
trigger on things like "review the last 5 commits", "how do we test this", "what do I tell
the customer", "what am I about to pull".

Use `mendix-change-report` when more than one artifact is wanted: replaying commits is the
expensive step and it happens once instead of three times.

---

## 4. Using the tools directly

Run from inside the Mendix project. Only read-only mxcli commands are used. **Studio Pro may stay
open** — the scripts read a separate worktree copy, and they abort if that copy is ever locked.

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
```

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

---

## 5. Verified limits

Found by testing, not assumed:

- **`mxcli diff-local` is broken** (v0.16.0) — `Error: mprcontents directory not found` on
  every ref, both shells, relative and absolute paths. It is the built-in answer to this
  problem and it does not work. That is why this toolkit exists.
- **`mxcli describe module X` does not dump module contents** despite its help text; it emits
  only `create module X;`. MDL is per-document.
- **mxlint drops `Flows:` entirely** — sequence-flow edges are ID-based and IDs are stripped.
  Control flow survives only as the `pseudocode` scalar, whose `L001` labels **renumber**,
  producing fake `GOTO L021 -> L018` churn. Use `mdl-diff.sh` for flow logic. The expanded
  `.flow.txt` files are a fallback for documents mxcli cannot describe.
- **mxlint needs native paths** in its config (`C:/...` on Windows); MSYS `/c/...` fails with
  "error finding MPR file". Handled by `to_native()` in `lib.sh`.
- **Marketplace/appstore modules are skipped** by mxlint export, so they never appear in
  YAML diffs. `sweep.sh` still sees them.
- `sweep.sh` needs MPR v2 (`mprcontents/`, Mendix 10.18+).

## 6. Layout

```
install.sh / install.ps1     installers
tools/
  lib.sh                     shared helpers, path + repo resolution
  doctor.sh                  dependency and project check
  build-history.sh           replay commits -> YAML mirror repo
  review.sh                  changed-document tables + YAML diffs
  mdl-diff.sh                readable before/after logic via mxcli MDL
  lint-diff.sh               mxlint over only the changed documents
  sweep.sh                   raw BSON ground-truth diff
  mxunit.js                  BSON decoder for .mxunit files
  mxdiff.js                  structural diff, ID-aligned, noise-filtered
  info.js                    "$Type|Name" of a unit
  findwidget.js              locate a widget inside a page/snippet
  expand-pseudocode.js       split mxlint pseudocode into diffable .flow.txt
skills/
  mendix-review/
  mendix-test-instructions/
  mendix-change-notes/
  mendix-change-report/
```
