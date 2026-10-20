---
name: explain-mendix-doc-complete
description: Produces the most thorough, cross-checked breakdown of a Mendix microflow, nanoflow, page or entity by combining mxcli (readable logic in execution order, page trees, entity access rules, caller/callee/impact graph) with the Studio Pro MCP server (the live unsaved model, Studio Pro's own consistency check, and the short residue mxcli still cannot render). As of mxcli v0.26 the flags themselves — commit, refresh-in-client, error handling, execute roles, entity access, excluded — come from mxcli, not the MCP. Use this instead of a single-tool explain whenever the user wants full confidence, a complete or authoritative breakdown, documentation-grade output, an audit, or says "everything" about a document. Costs more than one read because no single tool is complete.
  Read-only always. Only these mxcli verbs: describe, context, search, show, callers, callees, refs, impact, structure, project-tree, graph-report, report, refresh-catalog. Never exec, fix, rename, layout or any MDL write; never pass --mcp, which routes writes into a running Studio Pro.
---

# Explain a Mendix document — mxcli + Studio Pro MCP

Studio Pro is assumed open on the project. `MODEL-READING.md` in the toolkit root holds the
measured capability matrix; this skill is the procedure built on it.

**The division of labour, measured, not assumed:**

- **mxcli reads everything, flags included.** Logic, pages, entities, access rules,
  relationships — and since v0.26 the document and per-activity flags that used to need a second
  tool. One call, complete. On the test page it returned a 57 KB widget tree in 3 seconds where
  the MCP returned 211 bytes.
- **The MCP's flag residue is short**, and most documents never touch it: `markAsUsed`,
  `includeLatestStackTrace`, and on a REST call `errorResultHandlingType`, `useRequestTimeOut`,
  the proxy settings and the import-mapping call's own `commit` and `forceSingleOccurrence`.
- **The MCP's real value is now elsewhere.** It is the only reader that sees **unsaved** work,
  the only one that runs Studio Pro's own consistency check (`ped_check_errors`), and the only
  one carrying the official Mendix documentation. Those, not flags, are why this skill calls it.
  Re-measured 2026-10-20 on mxcli v0.26.0; see `MODEL-READING.md` §6.

**Never use the MCP to read logic or page structure.** It expands one level per call, so a
21-activity microflow costs 25–40 round trips and still arrives in storage order rather than
execution order. A page never finishes being useful.

## Step 1 — confirm the open project, then resolve the document

The MCP answers about whatever Studio Pro has open, with no hint that it might be a different
project from the one you were asked about. `list_modules` is one cheap call and its module list
is unmistakable. Do it before trusting any flag.

**This skill assumes the model has been saved.** That is the normal case here — skills are run
between stories, on a saved and usually committed model — so do not interrupt to ask.

Know the failure mode anyway, because it is silent. With Studio Pro open and unsaved edits
pending, disk lags the live model by an unknowable amount: measured, a microflow held **one** log
activity on disk and **two** in the live model, with different text, while the `.mpr` had been
written 80 seconds earlier and `git status` showed it modified — disk was neither the commit nor
the current model, and nothing in a timestamp or `git status` reveals which you have. So if the
developer says they are mid-edit, or a read contradicts something they just told you, that is the
explanation: confirm through the MCP, which always has the live state, or ask them to save.

```
mxcli -p <app>.mpr -c "SELECT ModuleName, Name FROM CATALOG.MICROFLOWS WHERE Name LIKE '%<partial>%'"
```

Swap in `CATALOG.NANOFLOWS` or `CATALOG.PAGES`. If several modules match, list them and ask —
unless the user's phrasing already disambiguates.

## Step 2 — the document itself (mxcli)

```
mxcli describe microflow <Module>.<Doc> -p <app>.mpr
```

The same command handles `page`, `entity`, `nanoflow`, `workflow` and two dozen other types, and
is complete for all of them. This is the backbone of your explanation: properly nested
(`if/then/else`, loops), every expression verbatim, plus activity captions and annotations —
the author's own commentary, often the fastest route to intent.

Multi-clause XPath renders correctly as of mxcli v0.24. The old warning that it dropped every
clause after the first **no longer applies**.

**This step also carries every flag Step 4 used to fetch** — execute roles, commit, refresh,
error handling, excluded, documentation. Do not re-read the document to get them; Step 4a says
what each looks like in this output.

**For an entity, this step is already complete on security.** `describe entity` emits the full
access rules with their XPath (`grant Sales.Editor on … where '[Status = ''Processed'']'`) and
every attribute with type and default. Do not go to the MCP or mxlint for a domain-model
question — skip to Step 4a.

**For a page, this step is the only practical read.** 57 KB of real widget tree in 3 seconds,
with `DataSource` bindings, design properties and placeholders. The MCP cannot do this, and
mxlint's export of that same page is 27.6 MB — 480 times larger.

## Step 3 — relationships (mxcli)

```
mxcli context <Module>.<Doc> -p <app>.mpr --depth 2
```

Entities used, pages that show it, what it calls, who calls it. Nothing else gives this: the MCP
has no caller graph, and mxlint needs grepping every YAML with incidental name matches to filter
out. For a narrower question use `callers` / `callees` / `refs` / `impact`.

First run builds the whole-project catalog and is slow. Run `refresh catalog full` if the project
has been edited since.

## Step 4 — the flags: read them out of Step 2, not out of the MCP

**This step used to be a round trip. On mxcli v0.26 it is mostly a re-read of what you already
have.** Re-measured 2026-10-20: eight of the nine document and per-activity flags this skill was
built to fetch now arrive in the MDL that `describe` printed in Step 2. Going to the MCP for them
costs calls and tells you nothing new.

**4a — what to look for in the Step 2 output.** None of these is a property name; they are MDL,
so grepping for `commit` or `documentation` finds them and grepping for `disabled` or
`allowedModuleRoles` does not:

| Fact | What it looks like in the describe | Why it matters |
|---|---|---|
| execute roles (`allowedModuleRoles`) | `grant execute on microflow M.D to M.Administrator, M.Editor;` — a trailing statement after `end;` | who may run it. **No `grant execute` line at all means the list is empty** — worth stating explicitly for a flow reachable from the client |
| `applyEntityAccess` | `@applyentityaccess` / `@applyentityaccess(false)` before `create or modify microflow` | whether entity access applies, or the flow bypasses it |
| `allowConcurrentExecution` | `disallow concurrent execution error message '…'` (or `… error microflow M.D`) in the header, between `folder` and `begin` | two runs at once. Central to at least one real defect on this project. Nothing in the header = concurrent execution allowed |
| `excluded`, document | `@excluded` on the line before `create or modify microflow` | excluded from the build — it does not run at all |
| `excluded`, per activity | `@excluded` on the line before the statement | **that one activity does not run.** mxlint and the MCP call this `Disabled`, which is why grepping for "disabled" finds nothing |
| `documentation` | a `/** … */` block before the statement | the developer's own description |
| `commit` / `refreshInClient` | `change $X (…) commit refresh;` — either keyword alone, or neither | whether the write persists. **Neither keyword = in-memory, the caller must commit** |
| `errorHandlingType` | `… on error continue;`, `… on error rollback;`, or `… on error [without rollback] begin … end error;` | what happens when that activity fails. No clause = Mendix's default, rollback |

Read those off the text you already have. Say in the write-up that they came from the describe,
not from a second tool.

**4b — the residue, and the only reason to call the MCP for a flag.** Four things mxcli has no
MDL for at all, measured against every key mxlint emits for a microflow:

`markAsUsed` · `includeLatestStackTrace` on a log activity · on a REST call
`errorResultHandlingType`, `useRequestTimeOut` and the proxy settings · and the import-mapping
call's own `commit` and `forceSingleOccurrence`.

Only fetch these if the question actually turns on one — a REST integration being reviewed, or an
"is this unused?" claim resting on `markAsUsed`. Otherwise skip Step 4b entirely.

```
ped_read_document { documentType: "Microflows$Microflow", documentName: "<Module>.<Doc>" }
ped_read_document { ..., paths: ["/objectCollection/objects"] }        # locate the activities
ped_read_document { ..., paths: [".../29/action", ".../30/action"] }   # one batched call
```

Batch every path you need into one call — never one call per activity.

**4c — what the MCP is still uniquely for**, and none of it is a flag:

- **It is the only reader that sees unsaved work.** If the developer is mid-edit, or a read
  contradicts what they just told you, this is the explanation (see Step 1).
- **`ped_check_errors`** runs Studio Pro's own consistency check against the live model. mxcli's
  `check` validates MDL scripts and `lint` runs rule packs; neither is Studio Pro's validator.
- **`search_mendix_knowledge_base`** for the official refguide, which neither CLI ships.

## Step 5 — if Studio Pro turns out to be closed

Say so in the output, and fall back to mxlint, which carries the same fields in one artifact:

```bash
mxlint export    # point modelsource at a scratch dir via --config; do not let it land in the project
```

Then read `modelsource/<Module>/.../<Doc>.<Package>$<DocType>.yaml`. Two traps: **point
`modelsource` at a SHORT path.** mxlint truncates a filename when the whole path would exceed
about 203 characters — `SUB_Invoice_SendRemi_TRUNCATED_46aa2_icroflow.yaml` — so a scratch
directory nested under a session temp folder makes documents unfindable by name, while a short
one truncates nothing. `app.yaml` carries `originalName` for every file if you are stuck with a
long one. And pages are named `Forms$Page.yaml`, not `Pages$Page.yaml`.

If mxlint and mxcli genuinely disagree on a fact — a conflicting claim, not just verbosity —
trust mxlint: it is a structural dump with no pretty-printing step in between.

## Step 6 — page security is still unverified

Page-level roles were **not** confirmed against current versions, and mxlint's page YAML carries
no `AllowedRoles` field. Treat any claim about who can see a page as unconfirmed, and say so,
unless you have read it out of the model yourself. If you establish it either way, record it here.

## Step 7 — write it up

Structure it to be reusable as documentation, not just a chat answer:

- **Purpose** — one sentence
- **Parameters / inputs**
- **Security** — module roles that may execute it, and whether entity access applies. If this
  could not be determined, say so rather than omitting the heading
- **Logic** — execution order from Step 2, each write annotated as committed or in-memory from
  the `commit` keyword in that same output (Step 4a), and any `@excluded` activity called out as
  not running at all
- **Side effects** — commits, deletes, sub-flow calls, error-handling behaviour
- **Relationships** — callers, callees, entities, pages, from Step 3
- **Caveats** — anything neither source could confirm, and any disagreement you resolved

Name the sources you used. "mxcli describe + Studio Pro MCP" and "mxlint fallback, Studio Pro was
closed" are different confidence levels and the reader cannot tell them apart unless you say.
