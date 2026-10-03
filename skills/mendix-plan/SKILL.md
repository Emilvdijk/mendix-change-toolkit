---
name: mendix-plan
description: Work out how to implement a Mendix story against the real model — which documents change, which get added, in what order, and what could go wrong — without writing anything. Use when someone is about to pick a story up and asks "how would I build this", "what needs changing", "plan this story", "prepare this for implementation", "what is the approach", "where do I start", or wants an implementation plan, a change list or a technical breakdown before touching Studio Pro. The deep follow-up to mendix-scout: it reads that skill's report as its starting point and then goes properly into the codebase. Reports suggestions, options and open decisions for a developer to act on; it never edits the model.
---

# Plan a Mendix story against the real model

`mendix-scout` asks whether a story is clear. **This skill asks how to build it.** It goes into
the model properly — the blast radius, the families, the patterns the codebase already uses —
and comes back with a change list a developer can work from.

It **prepares** implementation. It does not perform it, and it does not pretend the decisions
are made: where there is a genuine choice, present the options with trade-offs and let the
developer pick.

**Safety, and this one is absolute:** read-only mxcli only (`search`, `describe`, `context`,
`callers`, `callees`, `refs`, `impact`, `show`). **Never** mxcli write or `exec` — those can
corrupt the `.mpr`. Never edit the model, never commit, never push, never switch branches.
Nothing you do may leave a trace in the project beyond files under `.mendix-cache/`.

## Step 0 — prerequisites, and the one hard stop

```bash
MXDIFF="${MXDIFF_HOME:-$HOME/.claude/mxdiff}"
bash "$MXDIFF/doctor.sh"
git status -sb
```

**This skill reads the LIVE `.mpr` in the checkout, not a replayed mirror.** That makes it the
one analysis in the toolkit where being behind the branch is fatal rather than cosmetic: a plan
written against last week's model can name documents that have since been renamed, miss a
sibling added yesterday, and propose work somebody already did.

If `git status -sb` shows the branch behind its upstream, **stop before doing any analysis** and
say so plainly: the user should pull in Studio Pro (or close it so Dash can fast-forward) and
run this again. Do not produce a plan from a stale checkout — a confident plan against the wrong
model is worse than no plan. When Dash invokes this skill it performs the same check first and
refuses the run, so reaching this skill at all normally means the checkout was current when the
run started.

### Check writability before proposing any change to an existing document

If the Studio Pro MCP is available, call `list_modules` once, up front, and keep the result. Every
module comes back with two flags that decide whether a change is even possible:

```json
{"moduleName":"Siemens_UI_Module","writable":false,"fromMarketplace":true}
{"moduleName":"SampleApp","writable":true,"fromMarketplace":false}
```

**A change to a `writable: false` module cannot be authored by any tool.** Not by the MCP, which
refuses the module; and usually not by mxcli either, because Marketplace modules are full of
widgets it cannot re-author — writing one back silently drops them.

This matters most for **layouts**, which is where a "make it appear everywhere" story naturally
lands, and layouts in this ecosystem usually belong to a Marketplace UI module. Measured on a real
run: a plan correctly identified the one layout 33 pages used, correctly warned that a Marketplace
module update would overwrite the change — and still listed the edit as something an agent could
make. It could not. The MCP has no layout document type at all (`Forms$Layout` and `Pages$Layout`
are both "Unknown document type"), and mxcli would have deleted two sidebar toggle widgets from
every page in the app.

So, in **Documents to change**, mark each row with who can author it:

| Document | Module writable? | Authorable by |
|---|---|---|
| `SampleApp.Snippet_Foo` | yes | mxcli or MCP |
| `SomeMarketplace.SomeLayout` | **no** | **a person in Studio Pro** |

A plan that ends with "and then a person adds one widget call in Studio Pro" is a *better* plan
than one that discovers it at the last step. Say it in **Approach**, not only in the table.

Without the MCP, infer it: a module you did not write and that appears in the Marketplace section
of the project is almost certainly read-only. Say the check could not be made.

## Step 1 — start from the scout report

If a scout report for this story exists you will be told its path. **Read it first.** It carries
the story restatement, the open questions and whatever the light model pass already settled.

- Its **blocking questions** are your constraints. Where a blocking question is unanswered, plan
  for both answers or say plainly that this part cannot be planned yet — do not quietly pick one.
- Its **"what the model already told me"** section saves you repeating cheap lookups.
- If it says something you find to be wrong, **say so explicitly** in your report. The scout pass
  is fast and shallow by design and is expected to be corrected here.

**Treat scout's documents as hypotheses, not as the frame.** Scout looked at five or six
documents on a fast pass; the fact that it named them is evidence about scout's search terms,
not about where the problem lives. Derive the entry point yourself in Step 2 and let the code
tell you which documents matter. **If your "documents to change" table contains only documents
scout already named, you have almost certainly just elaborated its guess** — go back and widen.
A measured failure: on a duplicate-records bug, scout named two microflows, the plan changed
exactly those two, and the decisive defect was a date expression on the page neither had opened.

If there is no scout report, do the story-reading yourself first: description, comments, linked
feedback, lane history. Never plan against the title alone.

## Step 2 — start at the entry point and follow the path down

**For a bug, the unit of work is the execution path, not the entity.** Fanning out over an
entity's impact list gives you eighty documents and no story; walking one path from the screen
to the write gives you the mechanism. Do the walk first, every time.

1. **Find the screen.** `mxcli refs "<Module.Document>"` on any document the story or scout
   names will lead to the page that uses it. The story text and any linked feedback usually name
   it outright ("op het planningsscherm", "the overview page").
2. **READ THE PAGE. Do not stop at naming it.** Naming the entry point and not opening it is the
   single most common way this skill produces a confident, wrong plan. Export the model (below)
   and read the page's YAML.
3. **Count the call sites.** A microflow bound once and a microflow bound fourteen times behave
   very differently under the same defect. On the planning bug above, the week-view counter was
   referenced **14 times** on one page against the day view's **1** — an invocation multiplier
   that was invisible from every microflow and obvious from the page.
4. **Follow each datasource down** to the activity that writes, reading every document on the
   way. *That* is the flow the user means when they say "the whole flow needs reading".
5. **Compare siblings on the path.** Two flows doing the same job — a day view and a week view, a
   Project and a Relation sync — are the highest-yield comparison in a Mendix codebase, because
   the correct one documents what the broken one should have said.

Only once the path is walked, widen:

```bash
mxcli search "<domain term>"            # find the real names - story words rarely match
mxcli describe "<Module.Document>"      # readable logic
mxcli callers  "<Module.Microflow>"     # the regression surface
mxcli callees  "<Module.Microflow>"     # what it depends on
mxcli impact   "<Module.Entity>"        # everything touching an entity
mxcli refs     "<Module.Document>"      # where it is referenced
```

Work outwards from the most specific match, and establish for each candidate:

- **Does it already exist?** Re-check anything scout flagged. The cheapest plan is "this is
  already built, here is the document".
- **Who calls it?** A change to a shared sub-microflow is a different proposition from a leaf.
  Name the callers that would need re-testing.
- **Is there a family?** If the story names one of several parallel constructs (`ADO_*`,
  `SUB_*_SyncWithServiceTab`, one of six validation flows), read the siblings. **Half-built
  features come from changing one member of a family** — and the story usually names only the
  half its author noticed. Say explicitly which siblings should change together.

### Blast radius, measured rather than guessed — `graph-report`

`callers` answers "who calls this one document". It does not tell you that the document is load
bearing for the whole app, and that is the difference between a one-day story and a regression
across half the project.

```bash
mxcli graph-report -p <app>.mpr --top 15          # markdown; --format json for parsing
```

Six sections, all derived from the reference graph. Three change plans:

- **God nodes** — in-degree per asset. On one real project `ServerFeedback.SUB_Feedback_AddMessage`
  came back with **in-degree 393**, and four entities were over 150. A story that edits one of
  these is not a local change, however small the diff looks, and the plan must say so in
  **Risks** rather than letting the reader discover it.
- **Dead documents** — referenceable with no inbound edge. Check the story's target against this
  before planning to extend it: extending something nothing calls is a different story, and
  sometimes the right plan is to delete it.
- **Module coupling / cohesion** — whether the change crosses a module boundary, and whether the
  module it lands in is already entangled. A new cross-module edge belongs in **Risks**.

Two things to know before you trust it:

- **It runs a FULL catalog refresh** — the whole project, not the document you asked about. It is
  the most expensive read in this skill. Run it once, early, and reuse the output; never per
  candidate document.
- **The dead-documents list is dominated by marketplace modules.** Measured, the top entries were
  all `BZToaster`, `CommunityCommons` and `ExactOnline` entities — unreferenced because the app
  uses part of a library, which is normal and not a finding. Framework modules are excluded by
  default; add `--exclude` for the marketplace modules in this app, or read only the rows in
  modules the team actually writes.

### Ground truth mxcli cannot give you — get it, do not defer it

mxcli does not show **`AllowConcurrentExecution`**, **`ApplyEntityAccess`**, **`LocalizeDate`**,
commit/refresh-in-client flags, execute-role security, or **page structure** of any kind. Those
are exactly the things that decide whether a plan is right.

(Multi-clause **XPath** used to be on that list. It is not any more — mxcli v0.24 renders every
clause. Verified 2026-10-02; see `MODEL-READING.md`.)

**Studio Pro is open, so take these from the MCP in two calls** and skip the export entirely:

```
ped_read_document { documentType: "Microflows$Microflow", documentName: "<Module>.<Doc>" }
ped_read_document { ..., paths: ["/objectCollection/objects/<i>/action", ...] }
```

The first carries `applyEntityAccess`, `allowedModuleRoles`, `allowConcurrentExecution` and
`excluded`; the second carries `commit`, `refreshInClient` and `errorHandlingType` per activity.
Confirm with `list_modules` that the open project is the right one — the MCP reads **whatever
Studio Pro has open**, never a commit, and says nothing if that is a different project.

**For page structure use `mxcli describe page`, not the MCP.** Measured on
`Scheduling.Planning_Overview`: mxcli returns the real 90 KB widget tree in one call, `pg_read_page`
returns 211 bytes with every widget list elided to `"..."`. Entity access rules likewise come
from `mxcli describe entity`, complete with the XPath on each grant.

Export only if Studio Pro turns out to be closed.

**For a Bug, getting these facts is mandatory, not optional** — by whichever route — and so is
reading the page structure. Writing "verify this in Studio Pro" instead of running one command is
a failure of this skill: it hands the user back the question they asked you. Measured on a real run — the plan deferred the
entity-access question to Studio Pro and never saw `AllowConcurrentExecution: true` on a
datasource that writes, which was central to the defect.

```bash
CACHE="$(git rev-parse --show-toplevel)/.mendix-cache"
mkdir -p "$CACHE/plan-export"
printf 'projectDirectory: %s\nmodelsource: %s\n' \
  "$(cygpath -m "$(git rev-parse --show-toplevel)" 2>/dev/null || git rev-parse --show-toplevel)" \
  "$(cygpath -m "$CACHE/plan-export" 2>/dev/null || echo "$CACHE/plan-export")" \
  > "$CACHE/plan-export.yaml"
mxlint export --config "$(cygpath -m "$CACHE/plan-export.yaml" 2>/dev/null || echo "$CACHE/plan-export.yaml")"
```

Then read the relevant `*.yaml` under `.mendix-cache/plan-export/`. This is a snapshot of the
**current** model — there is no history involved and nothing to replay. Skip it entirely when
the change is plainly logic-only; it costs a minute and is not always worth it.

### Trap classes worth checking explicitly

Mendix has a small set of defects that recur, are invisible to a casual read, and are cheap to
check once you know to look. When the bug is in the area, check them by name and say you did:

- **A datasource that writes.** A microflow bound as a page datasource that creates or commits
  runs on every render, every refresh, every tab — and usually with `AllowConcurrentExecution:
  true` and no lock, which makes "check the list is empty, then create" a race by construction.
  This is an antipattern in itself: retrieval and creation belong in different flows.
- **Date format versus date parse.** `yyyy` is the calendar year and `YYYY` is the ISO week-year;
  they differ around New Year. A round trip that formats one and parses the other is a live bug
  that only misfires for a few days a year — an excellent fit for a symptom reported as
  "sometimes". Check every `formatDateTime*`/`parseDateTime*` pair for matching tokens.
- **Timezone argument present in one place and absent in another.** An attribute with
  `LocalizeDate: false` must be read as UTC. `day-of-year-from-dateTime(d, 'UTC')` in one flow
  and `day-of-year-from-dateTime(d)` in its sibling is a real inconsistency even where the local
  offset currently hides it, and `formatDateTime` beside `formatDateTimeUTC` in the same activity
  is almost always an accident.
- **Two flows that build the same thing from different rules.** Different filters, different
  sort keys, different roles. Whichever runs first wins, so the result depends on which screen
  the user opened — which reads to them as random.
- **A field used as a lookup key that nothing sets**, and its mirror: an index on an attribute
  that is never populated.

### Check the documented pattern before you propose one — `search_mendix_knowledge_base`

A plan proposes how something should be built, and the failure mode is proposing a reasonable
pattern that is not the platform's. The Studio Pro MCP exposes Mendix's own documentation:

```
search_mendix_knowledge_base { query: "when to commit objects in a microflow best practice" }
```

Use it when the plan turns on a platform question rather than a model one — commit and rollback
semantics, entity access vs microflow access, view entities and OQL limits, scheduled events,
naming. Cite the page in **Approach** so the reader can check you, and name the convention you
are following when you propose new document names.

Four measured caveats:

- **Forum posts come back alongside the refguide**, same shape. An entry beginning `Question:`
  is someone's opinion; a `docs.mendix.com` URL is Mendix's. Never present the first as the
  second.
- **A null result proves nothing** — a specific behavioural question returned zero documents.
  If the search is silent, say the question is undocumented and put it in **Open decisions**
  rather than inventing an answer.
- **14–24 KB per query.** Two or three per plan, on the decisions that actually turn on it.
- **Needs Studio Pro open.** If unavailable, proceed without it and do not mention the tool.

## Step 3 — decide the approach, and be honest about alternatives

Before writing anything, settle:

- **Follow the existing pattern, or break it?** If the codebase already does this kind of thing
  one way, the default is to match it, and a deviation needs a reason. Name the pattern and the
  document that exemplifies it.
- **Where does the logic belong?** A new sub-microflow, an extension of an existing one, or a
  change at the call site — these have different regression surfaces. Say which and why.
- **What is genuinely a choice?** Present real options with trade-offs. Do not manufacture
  alternatives to look thorough, and do not hide a decision you actually made.

## Step 4 — write the plan

Write to the file you were asked to write to. Markdown, no preamble, these sections:

```markdown
# <STORY-ID> — implementation plan

## Approach
Three to six sentences: what you would build and why this shape. If the scout report's blocking
questions leave a fork in the road, say which branch this plan assumes.

## Documents to change
| Document | Kind | What changes | Why | Callers to re-test |
One row per document, most important first. "What changes" is a sentence, not a diff.

## Documents to add
| Document | Kind | Purpose | Modelled on |
"Modelled on" is the existing document whose pattern it should follow — a plan that invents a
shape the codebase does not use is a plan that will be rejected in review.

## Domain model changes
Entities, attributes, associations, and any **data migration** implied. State explicitly when
there are none. An added non-nullable attribute on an entity with existing rows is a migration
even when nobody calls it one — call it one.

## Suggested order
Numbered steps a developer can follow, each one independently checkable. Put anything that can
be verified early (a query, a validation) before anything expensive. Note where Studio Pro will
force a particular order.

## Risks and things to watch
Named risks, not "be careful". Security rules, commit/event side effects, shared sub-microflows,
scheduled events, anything that runs unattended, and families where changing one member without
the others leaves the system half-migrated.

## Open decisions
Questions that are genuinely the developer's or the business's to make, with the options and what
each implies. Distinguish these from scout's open questions: those were about what the story
means, these are about how to build it. Carry forward any of scout's blocking questions that are
still unanswered.

## Path coverage
The entry point, the documents on the path from it to the write, which you read, and which
branches you did not follow. This is the denominator that matters — not the size of an entity's
impact list.

## What this plan does not cover
Honest limits: what you inferred rather than verified, and anything that needs a decision or
data you do not have. State the commit the plan was written against.
```

## Rules

- **Never invent a document name.** Every `Module.Document` must have come back from mxcli. A
  plausible-sounding name that does not exist is the most damaging thing this skill can produce.
- **Write the report in English**, whatever language the story is in. Keep identifiers and quoted
  story text EXACTLY as they appear — never translate a module, document, entity or attribute
  name, and never translate a quote you are attributing to someone.
- **Report coverage of the PATH, not of the entity.** "7 of 67 documents in the impact list" is
  the wrong denominator and sounds like diligence while hiding that the path was never walked.
  State instead: the entry point, every document on the path from it to the write, which of them
  you read, and which paths you did not follow at all.
- **Do not write code and do not edit the model.** The output is a document for a person. No
  microflow is created, renamed or modified by this skill, ever.
- **Say what you did not check.** The impact list of a central entity runs to dozens of
  documents; reading six of them and implying you read all of them is dishonest. Give the count.
- **Uncommitted work is invisible.** You read the committed model. If the developer has something
  open in Studio Pro, the plan may propose work that is already half-done — say so when the lane
  suggests it.
- **Distinguish verified from inferred, every time.** "`SUB_Foo` is called by three flows
  (`mxcli callers`)" and "this is probably where the duplicate comes from" are different claims
  and must read differently.
- **A short plan for a small story is correct.** Do not inflate a one-microflow change into a
  six-phase programme.
