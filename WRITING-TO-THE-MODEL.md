# Writing to a Mendix model from an agent — what actually happens

Field notes from three instrumented write runs against scratch apps, Mendix 11.12.4, Studio Pro MCP
server on `localhost:7782`, mxcli v0.24.0: a weather widget built from nothing (§1–18, 2026-10-02/03),
a starter-module removal (§19–23, 2026-10-06) and a REST integration of 16 documents (§24–26,
2026-10-07). The second run corrected one of the first run's conclusions — see §19. The third is the
only one that produced a project no tool could open, and it did so from a script that passed the
dry run — see §24.

Everything here was measured during the run. Where a published capability list disagrees with
what the server did, the server wins and the disagreement is recorded.

**Status: the feature was built and runs.** Nine model documents plus CSS, authored by an agent
across both write paths, with a person doing the five steps no tool can (§15). The app starts
without error and the widget works.

> **These findings are properties of Mendix 11.12.4**, with mxcli v0.24.0 and mxlint v3.18.0 —
> not of the tools in general. Every gap recorded here is a gap *on this version*. Studio Pro
> 11.15 already carries MCP changes (scoped `ped_check_errors` among them, per mxcli#922) that may
> close some of them, and both CLIs move fast: two claims in this toolkit's own notes went stale
> between mxcli v0.16 and v0.24. Re-probe before trusting any capability statement on a different
> version, and treat this file as a dated measurement rather than a specification.

---

## 1. The headline: the loop cannot close without a person

Two steps in the MCP write path have **no tool at all**:

| Step | Tool | Consequence |
|---|---|---|
| **Save the model** | **none** — all 18 tools listed, none matches save/commit/persist | Writes live only in Studio Pro's memory |
| **"Update security"** after any access-rule change | **none** | `ped_check_errors` reports the model as in error until a human clicks the button in the domain model editor |

`ped_check_errors` after adding one access rule returned, verbatim:

> `'SampleApp': - Entity access is out of date. Please update security by clicking the 'Update
> security' button in the domain model editor.`

So an agent can author an entity, give it attributes, defaults and access rules — and then must
stop and ask a person to click a button and press Ctrl+S. Any pipeline design that assumes
"scout → plan → build" runs unattended is wrong at this step, and it is not a gap that better
prompting closes.

(mxcli can reach a save through `--mcp-save`, but only with a second MCP server, Concord, also
connected: *"requires --mcp-concord; the built-in server has no save tool"*. Untested here.)

## 2. MCP writes are invisible to every other tool until saved

Immediately after a successful write, on the same machine, same second:

| Reader | Sees the new entity? |
|---|---|
| MCP `ped_read_document` (live model) | **yes** — 27 entities |
| `mxcli` against the `.mpr` | **no** — 0 matches |
| `git status` | **no** — 0 dirty files |

This breaks plan verification. The plan for this story specified, for its first step:

> Check: `mxcli describe entity SampleApp.WeatherHelper` shows both module roles.

That check **cannot run** after an MCP write. It is not wrong, it is just unreachable until
someone saves. Either the write loop becomes write → *human saves* → verify, or verification has
to use `ped_read_document` and `ped_check_errors` instead of mxcli. Prefer the latter where
possible; it keeps the loop inside one tool.

## 3. Baseline the validator before writing

`ped_check_errors` was not run before the first write, so when it reported the security error
afterwards there was no way to prove the write caused it. It almost certainly did — the message
is about stale compiled security and an access rule had just been added — but "almost certainly"
is not what this check is for.

**Run `ped_check_errors` on every document you are about to touch, before touching it.** It is one
call and it converts every later error from a guess into an attribution.

## 4. The capability list is second-hand. Ask the server.

`mxcli mcp capabilities` is the best *summary* of the write surface, and it was wrong on the first
thing this run depended on:

> ✗ Entity defaults, indexes, non-persistent entities … are not built yet (and PED's entity
> constructor exposes no persistable flag)

The constructor **does** expose `isPersistable`, documented in its own schema, and a
non-persistent entity was created with it on the first attempt. Attribute defaults also work
(see §5).

Use `ped_get_schema` on the element type you are about to write. It is authoritative, it is one
call, and the tool's own instructions make it mandatory before creating anyway.

## 5. The constructor schema is not the full writable surface

`ped_get_schema` on `DomainModels$Attribute` returns exactly three properties: `name`, `type`,
`enumerationName`. No default, no length. The obvious conclusion — that defaults are unreachable —
is **wrong**.

The default lives on a *child element* at `/value`, and setting it works:

```json
{"path":"/entities/26/attributes/3/value",
 "operation":{"type":"set","value":{"$Type":"DomainModels$StoredValue","defaultValue":"false"}}}
```

The only thing that revealed this was the error message from getting it wrong:

> `Expected an object, got boolean. Set operations require the value to conform to the
> $constructor schema if available, otherwise the full $element schema.`

**Read the errors as documentation.** A rejected path says "wrong shape"; a rejected *path* says
"no such property". Those are different answers and the message distinguishes them.

String length was not solved. `ConditionText` was created as a plain `String` and the plan's
`String(100)` was not applied — the shape for it was not found before the run stopped.

## 6. Four shape traps, all hit on the first attempt

1. **An entity is not a document.** `ped_create_document` says *"Never create domain models"*.
   Entities are an `add` operation on the domain model document via `ped_update_document`.
2. **`operation` is an object, not a string.** The prose says `operation: set (…), add (…),
   remove (…)`, which reads like an enum. The schema requires `{"type":"add","value":{…}}`.
3. **An `add` path must not carry an index.** `/entities`, never `/entities/-`.
4. **`ped_find_document` and `ped_read_document` take different type vocabularies.**
   `ped_read_document` requires `DomainModels$DomainModel`; `ped_find_document` rejects it with
   *"Did you mean: DomainModels$ViewEntitySourceDocument?"*. The "mandatory before creating" find
   step therefore cannot be performed for a domain model at all. Check existence another way
   (`ped_read_document`, or mxcli).

## 7. Failure behaviour is good, with one exception

Both failed writes during this run left the model untouched — the entity still had 5 attributes
and 0 access rules afterwards, verified by re-reading it. Validation failures happen before
anything is applied.

The exception is stated by the tool and should be believed:

> removing, overwriting, or renaming elements can have side effects that persist even when another
> operation fails.

So **batch `add` operations freely; never batch a `remove` or a rename with anything else.** Put
destructive operations in a call of their own so a failure elsewhere cannot half-apply them.

Also: *"After running ped_check_errors, YOU GET TO UPDATE THE DOCUMENT EXACTLY ONCE. After that,
if there are still errors, report them and STOP."* One fix attempt, then stop.

## 8. What the plan got right, and what it could not know

The plan for this story was written by `mendix-plan` with a note telling it the output would be
executed by a writing agent. Two things it did that a plan written for a human would not:

- It read `mxcli describe layout` output and found two widgets marked *"NOT re-executable: mxcli
  cannot author this widget"*, and routed that one step away from mxcli with a warning that
  round-tripping would silently delete a sidebar toggle **on all 33 pages that use the layout**.
- It verified the *opposite* for its new snippet — that every widget type it proposed describes
  cleanly on a comparable existing snippet — rather than assuming.

It could not know §1 or §2, because nothing documented them. Its per-step verification commands
are all mxcli, and half of them are unreachable on the MCP path. **A plan intended for a writing
agent must be told which reader can verify each step**, not just which writer can author it.

## 9. `SUCCESS` does not mean the result matches the plan

The loop closed: after a person clicked "Update security" and saved, `ped_check_errors` returned
*No errors found*, mxcli read the entity, and `git status` showed exactly **two** files — the
`.mpr` and **one** `.mxunit`. A single-unit diff, cleanly attributable. That part worked.

What the model actually contains is not quite what was asked for:

```
create or modify non-persistent entity SampleApp.WeatherHelper (
  TemperatureC: Decimal default 0,        <-- a default nobody asked for
  ConditionText: String(200),             <-- the plan said String(100)
  ObservedAt: DateTime,
  IsAvailable: Boolean default false,
  IsMinimized: Boolean default false
);
```

Every write returned `SUCCESS`. Nothing warned. Both deviations are the platform filling in its
own defaults for properties the constructor schema does not expose — `String` length defaults to
200, `Decimal` gets `default 0` — and both are invisible from inside the MCP, because
`ped_read_document` does not echo them either.

**The only thing that surfaced them was reading the result back with a different tool.** This is
the strongest argument in these notes for keeping mxcli in the loop on the MCP path: not as the
writer, but as the independent reader that can see what the writer actually produced.

So the verification step is not "did it succeed" but **"does the result match the spec, field by
field"** — and on an MCP write that comparison has to happen after the save, in mxcli.

Neither deviation matters for this story: 200 characters is harmless for a weather condition
string, and `Decimal default 0` is inert on a non-persistent helper that is always filled before
use. That is luck, not design. On a persistent entity an unrequested default is a data decision
nobody made.

## 10. Working order for an MCP write

1. `ped_get_schema` for every element type involved. Mandatory, and it is the real contract.
2. `ped_check_errors` on the target documents — the baseline (§3).
3. Confirm the document does not already exist. Not with `ped_find_document` if it is a domain
   model (§6.4).
4. Write. Batch independent `add`s; isolate anything destructive (§7).
5. Re-read what you wrote with `ped_read_document`. Do not assume `SUCCESS` means the result
   matches the intent — it means the operations applied (§9).
6. `ped_check_errors` again. Compare against the baseline from step 2.
7. **Hand back to a person** for "Update security" if access rules changed, and for the save.
8. After the save, read the result back **with mxcli** and diff it against the plan field by
   field. This is the only step that catches platform-supplied defaults the MCP never shows you
   (§9), and the only one that confirms what reached disk. `git status` should show the `.mpr`
   plus one `.mxunit` per document touched — more than that means something else moved.

## 11. The mxcli leg, measured against the same story

Steps 3–5 (JSON structure, import mapping) went through mxcli with Studio Pro closed. Three
documents created in one `exec`. Everything read back exactly as written.

**Correction to an earlier note in this file's history:** mxcli *can* author both
`CREATE JSON STRUCTURE … SNIPPET '{…}'` and `CREATE [OR MODIFY] IMPORT MAPPING … WITH JSON
STRUCTURE`. The `MDL-REST01` restriction — "an existing import/export mapping document cannot be
referenced here" — applies only to inline mappings on a **REST client operation**, a different
construct. A `REST CALL` activity in a microflow takes `RETURNS MAPPING Module.IMM AS Module.E`
and references the document normally.

### What mxcli does better than the MCP

| | MCP | mxcli |
|---|---|---|
| Dry run before applying | none | **`mxcli check`** — syntax + reference validation, no write |
| String length honoured | ✗ silently became `String(200)` | ✓ `String(40)` as written |
| Unit of work | one call per operation shape | one script, many statements, applied together |
| Reviewable before execution | no — JSON built in flight | **yes — MDL is text you can read and diff** |

`mxcli check` is the single biggest safety difference. It reported `✓ Syntax OK (3 statements)`
and `✓ All references valid` *before* anything touched the file. The MCP has no equivalent:
`ped_check_errors` only runs on documents that already exist, so the first time you learn a write
is malformed is when it has already been attempted.

The `String(40)` vs `String(200)` difference is the same class of problem as §9 — but mxcli got it
right because MDL can *express* the length, and the MCP constructor schema cannot.

### Integrity: the published corruption signature did not reproduce

The most-cited failure in the mxcli MVP report (April 2026, v0.7.0) is a fresh `.mpr` whose
*"DB has 407 entries; only 38 files exist on disk"*, crashing Studio Pro with
`DirectoryNotFoundException`. After this write on v0.24.0:

```
.mpr Unit table rows : 1381
.mxunit files on disk: 1381
```

Exact match, 3 new units for 3 new documents (JSON structure, import mapping, and the
`Objects/Weather` folder), nothing stray. The entity written earlier through the MCP survived
untouched.

**This is one small write, not a full MVP build**, so it does not retire the report's finding —
but the signature is absent where it was previously reliable, and the v0.24 changelog is largely
write-path hardening. Treat the 80/20 number as unmeasured on current versions rather than true.

### A simplification the plan could not know about

The plan proposed two mapping entities joined by an association — the shape Studio Pro's mapping
generator produces. MDL import mappings support **nested members** (`Attr = a/b/c`), which reach a
leaf with no entity for the levels in between, so one entity was enough:

```
create SampleApp.OpenMeteoCurrent {
  Time          = current/time,
  TemperatureC  = current/temperature_2m,
  WeatherCode   = current/weather_code
}
```

Recorded as a deliberate deviation in the script's own comment header. The general lesson: a plan
written against Studio Pro's idioms will over-specify for mxcli, because the generator's output
shape and the language's expressive shape are not the same. **A plan for a writing agent should
name the outcome, not the document topology** wherever the two can differ.

## 12. `mxcli check` prevented a Studio Pro crash

Steps 6–8 (datasource microflow, nanoflow, snippet) took **three check iterations and zero
writes**. The first attempt would have produced a model that crashes the IDE:

> `widget weatherTemp (dynamictext) references template placeholder {1} but only 0 parameter(s)
> are bound … **An orphaned placeholder crashes Studio Pro.**` `[MDL-WIDGET04]`

The property was `Parameters:` where MDL wants `ContentParams: [{1} = …]`, and a second rule
caught that the wrong spelling would have been *"silently dropped on write"* rather than
rejected — so the write would have "succeeded".

This is the clearest result in these notes. **The MCP has no equivalent of this step**, and the
same mistake made through `pg_patch_page` would have been applied, saved, and discovered when
somebody opened the page.

Two more rules fired, both the kind of knowledge a reviewer usually supplies:

- `MDL-WIDGET24` — a template parameter is evaluated against the widget's own context object, so
  it takes the attribute **name**, not `$currentObject/Attr`. Left wrong, mxbuild reports
  `CE1613 "The selected attribute … no longer exists"`.
- `MDL-WIDGET15` — adjacent inline `dynamictext` widgets render as `<span>` with no separator, so
  their text concatenates. It also says `Paragraph` does **not** fix this. Each line is now in its
  own container because of that warning.

### A real mxcli gap, stated by mxcli

> `MDL cannot author an expression-typed template parameter yet … Mendix DOES support it: Studio
> Pro's Edit Template Parameter dialog has a Value | Expression choice.` `[MDL-WIDGET14]`

So `formatDecimal($currentObject/TemperatureC, '#0.0')` and
`formatDateTime($currentObject/ObservedAt, 'HH:mm')` cannot be written by mxcli. The widget binds
the raw attributes instead, which renders an unformatted decimal and a full datetime. **Recorded
as a deviation, not a completion** — the formatting is a Studio Pro step.

Note the shape of that message: it says what is impossible, that the platform supports it anyway,
and exactly where a human does it. That is the standard a capability report should meet, and it is
why mxcli's own diagnostics are a better authority than any summary of them.

## 13. Deviations from the plan after the mxcli leg

Carried forward so a reviewer does not have to diff the plan to find them:

| Plan | Built | Why |
|---|---|---|
| `ConditionText: String(100)` | `String(200)` | MCP constructor cannot express length (§9) |
| *(no default)* | `TemperatureC: Decimal default 0` | platform default (§9) |
| two mapping entities + association | one entity, nested members | MDL reaches nested leaves directly (§11) |
| `formatDecimal(...)`, `formatDateTime(...)` in the widget | raw attribute binds | `MDL-WIDGET14`, needs Studio Pro |
| separate `OpenMeteoResponse` entity | not created | unnecessary after the simplification |

None of these were silent. The first two were found by reading back with mxcli; the rest were
reported by `mxcli check` before anything was written.

## 14. Studio Pro found six errors. Would this process have caught them?

Mostly no. Reopening Studio Pro after the mxcli leg surfaced six errors in work that `mxcli check`
had passed and that had been read back and verified. Taken honestly, they fall into three groups,
and only one of them is a tool gap.

### Group 1 — the plan told me, and I did not do it (2 errors)

> `SampleApp.DS_WeatherHelper`: At least one allowed role must be selected if the microflow is
> used from navigation, a page, a nanoflow or a published service.

Same for the nanoflow. The plan said, in step 6, in as many words:

> Grant execute to `SampleApp.Administrator` and `SampleApp.User`. (`DS_InfopanelHelper` grants
> only `SampleApp.User`; do not copy that.) **Check: `mxcli describe microflow
> SampleApp.DS_WeatherHelper` shows both grants.**

The grant was never written, and the check was never run. `mxcli describe` shows the microflow
with no grants, so **the plan's own verification command would have caught this immediately**.

This is not a tooling failure. Every step of that plan carried a `Check:` line, and this run
executed the writes and skipped the checks. **That is the single most important process finding
here**, and it is a discipline problem, not a capability one: an agent that writes faster than it
verifies produces exactly this.

### Group 2 — a real gap between the two validators (1 error)

> `SampleApp.IM_OpenMeteoCurrent`: The mapping does not align with the underlying schema anymore.
> Attribute type 'String' does not match schema type 'DateTime' of element `(Object)/current/time`.

`mxcli check` passed this. The JSON structure inferred `time` as **DateTime** from the ISO-looking
string `"2026-10-03T17:45"`; the mapping entity declared `Time: String(40)`, following the plan's
design of parsing it in the microflow. Nothing in the mxcli toolchain compares an entity attribute
type against the inferred schema type of the element it is mapped from.

`mxcli check` validates **syntax and references**. Studio Pro's error list validates **the model**.
They are not the same check and they catch disjoint sets — §12 is a crash that Studio Pro would
not have reported until the page was opened, and this is a type mismatch that check will never
report at all.

**Treating a green `mxcli check` as "correct" is the mistake.** It means "this will apply", not
"this is right".

### Group 3 — invisible to the tooling entirely (the remainder)

`ped_check_errors` on the snippet returns:

> `No API registered for unit type 'Pages$Snippet'.`

So **snippets cannot be error-checked over MCP at all**. Any error in the widget tree is
unreachable from either tool: mxcli has no model validator, and the MCP refuses the document type.
Those errors are visible only to a person with Studio Pro open.

> **Corrected on 2026-10-06 (§19): that last sentence is wrong.** There is a third validator —
> `mx.exe check`, shipped with Studio Pro — which runs the same consistency check over the whole
> project, headless, and does see snippets, layouts, navigation and project security. "Unreachable
> from either tool" was true of the two tools an agent *writes* with, and was never true of the
> tooling available to it. The rest of this section stands.

### What this changes

1. **Run the plan's `Check:` line after every step, before the next write.** Not at the end.
2. **Reopen Studio Pro and run `ped_check_errors` after any mxcli leg**, before building on it.
   It is the only validator that sees the model as Mendix sees it.
3. **Expect to end at a human.** Of the three errors reachable by tooling, the MCP could fix one
   (`allowedModuleRoles` on a microflow), could not fix the second
   (`Microflows$Nanoflow is not supported` — updates are excluded, not just creates), and the
   third is a right-click in Studio Pro ("Resolve by updating from schema").

### Fix routing for these six

| Error | Fixable by |
|---|---|
| `DS_WeatherHelper` allowed roles | **MCP** — done, `/allowedModuleRoles` add × 2 |
| nanoflow allowed roles | **not the MCP.** mxcli `GRANT EXECUTE` with Studio Pro closed, or by hand |
| mapping type mismatch | mxcli (retype the attribute) with Studio Pro closed, or Studio Pro's right-click |
| snippet errors | unknown to tooling — needs a person to read them |

Three tools, three different closure paths, for one feature's worth of errors.

## 15. The last step cannot be done by any tool

Step 10 — adding one snippet call to `SomeUI_Module.AppFrame`, the layout all 33
pages use — is the step that makes the feature appear. It is blocked by **two independent
constraints**, either of which alone is enough:

**The MCP has no layout type.** `ped_read_document` rejects both plausible names:

```
Forms$Layout  -> ERROR: Unknown document type 'Forms$Layout'.
Pages$Layout  -> ERROR: Unknown document type 'Pages$Layout'. Did you mean: Pages$Page?
```

The suggestion is `Pages$Page`, so there is no layout type in the registry at all. `ped_list_folder`
on the module's `_Layouts` folder returns no documents either.

**The module is not writable.** `list_modules` reports it plainly:

```json
{"moduleName":"SomeUI_Module","writable":false,"fromMarketplace":true}
```

**And mxcli is already ruled out** — the plan found two `Forms$SidebarToggleButton` widgets marked
*"NOT re-executable: mxcli cannot author this widget"*, so writing the layout back would silently
delete them from every page.

So the routing table for this one step is:

| Writer | Verdict |
|---|---|
| Studio Pro MCP | no layout type, and the module is read-only |
| mxcli | would destroy the sidebar toggles on 33 pages |
| **A person in Studio Pro** | **the only path** |

### What that means for the pipeline

An agent built eight of the nine model documents for this feature. The ninth — a single widget
call, the smallest change in the plan — is human-only, and it is the one that makes the other
eight visible to a user.

This is worth stating plainly because it is not an argument against the pipeline. Eight documents
authored, validated and verified is real work. But **"scout → plan → build" does not end in a
built feature.** It ends in a feature that is assembled except for its integration point, with a
person needed for:

1. "Update security" after an access-rule change (§1)
2. Saving the model (§1)
3. Reopening Studio Pro between an mxcli leg and an MCP leg (§11)
4. Reading snippet errors, which no tool can (§14)
5. **The layout edit itself**

The honest framing is that the agent does the typing and the person does the wiring.

### A note on marketplace modules

`writable: false` is the single most useful field `list_modules` returns, and a planner should ask
for it **before** proposing a change. The plan here knew the layout was a Marketplace module and
correctly warned that a module update would overwrite the snippet call — but still proposed the
edit as something the MCP could do. One `list_modules` call during planning would have routed it
to a person from the start.

## 16. The agent's own tooling corrupted a write, and nothing caught it

Three errors in the snippet turned out to be visibility expressions missing their context prefix:

```
Visible: 'not(/IsMinimized)'                  <- what reached the model
Visible: 'not($currentObject/IsMinimized)'    <- what was intended
```

**mxcli wrote faithfully what it was given.** The `$currentObject` was eaten by shell escaping
while *generating* the MDL file — a `$` inside a JS template literal inside a bash heredoc. The
file on disk was already wrong before mxcli ever saw it.

Nothing caught it:

- `mxcli check` passed. It validates syntax and references; a visibility expression that is
  syntactically valid and references a real attribute passes even when the context root is missing.
- The read-back step was skipped — again (§14).
- `ped_check_errors` cannot read snippets at all, so the MCP would not have caught it either.

It surfaced only when a person opened Studio Pro and read the error list.

**The lesson is about the generation step, not the writing step.** Every safeguard in this document
is aimed at what the tool does with the input. None of them look at whether the input says what the
author meant. Two cheap defences:

1. **Write MDL with a quoted heredoc** (`<<'EOF'`), never an interpolating one, and never through
   a script that re-escapes the content. `$` is load-bearing in MDL and in every shell.
2. **Print the generated file and read the critical lines before running it.** One `grep -n
   "Visible"` would have shown `not(/IsMinimized)` and cost nothing.

The fix was re-running the same statement with correct escaping, then reading it back — all three
expressions now carry `$currentObject`, verified rather than assumed.

### `mxcli exec` is not atomic across statements

The fix script carried two statements. The first applied, the second failed:

```
Replaced snippet SampleApp.Snippet_WeatherWidget
Error: microflow not found: SampleApp.ACT_WeatherHelper_ToggleMinimized
```

(The grant used `ON MICROFLOW` for a nanoflow; the correct form is
`GRANT EXECUTE ON NANOFLOW Module.Name TO Module.Role`, which does exist.)

So a failed `exec` can leave a script half-applied — unlike `ped_update_document`, where a failed
operation applies nothing. **Order statements so the risky one runs first**, or run them
separately, and never assume a failed `exec` changed nothing.

### A documentation failure worth recording

The hand-off checklist told the user to run:

```bash
mxcli describe layout SomeUI_Module.AppFrame -p "<app>.mpr"
```

They ran it literally and got `failed to set busy_timeout: unable to open database file (14)` —
because `<app>.mpr` is not a file. **A checklist a person executes must contain literal, runnable
commands**, with the real filename in them. A placeholder is fine in reference documentation and
wrong in an instruction.

## 17. The widget rendered. Both remaining bugs were outside every validator.

With the layout edit done by hand, the widget appeared — and was white text on a white box, with a
button that said "Minimize" in both states. Model-valid, error-free, and wrong.

### An invented CSS variable, which nothing checks

```scss
background: var(--background-color-secondary, #fff);   // defined NOWHERE
```

Grepping the theme for that name returns exactly one hit: the line above. It was invented. The
fallback `#fff` therefore always won, the text inherited white, and the result was invisible.

The theme does define the right variables, and they flip with the light/dark toggle the app
already has:

```
--panel-bg            white (light)     / cool-gray-720 (dark)
--font-color-default  deep-blue (light) / white (dark)
```

**No validator in this pipeline looks at CSS.** `mxcli check` validates MDL. `ped_check_errors`
validates model documents. Neither reads `theme/web/*.scss`, so a stylesheet that references
variables which do not exist is not a warning anywhere — it is simply a widget nobody can see.
The only test is running the app.

So for any step that writes CSS: **grep the theme for every custom property you reference before
writing it**, and set `color` explicitly rather than inheriting. The cost is one `grep`; the
alternative is a bug that survives every automated gate in this document.

### The plan specified the button behaviour, and it was not built

> The caption or icon reflects the state: **two buttons with opposite visibility on
> `IsMinimized`**, or one button with an expression caption.

What was built was a single button with the static caption `'Minimize'`. The plan had not only
specified the behaviour but pre-selected the authorable shape — the two-button form exists in that
sentence precisely because the expression-caption form hits `MDL-WIDGET14`.

This is the **fourth** time in this run that a plan instruction was not carried out (§14 twice,
§16, here). Every one was a detail inside a step rather than a step of its own, and every one was
written down before the work started.

**That is the pattern worth naming.** A writing agent reliably executes the *structure* of a plan —
the numbered steps, the document names — and reliably drops the *qualifications* inside them: the
grant on step 6, the state-dependent caption on step 8, the exact string length. Those are where
the plan's judgement lives.

A plan for a writing agent should therefore put every qualification on its own numbered line with
its own `Check:`, rather than in prose inside a step. Prose inside a step is where instructions go
to be skimmed.

## 18. `mxcli --mcp` does not remove the open/close dance

`mxcli --mcp` routes MDL writes through a running Studio Pro instead of the `.mpr`. If it worked
across the board it would be the best of both: MDL's expressiveness, `mxcli check`'s dry run, and
`ped_check_errors` in one session with Studio Pro open — removing the single biggest friction in
this pipeline.

Tested with Studio Pro open, one construct per probe, using exactly what DAS-2 needed:

| Construct | via `--mcp` | DAS-2 needed it |
|---|---|---|
| Microflow `CREATE` | ✅ | yes |
| Non-persistent entity | ❌ *"non-persistent entities are not yet supported by the MCP backend (entity slice); create it against a local .mpr instead"* | yes |
| JSON structure | ❌ *"CreateJsonStructure: not supported by the MCP backend; run without --mcp"* | yes |
| Import mapping | ❌ *"CreateImportMapping: not supported by the MCP backend"* | yes |
| Snippet | ❌ *"CreateSnippet: not supported by the MCP backend"* | yes |
| Nanoflow | ❌ *"PED's create whitelist excludes Microflows$Nanoflow"* | yes |
| `GRANT EXECUTE` / allowed roles | ❌ *"UpdateAllowedRoles: not supported by the MCP backend"* | yes |
| `DROP` | ❌ *"delete_document requires the Concord MCP server — pass --mcp-concord"* | — |

**Of the eight things this one feature needed, `--mcp` could author exactly one.** Everything else
answers "run without `--mcp`".

So the architecture stands as measured in §11 and §15: **mxcli with Studio Pro closed for most
authoring, the MCP with it open for the flags, the validator and the layout.** The open/close
cycle is not an accident of how this run was done; it is forced by the tooling.

Two things worth keeping from the probes:

- **The error messages are exemplary** — every one names the limitation *and* the workaround, in
  the same sentence. That is the same standard as `MDL-WIDGET14` (§12) and it is why mxcli's own
  diagnostics beat any capability summary, including `mxcli mcp capabilities`.
- **Concord is real, not vapourware.** `DROP` fails with a specific instruction to pass
  `--mcp-concord`, so a second server exists that supplies delete, save, validate and run. It is
  not part of this setup and appears nowhere in public documentation, so it stays an unknown — but
  if it were connected it would close the "no save tool" gap from §1, which is one of the five
  human steps.

---

# Second run — a module removal, 2026-10-06

Notes from a second instrumented run, on a different and much smaller app: a story asking for the
Mendix starter module to be removed. Same versions (Mendix 11.12.4, mxcli v0.24.0), fourteen MDL
scripts, two legs that needed a person. It is a far less interesting change than §1–18 and it
produced four findings that change the advice above.

## 19. There is a third validator, and it sees what the other two cannot

§14 concluded that an error in a snippet is "unreachable from either tool: mxcli has no model
validator, and the MCP refuses the document type. Those errors are visible only to a person with
Studio Pro open."

**That is wrong, and it was wrong when it was written.** Mendix ships a command-line checker with
Studio Pro itself:

```
"C:\Program Files\Mendix\<version>\modeler\mx.exe" check <App>.mpr
```

It runs the same consistency check as the Studio Pro error list, over the **whole project**, with
no IDE open. Measured output on a project with one outstanding error:

```
Loading the mpr file.
The mpr file version is '11.12.4'.
Checking app for errors...
[error] [CE0129] "Administrator password has not been set." at Security
The app contains: 1 errors.
```

That error is at **Security** — a document class `ped_check_errors` cannot open at all. In the
same run, the MCP had just reported `No errors found` across **50 documents**: every page (16),
microflow (15) and nanoflow (13) in the app plus six domain models. Fifty clean documents and a
project that does not check. The MCP was not wrong; it was answering a narrower question than
anyone reading it would assume.

### What each validator actually covers

| | `mxcli check` | `ped_check_errors` (MCP) | `mx.exe check` |
|---|---|---|---|
| What it validates | MDL syntax and references | Studio Pro's model check, **per document** | Studio Pro's model check, **per project** |
| Pages, microflows, nanoflows, domain models | ❌ | ✅ | ✅ |
| Snippets | ❌ | ❌ `No API registered for unit type 'Pages$Snippet'` | ⬤ expected, not measured |
| Layouts, navigation | ❌ | ❌ no document type | ⬤ expected, not measured |
| Project security | ❌ | ❌ no document type | ✅ **measured** |
| Needs Studio Pro open | no | **yes** | no |
| Catches a bad script before it applies | ✅ (§12) | ❌ | ❌ |

They are three different checks, and the middle column is the one most likely to be mistaken for
the right-hand one.

### How to run it without breaking the run

- **Run it on a copy, or with Studio Pro closed.** It loads the `.mpr`, and the IDE holds a lock.
  Copying the project into `.mendix-cache/dash-scratch/mxcheck-copy` costs seconds and leaves the
  checkout untouched. (Expect at least one file in that copy to stay locked afterwards; it is
  git-ignored, so leaving it is harmless.)
- **The version must match the project.** Several Studio Pro versions sit side by side under
  `C:\Program Files\Mendix\`; `mx.exe` from the wrong one will refuse the `.mpr` version. Read the
  version from the project rather than guessing, and prefer the newest installed that is ≥ it.
- **It is not a replacement for the per-document check during a build.** `ped_check_errors` tells
  you which document broke, immediately after you wrote it. `mx.exe check` tells you the project
  is sound, once, at the end. Use the first as the per-step gate and the second as the final one.

### What this changes

§14's "invisible to the tooling entirely" group was overstated. The honest statement is: **errors
in project security are invisible to the two tools an agent writes with, and visible to a third one
it can also run.** The same is very likely true of snippets, layouts and navigation — this is Studio
Pro's own checker, and those classes are in the project it loads — but no run here has had a broken
one to prove it with, so treat that as expected rather than measured, and confirm it the first time
you do. Only the last category — something that
is valid but wrong, a CSS variable that does not exist (§17), a button that does nothing — is
genuinely out of reach of every validator and needs a person looking at the screen.

## 20. Deleting a module does not clean up the user roles that reference it

A module was deleted in Studio Pro (the only path — see §15 and the routing table in
`mendix-build`), the save completed, and `MyFirstModule` was gone from `show modules` and from
`list_modules`. The seven units disappeared and the `.mxunit` count moved as expected.

**Both project user roles still named `MyFirstModule.User`.** The project security unit had not
been touched since before the delete, and Studio Pro reported no error, because security was at
`Off` — nothing validates a dangling module role at that level.

The fix is a write the plan had not foreseen:

```
alter user role Administrator { remove module roles (MyFirstModule.User); };
alter user role User          { remove module roles (MyFirstModule.User); };
```

**Expect this on any module removal.** Check the user roles after the delete, not before, and check
them with `describe user role` — not with `refs` (§21). A `grep` for `<ModuleName>.` across
`mprcontents/` is the cheap belt-and-braces confirmation that nothing else still points at it.

## 21. `mxcli refs` does not index user-role membership either

`refs MyFirstModule.User` answered **"no references found"** while two project user roles held that
exact module role. This is the same shape of silence as snippet placement in `MODEL-READING.md`:
the answer is not "I could not find it", it is a confident nothing, and it is the kind of nothing a
report repeats as "safe to delete".

Verify role membership with `describe user role <Name>`, or by reading the project security unit.
Never from `refs`.

## 22. Two more things no tool can author on a layout

Both were hit while removing a widget from a copied layout, and both extend the layout findings in
`MODEL-READING.md`:

- **Nothing can rename a layout.** `mxcli rename` has no layout type. Re-probed over the MCP with
  Studio Pro open: `Pages$Layout` and `Forms$Layout` are unknown document types, `ped_list_folder`
  on the module does not list the layout at all, and `pg_read_page` answers `Page not found`. A
  layout copied in Studio Pro therefore keeps the name Studio Pro gave it (`<Name>_2`) until a
  person renames it — which is also the only way the references get updated.
- **`alter layout … drop widget <column>` cannot drop a layout-grid column.** It answers
  `Error: failed to drop: widget "col3" not found` and applies nothing. Only the widgets *inside*
  the column can be dropped, which leaves an empty AutoFill column behind. If that gap is visible
  in the rendered page, deleting the column is a person's job.

`alter layout … drop widget <id>` on an ordinary widget works, edits in place, and leaves the rest
of the layout byte-identical — which matters, because rewriting a layout drops the constructs mxcli
cannot author (`Forms$SidebarToggleButton` among them).

## 23. The working tree will show changes this run did not make

Two sources, both measured, both easy to misread as part of the change:

- **Studio Pro stages its own saves in the git index.** After a save, `git diff --cached` is not
  empty and nobody staged anything. Later mxcli writes land unstaged on top, so the `.mpr` and any
  unit touched by both shows as `MM`. A build that reports "nothing staged" without looking is
  wrong; a build that reports the staged content as its own work is worse.
- **Building or running the app regenerates action stubs.** One run left 48 modified files under
  `javascriptsource/` (datawidgets, nanoflowcommons, webactions) and `javasource/`, each with a new
  generated header comment and import list. None of it was part of the story.

Both belong in the build report as *changes in the working tree this run did not make*, named and
separated from the change set, so the person reviewing the diff knows what to ignore. Deleting a
module also removes `themesource/<module>/` and creates `themesource/<new module>/` — those **are**
part of the change.

---

## 24. `mxcli check` passed a script that made the project unloadable

The worst failure of the three runs, and the dry run said it was fine.

A `CHANGE` on a **loop variable** stores its attributes unqualified. mxcli does not resolve the
entity of a variable bound by `LOOP … IN`, so it writes the bare attribute name where the `.mpr`
format requires a full `AttributeIdentifier`. The written file is not a valid project:

```
ERROR: Mendix.Modeler.Storage.StorageLoadException: One or more invalid values were detected
while loading the project: Mendix.Modeler.Projects.Project:
 - Change in  has an invalid value '' for property Attribute.
   The text 'SortIndex' is not a valid AttributeIdentifier.
```

Four attributes, four identical errors. Not a validation error — a **load** error. Studio Pro
cannot open the project, mxcli cannot read it back, and `ped_check_errors` cannot run at all,
because there is nothing to run it against.

The MDL that did it, reduced to the smallest reproducing case:

```sql
RETRIEVE $Questions FROM $Response/<Module>.<Entity>_<Other>;
LOOP $Question IN $Questions BEGIN
  CHANGE $Question (SortIndex = 1);        -- unqualified: breaks the project
END LOOP;
```

```sql
CHANGE $Question (<Module>.<Entity>.SortIndex = 1);   -- qualified: loads fine
```

What makes this expensive:

- **`mxcli check` passed it**, reporting syntax OK and all references valid, on both the real
  script and a reduced probe. The dry run is the one gate that is supposed to catch a malformed
  write before it lands, and here it endorsed one.
- **The association member in the same `CHANGE` was fine.** `<Module>.<Entity>_<Other> = $Session`
  was already written qualified, so the statement looks half-correct in the source and gives no
  visual cue. Only the bare attribute names break.
- **Nothing downstream can tell you either**, because every reader needs to load the project first.
  The only thing that reported it was `mx.exe check` (§19) — which is the strongest argument for
  running it that these runs have produced.

**The rule this buys:** qualify every attribute in a `CHANGE` on a loop variable, always, even
though the unqualified form is accepted everywhere else. And when a script contains one, **apply it
to a scratch copy and check that copy before touching the project.** That costs one copy and one
`mx.exe check`; the alternative is a project that will not open and a bisect to find out why.

## 25. `FIND` cannot reference another variable

`FIND($List, SortIndex = $Index)` is refused with `MDL-LISTOP01`: the predicate may compare an
item's member against a literal, not against a variable from the surrounding flow. The documented
workaround in the error text is a lookup by key; where that does not fit, sort the list, take a
range and head it.

Worth knowing before planning a step around `FIND`, because the restriction is not obvious from
the syntax help and the rewrite changes the shape of the microflow.

## 26. Two MDL naming collisions

- **`Value` is a keyword.** An attribute named `Value` is refused; the run used `AnswerText`.
- **`type` arrives renamed.** Generating a JSON structure from a sample containing a `type`
  element produces an element called `_type`, renamed by mxcli itself, which then maps to a
  differently-named attribute. The mapping is correct and the names simply do not match the
  sample — expect it rather than treating it as a fault.

## 27. Studio Pro can be opened and closed from a script, and the lock file is how

The open/close dance (§18) is mechanics, not judgement, and it was the gate that interrupted the
developer most. All of it can be automated. Measured 2026-10-07 on 11.12.4.

**Opening** goes through the registered handler rather than `studiopro.exe`, because the Version
Selector picks the Studio Pro matching the project's own version — and several live side by side:

```
HKLM:\SOFTWARE\Classes\.mpr -> "Mendix Version Selector.mpr"
  shell\open\command = "...\Version Selector\VersionSelector.exe" "/file:%1"
```

`studiopro.exe` itself takes no useful switches — it is a 752 KB launcher, and neither it nor the
35 `Mendix.Modeler*.dll` files contain a command-line option table.

**Which process holds which project** is in `<App>.mpr.lock`, written next to the `.mpr`:

```json
{"SessionId":"57fd8ae1-71ec-4be9-854c-9b119de4db15","ProcessId":4680}
```

**This file is the only safe way to identify the instance.** Two Studio Pros open on two copies of
the same app show the **identical** window title — `App (Main line ('main'), Git)` — so anything
that picks a process by title, or by "the studiopro.exe that is running", will eventually close
someone's unsaved work. Check that the named PID is alive *and* is actually a `studiopro`, or PID
reuse will point you at an unrelated process.

The title is still worth one thing: a **veto**. It cannot tell two copies of the same app apart, but
it tells two *different* apps apart perfectly — so before closing, check that the holder's title
names the app you mean, and refuse if it names another one. That closes the gap the `studiopro`
name-check leaves open: a stale lock whose PID Windows has handed to a Studio Pro working on
something else. A veto only: an empty title, or the bare `Mendix Studio Pro`, means *still loading
or failed to load*, which is the project's own instance and does need closing.

**Closing gracefully** is `CloseMainWindow()` — the WM_CLOSE that clicking X sends. Measured: the
process exits in **1.5–2.1s** and Studio Pro removes its own lock file on the way out. Never
`Kill`/`taskkill`: that skips the shutdown work and leaves the lock behind naming a dead PID, which
is exactly the signature of a crash.

So the three states read cleanly:

| Lock file | PID alive and is studiopro | Means |
|---|---|---|
| absent | — | closed, and it shut down cleanly |
| present | yes | open, that PID holds it |
| present | no | **stale** — killed or crashed, shutdown work did not run |

### Two traps

- **The lock file is not a "project loaded" signal.** A project that failed to load (`This project
  has been incorrectly initialized for Git`) still produced a lock file, and left Studio Pro sitting
  on an empty window. Readiness is a main window whose title is something other than the bare
  `Mendix Studio Pro`. A cold start measured **16–18s** to that point.
- **A close that does not complete is a dialog**, almost always unsaved changes or a confirmation.
  Wait, then say so. Do not escalate to a kill: the whole reason to close gracefully is the shutdown
  work, and forcing it discards exactly that.

`tools/studiopro.ps1` in this toolkit implements the above — `status`, `open`, `close` against one
`.mpr` — and exits 0 on success, 2 when something is waiting for a person, 3 on a stale lock.

## Status of this run — complete

**The app runs without error and the widget works.** Nine model documents plus the stylesheet:

```
SampleApp.WeatherHelper                      entity        MCP
SampleApp.JSON_OpenMeteoCurrent              json struct   mxcli
SampleApp.IM_OpenMeteoCurrent                import map    mxcli
SampleApp.OpenMeteoCurrent                   entity        mxcli
SampleApp.WeatherHelper_FetchCurrent         microflow     mxcli
SampleApp.DS_WeatherHelper                   microflow     mxcli
SampleApp.ACT_WeatherHelper_ToggleMinimized  nanoflow      mxcli
SampleApp.Snippet_WeatherWidget              snippet       mxcli
theme/web/custom-sample_app.scss             stylesheet    file write
SomeUI_Module.AppFrame       layout        A PERSON
```

Model integrity held throughout: the `.mpr` Unit table and the `.mxunit` file count matched
exactly at every checkpoint, across five `exec` runs and four MCP writes.

**Nine errors surfaced in total, in two waves, and none were found by the tooling that produced
them:**

| Wave | Count | Cause | Found by |
|---|---|---|---|
| Studio Pro reopened | 7 | 3 skipped plan checks, 3 corrupted by the generating script, 1 schema mismatch | a person opening the IDE |
| App running | 2 | an invented CSS variable, a static button caption | a person looking at the screen |

Of the nine, **four were plan instructions that were written down and not carried out**, and every
one of those was a qualification inside a step rather than a step of its own (§17). That finding
is now a rule in `mendix-plan`.

The honest summary: the write paths are reliable and the verification discipline around them is
not. Every tool did what it was told. Nothing caught what it was told wrong.
