# Reading a Mendix model: which tool for which fact

**House assumption: Studio Pro is open on the project, always.** Every tool here is chosen on
that basis. The one thing it does not buy you is history — see §5.

Four readers exist and **not one of them is complete**. This file records what each actually
returns, measured, and which to reach for. Nothing here is taken from a help text.

> **These are properties of Mendix 11.12.4**, with mxcli v0.24.0 and mxlint v3.18.0 — not of the
> tools in general. Every gap below is a gap *on this version*, and both CLIs move fast: two
> claims in this file went stale between mxcli v0.16 and v0.24, and Studio Pro 11.15 already
> carries MCP changes that may close others. Treat this as a dated measurement, not a
> specification, and re-probe before trusting it on a different version.

Measured 2026-10-02 against a production ERP project (`<app>.mpr`, Mendix **11.12.4**, 41 modules,
998 microflows, 231 pages, 15,044 activities) with **mxcli v0.24.0**, **mxlint v3.18.0** and the
**Studio Pro 11.12 MCP server** on `localhost:7782`. Re-measure when any of those move; these
gaps have moved before, and two of them moved between v0.16 and v0.24.

> **Document and module names below are renamed.** The measurements, sizes, counts and tool
> output are verbatim from a real project; only the nouns have been moved, so `Sales.Invoice` and
> `Scheduling.Board_Overview` are not real documents. Shapes and numbers are real.

---

## 1. The matrix

✅ = gives it directly · ⚠️ = gives it but impractically · ❌ = does not have it

| | **mxcli** | **mxlint** | **Studio Pro MCP** | **sweep.sh** (BSON) |
|---|---|---|---|---|
| **Microflow logic, execution order** | ✅ nested MDL | ⚠️ flat + `pseudocode` scalar | ❌ storage order, stubs | ❌ |
| **Expressions verbatim** | ✅ | ✅ | ⚠️ one drill per activity | ⚠️ raw |
| **Activity captions / annotations** | ✅ | ✅ | ⚠️ captions only | ⚠️ |
| **Page widget tree** | ✅ **90 KB, 1 call** | ⚠️ **7.4 MB** | ❌ 211 bytes of stubs | ⚠️ |
| **Entity attributes, types, defaults** | ✅ | ✅ | ✅ | ⚠️ |
| **Entity access rules + XPath** | ✅ full `grant … where` | ✅ | partial (add-only writes) | ⚠️ |
| **`allowedModuleRoles`** (who may execute) | ❌ | ✅ | ✅ | ⚠️ |
| **`applyEntityAccess`** | ❌ | ✅ | ✅ | ⚠️ |
| **`allowConcurrentExecution`** | ❌ | ✅ | ✅ | ⚠️ |
| **`commit` / `refreshInClient`** | ❌ | ✅ | ✅ | ✅ |
| **`errorHandlingType`** per activity | ❌ | ✅ (17 on one flow) | ✅ | ⚠️ |
| **`excluded` / `markAsUsed`** | ❌ | ✅ | ✅ | ⚠️ |
| **`documentation`** (author's notes) | ❌ | ✅ | ✅ | ⚠️ |
| **Callers / callees / impact** | ⚠️ `context`, `callers`, `refs` — misses snippet placement | ❌ grep only | ❌ | ✅ via `usages.js` |
| **Where a snippet / page is placed** | ❌ answers "(no references found)" | ❌ layouts are not exported | ❌ cannot read a snippet | ✅ `usages.js`, ~1 s |
| **Which user roles hold a module role** | ❌ `refs` answers "(no references found)" | ✅ project security is exported | ❌ | ⚠️ grep |
| **Sequence-flow edges** | ✅ | ❌ **dropped entirely** | ❌ stubs | ✅ only source |
| **Marketplace module contents** | ✅ | ❌ skipped on export | ✅ | ✅ |
| **Project-wide architecture** | ✅ `graph-report` | ✅ via lint rules | ❌ | ❌ |
| **Reads a historical commit** | ✅ | ✅ | ❌ **never** | ✅ |
| **Needs Studio Pro open** | no | no | **yes** | no |
| **Can write the model** | yes (forbidden here) | no | yes (6 tools) | no |
| **Cost of one document** | 1 call, instant | 18.5 s full export | 1–40 calls | 1 call |

### Measured sizes, same document, one call each

**Microflow** `Billing.SUB_Invoice_SendReminder`:

| mxcli `describe` | mxlint YAML | MCP root read |
|---|---|---|
| **6,551 B — complete** | 16,955 B — complete, after an 18.5 s export | 1,705 B — **28 empty stubs, zero activities** |

**Page** `Scheduling.Board_Overview`:

| mxcli `describe page` | mxlint YAML | MCP `pg_read_page` |
|---|---|---|
| **90,550 B — complete tree** | **7,754,756 B** (7.4 MB) | **211 B — everything elided to `"..."`** |

---

## 2. What this means in practice

**mxcli is the default for reading anything.** Logic, pages, entities, access rules,
relationships. It is one call, it is complete, and for pages it is the *only* practical option —
mxlint's export of a single page is 7.4 MB and the MCP returns 211 bytes of `"..."`.

**The MCP has exactly one job: the flags mxcli cannot render.** That is a short list, and it is
load-bearing:

`allowedModuleRoles` · `applyEntityAccess` · `allowConcurrentExecution` · `excluded` ·
`markAsUsed` · `documentation` · and, per activity, `commit` · `refreshInClient` ·
`errorHandlingType`

**Do not use the MCP to read logic or pages.** It expands one level per call — "children are
stubs; re-read child paths to expand further", in its own words. A 21-activity microflow costs
25–40 round trips through it and still arrives in storage order rather than execution order. A
page costs hundreds and never finishes being useful.

**mxlint is now a narrow tool**, given Studio Pro is always open: it is the only reader that puts
every property of a document in one artifact, and it is what `build-history.sh` replays to make
commits diffable. For answering a question about the current model, mxcli + MCP beats it on both
latency and size.

**sweep.sh** stays the tiebreaker and the only source of sequence-flow edges across a diff.

### The MCP is the only reader that sees the model you are looking at

**Measured 2026-10-02, and it overturns the obvious reading of the matrix above.** While Studio
Pro is open and being edited, the files on disk lag the live model — so mxcli and mxlint are
answering about a state that no longer exists.

The test: two `log` activities added to `Sales.BCO_Customer` in Studio Pro, one saved, one not.

| | On disk (`.mxunit`) | Live model (MCP) |
|---|---|---|
| `LogMessageAction` count | **1** | **2** |
| Message text | `EDIT\n` | two full multi-line messages |

`mxcli describe` rendered one log activity with the text `EDIT\n`. The MCP returned both
activities with their real text. Decoding the `.mxunit` on disk confirms the disk genuinely holds
only one.

**The trap is that this is not a clean saved/unsaved boundary.** Studio Pro *had* written the
`.mpr` 80 seconds earlier, and git saw both the `.mpr` and the unit as modified — so disk was
neither the last commit nor the current model, but a partial state somewhere between. You cannot
tell from a file timestamp, from `git status`, or from the content itself whether what you are
reading is current. In the same session the `.mpr` had also sat **68 minutes** without a write
while Studio Pro was open.

So, with Studio Pro open:

- **mxcli and mxlint read the last write, not the model.** For logic and page structure they are
  still the only practical tools — but their answer may be stale by an unknowable amount.
- **The MCP is the authority on current state.** If a conclusion depends on the document being
  exactly as it is on screen — a bug that reproduces now, anything the developer just changed —
  confirm it through the MCP or ask them to save first.
- **Asking them to save is the cheap fix**, and worth doing before any bulk read.

For a historical commit none of this applies: the worktree is not open in Studio Pro, so disk is
exactly the commit.

### The MCP also has capabilities that are not in the matrix at all

Because none of them are reads of the model:

| | Why nothing else has it |
|---|---|
| **`ped_check_errors`** | Runs **Studio Pro's own consistency check** against the live model, per document. mxcli's `check` validates MDL scripts and `lint` runs rule packs; neither is Studio Pro's validator. Returns `No errors found.` or just the failing documents |
| **`search_mendix_knowledge_base`** | Official Mendix documentation, retrieved and ranked. One query on OQL view entities returned **56 KB** including the View Entities refguide page. Neither CLI ships docs |
| **`read_skill`** | Mendix's **own authoring conventions**, maintained upstream — `microflow-common` is 5.5 KB of naming rules, happy-path/alternative layout and spacing formulas. There is no other copy of this |
| **`oql_generate`** | Generates OQL against a named module's real domain model; with `documentName` it writes straight into a `ViewEntitySourceDocument` |
| **Writing the model** | 6 tools. The only agent-driven authoring path that exists. Out of scope for this read-only toolkit, but it is the headline capability |

So the division is cleaner than "which reader is best": **mxcli and mxlint read the model; the MCP
validates it, documents it, and changes it.**

### Settled: the MCP sees unsaved work, the CLIs do not

Previously open; tested 2026-10-02 and recorded above. The answer is yes, and the staleness has
no reliable tell — see the table at the top of this section.

---

## 3. The maximum-fidelity read of one document

Three calls. Studio Pro is open, so step 3 is always available.

```bash
# 1. The backbone. Logic in execution order, expressions inline, captions, annotations.
mxcli describe microflow <Module>.<Doc> -p <app>.mpr
#    …or: describe page / entity / nanoflow / workflow — same command, same completeness.
```

```bash
# 2. Relationships. Nothing else gives this.
mxcli context <Module>.<Doc> -p <app>.mpr --depth 2
```

First run builds the whole-project catalog (40-odd tables, 15k activities) and is slow; later
runs reuse it. `mxcli -c "refresh catalog full"` after the project is edited.

**3. The flags — MCP, one or two calls.**

```
ped_read_document { documentType: "Microflows$Microflow", documentName: "<Module>.<Doc>" }
```

Ignore the stub arrays; read the flags listed in §2. Then, for the activities that *write*:

```
ped_read_document { ..., paths: ["/objectCollection/objects"] }          # locate them
ped_read_document { ..., paths: [".../29/action", ".../30/action"] }     # one batched call
```

Batch every path into a single call. Only read activities that write — `ChangeObjectAction`,
`CreateObjectAction`, `DeleteAction`, `ChangeListAction` — plus whatever the question is about.

**Confirm the open project first.** `list_modules` is one cheap call and its module list is
unmistakable. The MCP answers about whatever Studio Pro has open, with no indication that it is
a different project from the one you were asked about.

### Why step 3 is not optional

mxcli renders this:

```
change $Invoice (SendAt = [%CurrentDateTime%], CountSentEmails = ... + 1);
```

which reads as "it sets these". The MCP says of that same activity:

```json
{"$Type":"Microflows$ChangeObjectAction","refreshInClient":false,"commit":"No","errorHandlingType":"Rollback"}
```

It is an **in-memory change the caller must commit**. A review that stops at mxcli states the
opposite of the truth, and mxcli has no way to express the difference in any output format.

---

## 4. Entities are a special case — mxcli already does security

The gap above is about **microflow execute roles**. It is not about entity access, which
`mxcli describe entity` gives in full, including the XPath on each rule:

```
grant Sales.Editor on Sales.Invoice (create, delete, read (…), write (InvoiceNumber))
  where '[Status = ''Processed'']';
```

Attributes arrive with types and defaults in the same call (3,709 B for `Sales.Invoice`,
16 attributes, 5 grants). Do not reach for mxlint or the MCP for a domain-model question.

---

## 5. The one thing an open Studio Pro does not buy you: history

**The MCP reads the working copy and nothing else.** It cannot read a commit, a detached
worktree, or a range — and no amount of having Studio Pro open changes that.

So every skill that analyses a *range* works exactly as before, with no MCP step:

| Skill | Reads | MCP |
|---|---|---|
| `mendix-review` | a commit range | ❌ unavailable |
| `mendix-test-instructions` | a commit range | ❌ unavailable |
| `mendix-change-notes` | a commit range | ❌ unavailable |
| `mendix-change-report` | a commit range | ❌ unavailable |
| `mendix-plan` | the current model | ✅ use it |
| `mendix-scout` | the current model | ✅ use it |
| `explain-mendix-doc-complete` | the current model | ✅ use it |

A further trap: the working copy is **ahead of or behind** the commit you may be reasoning
about. If the question is "what changed in TICKET-711", the MCP's answer describes neither the
before nor the after. Use it only for questions about the model as it stands right now.

---

## 6. Claims that were true and are now false

Re-tested on mxcli v0.24.0 / mxlint v3.18.0. **Do not carry these forward from older notes.**

- **Multi-clause XPath truncation is FIXED.** mxcli renders every clause:
  ```
  retrieve $InvoiceList from Sales.Invoice
      where [Status = Project.ENUM_Invoice_Status.Processed]
      [SendAt < $ReminderOffset];
  ```
  mxlint is no longer the XPath tie-breaker.

- **`mxcli diff-local` is no longer broken.** v0.16 failed on every ref; v0.24 connects and
  reports cleanly. Checked against a clean tree only, so the scripts here stay the trusted path.

- **The MCP is NOT good at pages.** An earlier draft of this file said `pg_read_page` returns a
  usable widget tree in one call because it accepts `depth` and `paths`. Measured, it does not:
  the full-page read is **211 bytes** with every widget list elided to `"..."`, and `depth` only
  truncates further. `mxcli describe page` returns the real 90 KB tree.

Still true, re-confirmed on v0.24:

- `mxcli describe module X` emits only `create module X;` plus module roles. MDL is per-document.
- mxcli shows no `commit`, `refreshInClient`, `errorHandlingType`, `applyEntityAccess` or
  `allowedModuleRoles` in any format — `-f json` only wraps the same MDL string in
  `{mdl, name, type}`. Grep over a full describe: zero hits.
- **mxlint drops `Flows:` entirely** and **skips marketplace modules** on export (observed:
  `Ignoring appstore module: NanoflowCommons`, `OIDC`, and others).

New, not previously recorded:

- **mxlint truncates long filenames** in its export —
  `SUB_Invoice_SendRemi_TRUNCATED_46aa2_icroflow.yaml`. You cannot locate a document by filename
  when its name is long; grep the contents, or use the generated `app.yaml` path map.
- **No layouts reach the mirror in the app measured.** Layouts live in marketplace modules
  almost by default: one app owns 33 layouts and not one of them sits in its own module, so
  `mxlint export` writes zero `Forms$Layout` files and every tool scoped by the mirror —
  `review.sh --summary`, `lint-diff.sh`, `invariants.sh` — is blind to a layout change. Whether
  mxlint would export a layout in an app's **own** module is untested; no app here has one.
  `mirror-gaps.sh` reconciles the mirror against the raw `.mxunit` census and names the
  difference.
- **`mxcli describe` auto-detect does not know layouts.** A bare qualified name answers
  `no describable document named ...` — indistinguishable from "this type cannot be described" —
  while `describe layout <Module.Name>` returns the whole thing. That one missing word was enough
  to make `mdl-diff.sh` report a marketplace layout as unreadable; it now takes `<type>:<name>`.
- **`mxcli refs` and `mxcli impact` do not index snippet-call placement.** Both answer
  `(no references found)` for a snippet that is placed on a layout — measured on v0.24.0 against
  two snippets, both placed on the app-wide layout, which lives in a marketplace UI module. The silence is convincing because the same
  commands *do* resolve microflow calls (`MICROFLOW … call`) and widget actions (`SNIPPET … action`)
  correctly. `usages.js` scans the BSON instead and finds the `Forms$SnippetCall.Form` property.
- **`mxcli refs` does not index user-role membership either.** `refs <Module>.<Role>` answers
  `(no references found)` while project user roles still hold that module role — measured after a
  module delete, where two of them did and Studio Pro reported no error because security was `Off`.
  Read `describe user role <Name>`, or the project security unit, and never conclude "unused" from
  `refs` alone.
- **Nothing can rename a layout.** `mxcli rename` has no layout type, and over the MCP
  `Pages$Layout` and `Forms$Layout` are unknown document types, `ped_list_folder` does not list the
  layout, and `pg_read_page` answers `Page not found`. A layout copied in Studio Pro keeps the name
  Studio Pro gave it (`<Name>_2`) until a person renames it there — which is also the only thing
  that updates the references to it.
- **`mxcli SEARCH` is a string search, not a usage search.** `SEARCH 'Snippet_WeatherWidget'`
  returns the seven literals *inside* that snippet and nothing that references it.
- **mxlint names page files `Forms$Page.yaml`**, not `Pages$Page.yaml`.
- A full export of this project takes **18.5 s** and writes 1,411 files across 24 content roots,
  totalling **269 MB** on disk. That is the real cost of the mirror `build-history.sh` maintains,
  and the reason an export is not something to reach for casually when Studio Pro is open.

---

## 7. mxcli v0.24 commands this toolkit does not yet use

All read-only:

- `graph-report` — god nodes, coupling, cohesion, dead code.
- `structure` / `project-tree` — compact project overview, JSON.
- `report` — best-practices report. `lint` — mxcli's own linter.
- `describe` now covers `queue`, `scheduledevent`, `regularexpression`, `restclient`,
  `odataclient`, `odataservice`, `imagecollection`, `buildingblock`, `projectsecurity`,
  `modulerole`, `userrole`, `settings`, `demouser`, and the Mendix 11 AI documents — `agent`,
  `aimodel`, `knowledgebase`, `consumedmcpservice`, `datatransformer`.
- `mcp capabilities --mcp <url> -p <app>.mpr` — asks the connected Studio Pro what it can author.
  Quote it in bug reports rather than a version number.

---

## 8. Safety

**Everything above is read-only, and it must stay that way.**

- Only these mxcli verbs: `describe`, `context`, `callers`, `callees`, `refs`, `impact`,
  `search`, `show`, `structure`, `project-tree`, `graph-report`, `report`, `mcp capabilities`,
  `refresh catalog`. **Never `exec`, `fix`, `rename`, `layout`, `new`, or any MDL write.**
- **Never pass `--mcp`.** It routes model writes into the running Studio Pro. mxcli's own `mcp`
  subcommand prints `WARNING: This is a vibe-coded PoC, alpha quality, use with caution.` on
  every invocation — believe it.
- Of the MCP's 18 tools, **6 write**: `ped_create_document`, `ped_update_document`,
  `ped_create_module`, `pg_patch_page`, `write_file`, `install_marketplace_module`. Any automated
  route to this server must allowlist the read tools **by name** and fail closed — never
  allowlist the server.
- **mxcli reads are safe while Studio Pro is open** — which is the standing assumption here.
  `mxcli mcp capabilities` states "Reads … always available from the local .mpr", and the `--mcp`
  design assumes exactly that pairing. mxcli *writes* while the project is open stay forbidden.
- mxlint `export` is read-only against the `.mpr`, but it **writes a `modelsource/` tree**. Point
  it somewhere scratch via a config file rather than letting it land in the project.

---

## 9. Connecting the MCP

Studio Pro: **Preferences → AI → MCP Server**. Port defaults to 7782 (auto-selected from 11.13).

Register it at **user scope**, not project scope. An agent launched against a Mendix checkout
has that checkout as its working directory, so a server scoped to some other project is invisible
to it — `claude mcp list` run from the checkout simply does not list it.

```bash
claude mcp add -s user mendix --transport http http://localhost:7782/mcp
```

Three things that will otherwise waste your time:

- **The URL hostname must be `localhost`, never `127.0.0.1`.** Studio Pro registers its prefix
  with Windows http.sys under the literal hostname `localhost`, and http.sys matches on the Host
  header, so the IP form is rejected before anything MCP-aware sees it. Measured on the same
  endpoint, same instant: `Host: localhost` → **HTTP 200**, `Host: 127.0.0.1` → **HTTP 400 Bad
  Request — Invalid Hostname**. The failure names the hostname, which is easy to read as a
  networking problem rather than a string-matching one.
- **mxcli's `--mcp-dial 127.0.0.1:7782` is the exception, and not a contradiction.** It overrides
  only the TCP address dialled and leaves the URL — and therefore the Host header — as
  `localhost`. Use it when mxcli's Go resolver sends `localhost` to the LAN address and hangs
  (`dial tcp <your-LAN-ip>:7782: i/o timeout`). Never put the IP in the URL itself.
- **Tools do not appear in a session that was already running** when you added the server.
  `claude mcp list` says `✔ Connected` and the tools still are not there. Start a new session.

The listener is registered with Windows http.sys on **`0.0.0.0:7782`**, not loopback, and exposes
write tools into an open project with **no authentication**. On an untrusted network, turn it off
when you are not using it.
