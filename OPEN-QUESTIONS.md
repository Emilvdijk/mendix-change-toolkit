# Open questions — what this toolkit has NOT established

Every ⚠️ in these documents points here. One row per thing nobody has measured,
with what we know, what would settle it, and a status.

**The rule: test it, record the outcome in the run's report, then update the row
and strike the ⚠️ from the document it came from.** A row that goes green keeps
its date and its version, because that is what makes the next reader able to tell
whether it is still true.

This is not the same list as a "known wrong". Known-wrong is what we have measured
and found broken. This is what we have *asserted without measuring* — which is the
more dangerous of the two, because it does not look like a gap.

> **Why it exists.** Before this file, an unverified claim lived in one of two
> places: a sentence inside 100 KB of reference, or a "could not confirm" line in
> a single run's report. Both are write-only. Two claims about mxcli survived from
> v0.16 to v0.24 that way, and two more from v0.24 to v0.26 — found only because
> somebody happened to upgrade and ask. Nine open items accumulated across two
> days of runs in nine different places, none with an owner.

| # | Subject | Where it is asserted | What we know | What would settle it | Status |
|---|---|---|---|---|---|
| 1 | **Layout authoring on v0.26** | `WRITING-TO-THE-MODEL.md` §33, `mendix-build` Step 1 | `mxcli syntax layout` lists `ALTER LAYOUT` with the full `ALTER PAGE` operation set, `DESCRIBE LAYOUT` → re-executable `CREATE LAYOUT`, and `ALTER PAGES … SET LAYOUT … WHERE LAYOUT = …`. Read out of the binary, never exercised. | One build that edits a layout it owns with `ALTER LAYOUT`, then reads it back with `describe` and diffs. | ⬜ open — read from the tool, 2026-10-14 |
| 2 | **A layout-grid column** | §22, §33, `mendix-build` Step 1 | Refused on v0.24 as `alter layout … drop widget col3` → `widget "col3" not found`. The spelling is now `DROP col3` inside the braces and takes a list, so the old error is **not** evidence about the new statement. | `ALTER LAYOUT M.L { DROP col3; }` on a scratch layout. One command. | 🟡 expired, not reversed |
| 3 | **A layout rewrite still loses widgets** | §22 closing paragraph | v0.24: `create or replace` dropped constructs mxcli cannot author, `Forms$SidebarToggleButton` among them. v0.26's round-trip fixes are listed for **pages, navigation and microflows** — layouts are not named. mxcli's own help still says *"a rewrite is only as complete as its describe."* | `describe layout` → `exec` on a layout holding a sidebar toggle, then diff the unit. | ⬜ open |
| 4 | **Concord: does `--mcp-save` close the loop?** | §18, §33, and §1/§15 by implication | `--mcp-concord <url>` is documented in `mxcli --help`, with `--mcp-save`, `--mcp-check` and `--mcp-run`. The built-in server has no save tool, and that single gap is why §1's loop cannot close without a person. No Concord server is configured here. | Find or stand up a Concord server, then `exec … --mcp --mcp-concord --mcp-save` and check whether Studio Pro shows the document saved. | ⬜ open — the highest-value row in this file |
| 5 | **`CATALOG.ACTIVITIES` and loop bodies** | `README.md`, `tools/actions.js` | v0.24: a catalog sweep found 150 `DeleteObjectAction` where the BSON held 160; all 10 missing were in loop bodies, and one of them was the bug. v0.25 added `TotalActivityCount` to the catalog, "loop bodies included, at any depth" — so the catalog may now traverse them. The ACTIVITIES table itself is named in neither release note. | One `CATALOG.ACTIVITIES` sweep against a flow with a known in-loop activity. | 🟡 may be fixed |
| 6 | **`refs` / `impact` and snippet placement** | `README.md`, `MODEL-READING.md` §6, `tools/usages.js` | v0.24: a snippet placed on a layout answers `(no references found)` from both, measured on two snippets. v0.26 added a `widgets` catalog table recording the widget tree and `ParentWidgetId`, which did not change the answer. | `mxcli refs` on a snippet known to sit on a layout. | ✅ **closed 2026-10-20, NOT fixed.** Re-run on v0.26.0 against a snippet placed on a layout the app owns: `refs` and `impact` both answer `(no references found)`, while `usages.js` finds the `Forms$SnippetCall.Form` in about a second. `usages.js` stays the only mxcli-side answer. New: mxlint *does* export such a layout, so the mirror also carries the placement — but only for a layout outside a marketplace module. |
| 7 | **Two Studio Pro instances on one port** | `mendix-build` Step 0 | The MCP is one fixed address and names no project, so whichever instance holds the port answers every call. Ours was **reasoned from the fixed port**, not reproduced. Another team using the same toolchain reports it as a failure they have already had, with sessions lost to the wrong app. | Open two Studio Pros on different apps and call `list_modules`. | 🟡 reasoned here, reported as seen elsewhere |
| 8 | **`mxcli fix property-sets` on what we wrote** | §33 | Every v0.26 write emits Studio Pro's full property set for the project's Mendix version; documents written by older mxcli may be unmergeable in Studio Pro while `mx check`, the build and the runtime all stay green. This toolkit has build runs predating v0.26 on more than one app. | — | 🟡 **measured 2026-10-15, not yet repaired.** Two checkouts dry-run on v0.26.0: one needs **36 units, 199 keys added and 3 stripped**, the other 1 unit and 3 keys. The affected documents are the ones this toolkit's build runs authored. A third was open in Studio Pro and could not be read. Repair is `mxcli fix property-sets -p <app>.mpr` with Studio Pro closed; it is a model write and belongs to the app's owner, not to a toolkit run. |
| 9 | **Module writability through the MCP** | `mendix-plan`, `mendix-build` Step 1 | `list_modules` is the only way to ask which modules are writable. Two plan runs reported it unchecked — once because the tool was not in the allowlist, once because the process predated the commit that added it. Both are fixed; neither has been confirmed end to end. | One plan run whose report names the writable flag it read. | ⬜ open |
| 10 | **mxcli v0.26 on Studio Pro 11.15** | all of it | `MODEL-READING.md` was re-measured on **mxcli v0.26.0** on 2026-10-20 — still on 11.12.4, and the MCP column was not re-run. `WRITING-TO-THE-MODEL.md` is still v0.24-era except §33. Nothing anywhere has been measured on Studio Pro 11.15, whose changelog cites measurements across 11.12–11.15. | Any run on an 11.15 project; keep the first one small and say in the report which version it was. | ⬜ open |
| 11 | **The canvas conventions in `mendix-build` 3a** | `mendix-build` Step 3a | `@caption` on an `IF` and the per-branch `@anchor(true: (...), false: (...))` form both pass `mxcli check` against an 11.12.4 project, and both negative controls are refused as documented (`@captionn` MDL059, an unknown side MDL092). That establishes mxcli parses them. It does **not** establish that the result looks right: nothing has been applied and opened in Studio Pro, so "happy path right, everything else straight down" is an intended drawing, not a measured one. | One build that applies a decision with these annotations, then a screenshot or a sentence in the report from someone who opened the flow. | ⬜ open, dry-run verified 2026-10-17 |

## How to close a row

1. Test it in a real run, or in a scratch app if the test would write.
2. Put the outcome in that run's report — the measurement belongs with its evidence.
3. Update the row: status, date, mxcli and Studio Pro version.
4. Strike the ⚠️ from the document the row came from, and put the measurement
   there instead. A row going green and the document still hedging is worse than
   either alone.

## How to open one

Any time a run says it could not check something. "Writability was not checked",
"not measured on this version", "assumed" — each of those is a row. The cost of
opening one is a line; the cost of not opening one is rediscovering it two
releases later, which has now happened four times.
