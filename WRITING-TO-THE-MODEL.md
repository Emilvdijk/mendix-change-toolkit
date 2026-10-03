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

## Status of this run

Step 2 of 11 complete (`SampleApp.WeatherHelper`), verified on disk, validator clean.

Steps 3–5 are the JSON structure, import mapping and Call REST. The MCP cannot author any of
them — *"OData/REST, mappings — no PED write path"* — so the next leg is mxcli, which requires
Studio Pro **closed**, and whose `CREATE REST CLIENT` stores mappings inline on the operation and
rejects a reference to a separate mapping document (`MDL-REST01`). The plan specifies separate
`JSON_*` and `IM_*` documents, which is Studio Pro's shape, not mxcli's. That reshaping is
unresolved and is the next thing to measure.
