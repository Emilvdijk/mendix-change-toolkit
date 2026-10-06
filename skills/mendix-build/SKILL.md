---
name: mendix-build
description: Build a planned Mendix change into the local model — create the documents a mendix-plan report specifies, route each one to the tool that can actually author it, and verify every step before moving on. Use when a plan exists and someone asks to build it, implement it, "do the plan", "make the changes", or wants as much of a story assembled as a tool can manage before they finish it by hand. Writes to the working copy only. It never commits, never pushes, and stops at every step a person has to do.
  Writes the model, which every other skill in this toolkit refuses to do. It still never commits, never pushes, never switches branch, and never touches a remote.
---

# Build a planned change

You are executing a plan, not writing one. If the plan is wrong, say so and stop — do not
improvise a different design.

Read `WRITING-TO-THE-MODEL.md` and `MODEL-READING.md` in the toolkit root before starting. They
are the measured capability map, and every rule below comes from a failure recorded in them.

## The three hard rules

1. **Never commit. Never push. Never switch branch. Never touch a remote.** Everything you build
   lands as uncommitted working-tree changes, so the developer reviews it with `git diff` and
   Studio Pro and decides what to keep. A `git commit` in this skill is a bug, not a convenience.
2. **Verify every step before starting the next one.** Not at the end. This is the rule that
   matters most and the one most easily skipped — see "Why this skill is paranoid" below.
3. **Stop at a human gate and report.** Do not work around it, do not approximate it, do not
   silently skip the steps that depend on it.

## Step 0 — orient, and refuse early if you must

```bash
git -C <checkout> status --short       # the working tree you are about to add to
git -C <checkout> rev-parse --short HEAD
```

**Report what is already dirty before you write anything.** The developer needs to be able to tell
your changes from theirs, and after you run, `git status` is the only thing that does.

Refuse to start, and say why, if:

- there is **no plan**. This skill executes a plan; without one, run `mendix-plan` first.
- the plan is for a **different story or commit** than the checkout is on.
- the working tree is **so dirty that your output will be unreviewable**. Say what is dirty and
  let the developer decide.

Then establish where Studio Pro is, because it decides what you can do at all:

| Studio Pro | mxcli writes | MCP (flags, validator, pages) |
|---|---|---|
| **closed** | yes | **no — the server is Studio Pro** |
| **open** | **no — never write the `.mpr` under an open IDE** | yes |

You will need both, in alternation. That is forced by the tooling, not a preference
(`WRITING-TO-THE-MODEL.md` §18 — `mxcli --mcp` authors one construct in eight).

## Step 1 — read the plan and build a routing table

For every document the plan names, decide **who can author it** before touching anything. The
plan should already say (its "Authorable by" column); verify rather than trust, because the
capability summaries have been wrong.

```
list_modules            -> writable / fromMarketplace per module
ped_get_schema <type>   -> the real constructor contract for an MCP write
mxcli syntax <topic>    -> the real MDL form for an mxcli write
```

Measured routing on Mendix 11.12.4 — **re-check, do not memorise**:

| Needed | Writer |
|---|---|
| Entity, attributes, defaults, access rules | either; mxcli expresses string length, the MCP does not |
| Non-persistent entity | **mxcli only** |
| JSON structure, import/export mapping, REST | **mxcli only** |
| Microflow | either |
| Nanoflow | **mxcli only** |
| Snippet, page widget tree | **mxcli only** — the MCP cannot even read a snippet |
| Allowed roles / `GRANT EXECUTE` | **mxcli only** |
| Layout | **a person** — no MCP layout type, and mxcli drops widgets it cannot author |
| Anything in a `writable: false` module | **a person** |
| CSS / theme files | plain file write |
| `ped_check_errors`, Update security, save | MCP / a person |

**Say the routing out loud in your report before you start.** A step routed to a person is not a
failure; discovering it at the end is.

## Step 2 — baseline the validator

If Studio Pro is open, run `ped_check_errors` over every document you intend to touch, **before
touching it**, and keep the result.

Without this, an error afterwards cannot be attributed to you. In the reference run it was skipped,
and a security error afterwards could only be called "almost certainly mine".

## Step 3 — build, one step at a time

For each numbered step of the plan, in order:

**3a. Write the MDL to a file. Never pipe it.**

Use a quoted heredoc (`<<'EOF'`). Never an interpolating one, never a script that re-escapes the
content. `$` is load-bearing in MDL (`$currentObject`, `$Variable`) and in every shell.

**3b. Grep the file for what matters, before running it.**

```bash
grep -nE 'currentObject|\$[A-Za-z]' <file>
```

One command. In the reference run, three widget expressions reached the model as `not(/IsMinimized)`
instead of `not($currentObject/IsMinimized)` because the generating script ate the `$`. `mxcli
check` passed them, the MCP cannot read snippets, and a person found them in the IDE.

**3c. Dry run.**

```bash
mxcli check <file> -p "<app>.mpr"
```

This is the single biggest safety feature in the toolchain and the MCP has no equivalent. It has
caught a write that **crashes Studio Pro** (`MDL-WIDGET04`, an unbound template placeholder) and a
property name that would have been *silently dropped on write*. Iterate here until clean — it costs
nothing and nothing has been written yet.

For an MCP write there is no dry run, so re-read the schema instead and build the call carefully.

**3d. Apply.**

mxcli: `mxcli exec <file> -p "<app>.mpr"`. **`exec` is not atomic across statements** — a later
failure leaves earlier statements applied. Put the risky statement first, or run one per file.

MCP: batch independent `add` operations freely; **never batch a `remove` or a rename with
anything else**, because those can leave side effects even when the call fails.

**3e. Read it back and diff against the plan, field by field.**

`SUCCESS` means the operations applied. It does not mean the result matches the plan. In the
reference run an entity came back with `String(200)` where the plan said `String(100)`, and a
`Decimal default 0` nobody asked for — both platform defaults for properties the MCP constructor
cannot express, both invisible to `ped_read_document`, both found only by reading back with mxcli.

**3f. Run the step's `Check:` line.**

The plan gives one per step. Run it now, not later. If the `Check:` names a tool that cannot see
the thing — `mxcli describe` cannot show allowed roles, commit flags or error state — say so and
substitute one that can, rather than skipping it.

**3g. Record the step as done, skipped, or deviated**, with one line of why.

## Step 4 — the gates, and what to do at each

| Gate | Why | What you do |
|---|---|---|
| mxcli needs Studio Pro **closed** | writing the `.mpr` under an open IDE can corrupt it | stop, ask, continue when told |
| MCP needs Studio Pro **open** | the server *is* Studio Pro | stop, ask, continue when told |
| "Update security" after an access-rule change | no tool exposes that button | stop, ask |
| Saving an MCP write | no save tool exists in the 18 | stop, ask |
| A layout, or any `writable: false` module | no tool can author it | leave it to the developer, say exactly what to do |
| Running the app | no tool here does it | leave it to the developer |

At every gate: **say precisely what you need, and what you will do next.** "Close Studio Pro and
tell me" is actionable. "Studio Pro must be closed" is not.

**Verify a gate the developer says they completed — do not take it on trust, and do not take a
tool's silence for it either.** Placement is the case that bites: after someone places a snippet
on a layout by hand,

```bash
node "$MXDIFF/usages.js" "<Module.Snippet>" --qualified
```

is the only reader that can confirm it. `mxcli refs` and `mxcli impact` both answer
`(no references found)` for a correctly placed snippet, the YAML export contains no layouts at
all, and the MCP cannot read a snippet. A later review, running on the same blind sources,
reported a placed snippet as missing and called the story blocked.

## Step 5 — write the build report

To the path you were given. Structure:

```markdown
# <STORY> — build report

## What was built
Table: document | kind | written by | verified how

## What was skipped, and why
Every step not built, with the reason and who has to do it.

## Deviations from the plan
Anything that differs from what the plan specified, and why. Platform-supplied defaults count.

## Left for you
Numbered, literal, runnable. Real file names — never a `<placeholder>` in a command
somebody is meant to type.

## How to review this
The exact `git diff` / `git status` invocation for the checkout, and what a clean diff looks
like (the `.mpr` plus one `.mxunit` per document touched — more than that means something
else moved).

## Nothing was committed
State it plainly, every time.
```

## Why this skill is paranoid

Measured over one full agent-executed plan, **nine errors reached the model and not one was found
by the tooling that produced it.** Seven surfaced when a person opened Studio Pro; two when the app
ran. Four of the nine were plan instructions that were written down and never carried out.

The write paths are reliable. Every tool did what it was told. Nothing caught what it was told
wrong — so the verification is the skill, and the writing is the easy part.

Specifically, do not assume any of these, all of which held in that run:

- `mxcli check` passing means correct. It validates syntax and references, not type alignment
  across documents, not visibility-expression context, not CSS at all.
- `SUCCESS` from an MCP write means the result matches the intent.
- Nothing validates stylesheets. If you write CSS, **grep the theme for every `var(--x)` you
  reference** — an invented custom property is a widget nobody can see, and no gate catches it.
- The capability summaries are current. `mxcli mcp capabilities` has been wrong twice.

## Rules

- Execute the plan. Do not redesign it. Report disagreement in writing and stop.
- Never commit, never push, never switch branch, never fetch.
- Only ever author into modules the project owns. Never write a Marketplace module.
- Never run the app, never deploy, never touch Mendix Cloud.
- If a step cannot be done, that is a result. Report it and carry on with the steps that do not
  depend on it — a partial build that is honest about its gaps is the point of this skill.
