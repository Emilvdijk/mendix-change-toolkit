---
name: mendix-scout
description: Triage a Mendix story that has not been built yet — read what it asks for and report what nobody has answered, with only a light check against the model. Use when a story, ticket or requirement is still in To do, refinement or freshly in progress and someone asks "is this ready to pick up", "what is unclear about this", "refine this story", "what do we need to know before starting", or wants a story questioned before anyone commits to building it. Cheap and fast. For working out HOW to build it — which documents change, which get added — use mendix-plan instead, which is the deeper follow-up and reads this skill's report as input.
---

# Scout a Mendix story before it is built

This is the **cheap triage pass**. Its job is to decide whether a story can be picked up at
all, and to surface the questions somebody has to answer first. It is deliberately NOT a
design exercise: working out how to implement the story is `mendix-plan`'s job, and that skill
reads this one's report as its starting point.

The single deliverable is **open questions**. Everything else in the report exists to support
them.

**Budget discipline is part of the skill.** Aim for well under ten mxcli calls. If you find
yourself reading a sixth microflow, stop — you have crossed into planning, and the answer you
are chasing belongs in `mendix-plan`. A scout that costs as much as a plan has failed even if
its report is good.

**Safety:** read-only mxcli only (`search`, `describe`, `context`, `callers`, `callees`, `refs`,
`impact`). Never mxcli write/`exec`. Never commit, push or switch branches. Never edit the model.

## Step 0 — prerequisites

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
bash "$MXDIFF/doctor.sh"
```

No mirror and no replay: this skill reads the current `.mpr` through mxcli, nothing else. A
doctor failure that only concerns mxlint is therefore not fatal here — say so and continue.

## Step 1 — read the story as a specification

The story text is the input, and most of the value is here rather than in the model.

- Every noun that sounds like a domain concept is a candidate entity; every verb a candidate
  microflow. Numbers, dates, statuses and roles are where requirements hide — "only a planner
  may do this" is a security requirement, "per period" is a date-boundary requirement.
- **The comment thread and any linked feedback usually carry the real specification.** Feedback
  is the original report by the person who hit the problem and often names the exact page.
  Where the description and a later comment disagree, the comment is normally newer — say which
  you followed.
- **Lane history is evidence.** A story that has been round-tripped through Refinement several
  times has been found unclear before, by people who know the domain better than you do. Say so,
  and look harder for what they could not pin down.
- **Write the report in English**, whatever language the story is in. Keep identifiers and
  quoted story text EXACTLY as they appear — never translate a module, document, entity or
  attribute name, and never translate a quote you are attributing to someone. A Dutch story
  gets an English report that still says `werkorder` and quotes the reporter verbatim.

## Step 2 — a light check, only where it settles a question

Query the model **only to answer a question you have already written down**. Good reasons:

- *"Does this already exist?"* — `mxcli search "<term>"`. A story asking for something already
  built is the most valuable thing this skill can find, and it happens often.
- *"Is this one of a family?"* — if the story names one of several parallel constructs, a single
  `search` tells you whether siblings exist. That changes the question from "build this" to
  "build this consistently with the other five".
- *"Is the thing it names actually the thing it means?"* — one `describe` to confirm a document
  does what the story assumes.

Bad reasons, all of which belong to `mendix-plan`: mapping the blast radius, reading callers to
size a regression surface, tracing an entity's full impact list, working out the change.

**One more question this skill can now settle: "is what the story asks for even how Mendix does
it?"** The Studio Pro MCP exposes Mendix's own documentation:

```
search_mendix_knowledge_base { query: "<the platform concept the story assumes>" }
```

A story that assumes a capability the platform does not have, or asks for it in a way that cuts
against the documented pattern, is exactly the kind of thing nobody has questioned yet — which is
this skill's whole job. **At most one query per run.** Scout is the cheap skill and each one
costs 14–24 KB; if the answer needs more than that, it is a `mendix-plan` question.

Three caveats: forum posts come back alongside the refguide and an entry beginning `Question:` is
not Mendix's position; a null result proves nothing, so record it as an open question rather than
an answer; and it needs Studio Pro open — if unavailable, carry on without it silently.

Record what you ran. If a question cannot be settled cheaply, leave it as a question — that is
the correct outcome, not a failure.

## Step 3 — write the report

Write to the file you were asked to write to. Markdown, no preamble, these sections:

```markdown
# <STORY-ID> — scout

## What the story asks for
A short, literal restatement. If you cannot state it in three sentences, that is itself a
finding — say so here, because it is usually why the story keeps coming back from refinement.

## Ready to pick up?
One of: **Ready** / **Ready with assumptions** / **Not ready**. One paragraph saying why.
This is the sentence someone reads on a standup, so make it carry the decision.

## Open questions
Numbered. Each one a question a person can actually answer, with what it blocks or changes.
Split **blocking** (cannot start) from **worth settling** (can start, will cost rework if
wrong). If a question was settled by a model check, move it to the section below instead of
leaving it here half-answered. If there are genuinely none, say so plainly — do not pad.

## What the model already told me
Only what you actually checked, with the command. Two or three lines is a normal amount. Say
explicitly whether anything the story asks for appears to exist already.

## What this does not tell you
The honest limits: what you did not look at (most of the model, deliberately), what the story
is too vague to scope, and anything you inferred rather than verified. State that working out
the implementation is mendix-plan's job and has not been attempted here.
```

## Rules

- **Never invent a document name.** Every `Module.Document` you name must have come back from
  mxcli. If you could not find something the story implies, that belongs in *Open questions*.
- **Uncommitted work is invisible.** You are reading the committed model. If the assignee has
  something open in Studio Pro right now you cannot see it, so a story already under way will
  look less built than it is. Say so when the lane suggests work is underway.
- **Do not estimate in hours or points.** Size is the team's call.
- **Do not design the change and do not write code.** If you find yourself describing what to
  modify, stop and hand it to `mendix-plan`.
- **An empty finding is a finding.** "This touches one microflow with no callers and the story
  is unambiguous" is a genuinely useful report — do not pad it.
