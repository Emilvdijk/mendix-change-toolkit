# Writing to a Mendix model from an agent — what actually happens

Field notes from the first instrumented write run: DAS-2 (a weather widget) against a scratch
app, Mendix 11.12.4, Studio Pro MCP server on `localhost:7782`, mxcli v0.24.0, 2026-10-02/03.

Everything here was measured during the run. Where a published capability list disagrees with
what the server did, the server wins and the disagreement is recorded.

**Status: incomplete.** One entity was written. The run stopped at a human-required step, which is
itself the most important finding.

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

## Status of this run

Steps 2-9 complete and verified on disk. Model integrity held across four exec runs:
Unit table 1386 rows, 1386 .mxunit files on disk, exact.

Step 10 -- one snippet call into Siemens_UI_Module.iX_Application_Frame -- is the last model
change, and it can ONLY go through the MCP: mxcli would silently drop two sidebar toggle widgets
it cannot author, on the layout all 33 pages use. So Studio Pro has to be reopened for it, which
is the third human step in this pipeline after Update security and save.

Step 11 is running the app, which no tool here does.
