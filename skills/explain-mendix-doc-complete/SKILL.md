---
name: explain-mendix-doc-complete
description: Produces the most thorough, cross-checked breakdown of a Mendix microflow, nanoflow, page or entity by combining mxcli (readable logic in execution order, page trees, entity access rules, caller/callee/impact graph) with the Studio Pro MCP server (the document and per-activity flags mxcli cannot render at all — commit, refresh-in-client, error handling, execute roles, entity access). Use this instead of a single-tool explain whenever the user wants full confidence, a complete or authoritative breakdown, documentation-grade output, an audit, or says "everything" about a document. Costs more than one read because no single tool is complete.
  Read-only always. Only these mxcli verbs: describe, context, search, show, callers, callees, refs, impact, structure, project-tree, graph-report, report, refresh-catalog. Never exec, fix, rename, layout or any MDL write; never pass --mcp, which routes writes into a running Studio Pro.
---

# Explain a Mendix document — mxcli + Studio Pro MCP

Studio Pro is assumed open on the project. `MODEL-READING.md` in the toolkit root holds the
measured capability matrix; this skill is the procedure built on it.

**The division of labour, measured, not assumed:**

- **mxcli reads everything.** Logic, pages, entities, access rules, relationships. One call,
  complete. On the test page it returned a 90 KB widget tree where the MCP returned 211 bytes.
- **The MCP supplies one short list of flags** that mxcli cannot render in any output format:
  `allowedModuleRoles`, `applyEntityAccess`, `allowConcurrentExecution`, `excluded`,
  `markAsUsed`, `documentation`, and per activity `commit`, `refreshInClient`,
  `errorHandlingType`.

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

**For an entity, this step is already complete on security.** `describe entity` emits the full
access rules with their XPath (`grant Sales.Editor on … where '[Status = ''Processed'']'`) and
every attribute with type and default. Do not go to the MCP or mxlint for a domain-model
question — skip to Step 4.

**For a page, this step is the only practical read.** 90 KB of real widget tree, with
`DataSource` bindings, design properties and placeholders. The MCP cannot do this and mxlint's
export of the same page is 7.4 MB.

## Step 3 — relationships (mxcli)

```
mxcli context <Module>.<Doc> -p <app>.mpr --depth 2
```

Entities used, pages that show it, what it calls, who calls it. Nothing else gives this: the MCP
has no caller graph, and mxlint needs grepping every YAML with incidental name matches to filter
out. For a narrower question use `callers` / `callees` / `refs` / `impact`.

First run builds the whole-project catalog and is slow. Run `refresh catalog full` if the project
has been edited since.

## Step 4 — the flags mxcli cannot see (MCP)

**4a — document level, one call:**

```
ped_read_document { documentType: "Microflows$Microflow", documentName: "<Module>.<Doc>" }
```

Ignore the stub arrays. Take:

| Field | Why it matters |
|---|---|
| `allowedModuleRoles` | who may execute it. An empty list on a flow reachable from the client is worth stating explicitly |
| `applyEntityAccess` | whether entity access rules apply, or the flow bypasses them |
| `allowConcurrentExecution` | two runs at once. Central to at least one real defect on this project |
| `excluded` | excluded from the build — it does not run at all |
| `markAsUsed` | suppresses "unused" warnings; a hint that callers are dynamic |
| `documentation` | the developer's own description |

**4b — per-activity persistence, one batched call:**

```
ped_read_document { ..., paths: ["/objectCollection/objects"] }        # locate the activities
ped_read_document { ..., paths: [".../29/action", ".../30/action"] }   # one batched call
```

The first returns `$Type` and caption per object, so one call finds every `ActionActivity`. Batch
every path you need into the second — never one call per activity. Read only the activities that
**write**: `ChangeObjectAction`, `CreateObjectAction`, `DeleteAction`, `ChangeListAction`, plus
whatever the question is about.

This is the step that changes conclusions. On
`Project.SUB_Invoice_SendSingleReminder`, mxcli renders:

```
change $Invoice (SendAt = [%CurrentDateTime%], CountSentEmails = ... + 1);
```

which reads as "it sets these". The MCP says `"commit":"No"` — an in-memory change the caller
must commit. A review that stops at mxcli states the opposite of the truth.

## Step 5 — if Studio Pro turns out to be closed

Say so in the output, and fall back to mxlint, which carries the same fields in one artifact:

```bash
mxlint export    # point modelsource at a scratch dir via --config; do not let it land in the project
```

Then read `modelsource/<Module>/.../<Doc>.<Package>$<DocType>.yaml`. Two traps: long filenames
are **truncated** (`SUB_Invoice_SendSingl_TRUNCATED_46aa2_icroflow.yaml`), so grep the contents
rather than looking for the name; and pages are named `Forms$Page.yaml`, not `Pages$Page.yaml`.

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
  Step 4b
- **Side effects** — commits, deletes, sub-flow calls, error-handling behaviour
- **Relationships** — callers, callees, entities, pages, from Step 3
- **Caveats** — anything neither source could confirm, and any disagreement you resolved

Name the sources you used. "mxcli describe + Studio Pro MCP" and "mxlint fallback, Studio Pro was
closed" are different confidence levels and the reader cannot tell them apart unless you say.
