---
name: mendix-oql
description: Write, create, modify, review, explain, or debug Mendix OQL (Object Query Language) queries for view entities, Retrieve-by-OQL actions, and datasource microflows. Use whenever an agent reads or writes a Mendix OQL query — especially when the user pastes a domain model export (mxlint YAML or any other format) and asks to build or change a query against it, or pastes a Studio Pro OQL error. Trigger on any mention of OQL, view entities, view-entity queries, "from ... inner join ... select", or Mendix query design. Covers how OQL differs from SQL, dialect limits (no DATEADD, DATEPART/timezone, subquery SELECT rules, scalar-subquery shape, GROUP BY vs aggregates, comment syntax, parameter and token limits, single-step ON-clause associations), association navigation and ownership/direction (including self-references), view-entity association auto-creation, the entity-access-rule bypass, and output conventions (alias every selected attribute, raw copy-paste text output).
---

# Mendix OQL

Reference for reading, building and editing Mendix OQL queries. Assume Mendix Studio Pro
**11.12.4** unless the user says otherwise. Version matters for function and syntax support: rules
below that are known to depend on the version say so. If a function or syntax is in doubt, confirm
it against current Mendix docs (see "Settling a dialect question") rather than assuming.

## Mental model: what OQL is, and how it differs from SQL

- OQL is SQL-shaped (`from`, `join`, `where`, `group by`, `select`, `union`), but it queries
  **entities and associations**, not tables and foreign keys. Mendix translates it to the
  database's SQL at runtime.
- Names are qualified: `Module.Entity`, `Module.Association`. Attributes are reached through an
  alias: `o.Total`.
- **Associations are paths, not join conditions.** `o/Sales.Order_Customer/Sales.Customer as c`
  joins an order to its customer; there is no `on o.CustomerId = c.Id`. `/` is navigation, which
  is why division is spelled `:`.
- `from` may come before `select` (the usual Mendix style) or `select` may come first; both parse.
- **A view entity is a saved OQL query.** Its attributes are the query's aliased columns, so the
  alias is the attribute name. Studio Pro derives the attributes from the query — you do not
  declare them separately.
- **OQL runs as the system** and bypasses entity access rules (see "Security").
- Enumeration values are compared as their **key** string, e.g. `o.Status = 'Approved'` — the key,
  not the caption, and spelled exactly as in the model (typos in keys are common; copy them).
- Studio Pro previews may run on HSQLDB; production is usually PostgreSQL. Functions differ (see
  "Testing").

## Workflow

1. Get the domain model. In order of preference:
   - **`mxcli describe entity <Module>.<Entity>`** — attributes with types and defaults, plus the
     full access rules including the XPath on each grant, in one call. This is the best read.
     `mxcli describe association <Module>.<Association>` gives direction, type and owner.
   - **Studio Pro MCP**, if open: `ped_read_document` with
     `documentType: "DomainModels$DomainModel"` and the module name alone as `documentName`.
   - **A pasted model** (mxlint YAML or any other format) — still fine, and still the only option
     when neither tool is available.
2. Study the model before writing anything: list the entities involved, their attributes
   (name + type), and every association with its **owner side** and **multiplicity**. Association
   ownership and direction decide how paths are written and are the most common source of wrong or
   empty results. This step does not get cheaper just because the model was read automatically.
3. When changing an existing view, read its current OQL in full first (`mxcli describe entity` on
   the view entity prints it), and check who consumes the view — export mappings, pages,
   microflows — because every column you rename or drop breaks them.
4. Create or modify the OQL query.
5. Deliver the query per the output rules below.

If the model doesn't contain an entity/attribute/association the query needs, say so and ask —
don't invent names.

`oql_generate` on the Studio Pro MCP generates OQL against a named module's real domain model, and
with `documentName` set it writes the result straight into a ViewEntitySourceDocument. Treat its
output as a draft to check against the rules in this skill, not as an answer — and never pass
`documentName` unless the user has asked for the document to be written.

**It is generative, and the write fires on whatever it produced.** Measured 2026-10-25: asked to
write back a finished ~12 KB query verbatim, it timed out after 30.7 s and left a 300-line
production view containing only its comment block. Use it to draft a query nobody has yet; never
to write back one you already have.

**To write OQL you already have, set the property directly** — verbatim, instant, and it accepts
queries mxcli's grammar cannot parse (an association-path join with `on`):

```
ped_update_document(
  documentName: "M.MyView",
  documentType: "DomainModels$ViewEntitySourceDocument",
  operations: [{ path: "/oql", operation: { type: "set", value: "<the OQL>" } }]
)
```

Keep `\r\n` line endings; that is what Studio Pro stores. One caveat, and it decides whether the
job finishes: the entity's **attribute list is a separate structure**. An edit that leaves the
select columns alone (joins, expressions, `where`, formatting — and anything confined to one
`UNION` branch, since every branch must expose the same columns) is done in that one call. An edit
that **removes** a column also needs its attribute removed. An edit that **adds** a column writes
fine and then cannot be synchronised by any tool — a hand-built attribute identical to a working
one still reads "View Entity is out of sync with the OQL Query". Say so and let a person click
Synchronize.

## Output rules (hard)

- **Never deliver OQL as a file.** Output the query as raw text in a single code block the user
  can copy straight into the Mendix OQL editor.
- **Comments: `--` line comments are accepted** (confirmed on 11.12.4), on their own line, e.g.
  `            -- explanation`. `/* */` block comments and comments trailing code on the same
  line are unconfirmed; do not use them. Older versions rejected all comments, so on a version
  before 11.12.4 leave comments out entirely. Add comments only when the user asks for them or the
  query being edited already has them; otherwise put explanation in the surrounding prose.
- **Alias every selected attribute, including ID fields.** e.g. `o.ID as OrderID`,
  `c.ID as CustomerID`. Never leave a selected attribute unaliased. In a view entity aliases are
  mandatory anyway — they become the attribute names.
- The domain model export (YAML/mxlint) is read-only context. Never propose edits to it. If a
  domain-model change is needed, describe it as Studio Pro actions.
- Coding questions get answered in English.

## Association navigation

- Path form: `alias/Module.Association/Module.TargetEntity as newAlias`.
- `/` is the path-navigation operator. It is **not** division (see operators).
- Direction follows ownership. Navigating from the owner side to the referenced entity is
  "forward"; navigating from the referenced entity back to the owner is "reverse". Both work, but
  you must know which side owns the reference.
  - Example: `Sales.Order_Customer` is owned by `Order`, so to go from a customer to their orders
    you reverse-navigate: `c/Sales.Order_Customer/Sales.Order as o`.
- **Self-references need special care.** A self-association stores the reference on one end.
  Example: `Org.Department_Department_Parent` is owned by the **child** department and points
  **up** to its parent.
  - `child/Org.Department_Department_Parent/Org.Department` → the child's **parent** (works).
  - Trying to get a department's children by reverse-navigating
    `parent/Org.Department_Department_Parent/Org.Department` walks to the parent's *own* parent
    instead, and for a top-level department that is empty, so the inner join produces **zero rows
    and the whole subquery silently returns nothing**.
  - Correct idiom to fetch children: enumerate the entity and constrain the child's parent
    reference to the target:
    `inner join Org.Department as child on child/Org.Department_Department_Parent = parent.ID`.
- **A single-step association reference can be compared to an ID** in ON/WHERE:
  `on child/Module.Assoc = $ParentId` or `where child/Module.Assoc = parent.ID`.
- **Multi-step association paths are not allowed inside an ON clause.** The planner cannot
  introduce joins inside a join condition. Pre-resolve to a single-step association or to an ID
  (retrieve/join the intermediate entity first), then join on that. Multi-step paths in
  FROM/SELECT/WHERE are fine.
- **Two associations between the same pair of entities** (e.g. one "primary" department and a
  reference set of "secondary" departments) are a requirements question, not a syntax one: they
  give different totals, and only one of them may reconcile to the totals elsewhere in the app.
  Ask which one the requirement means.

## View entities

- **Selecting a joined object's ID creates the view-entity association automatically.**
  `c.ID as OrderView_Customer` creates an association `OrderView_Customer` from the view entity to
  `Customer`; the alias becomes the association name. Never tell the user to create these
  associations by hand.
- `order by` is not allowed in a view entity without `limit` or `offset`. Sort in the consumer
  (retrieve, data grid, stylesheet) instead.
- Adding a column to a view changes nothing downstream by itself: export mappings, message
  definitions and pages that should show it must be updated separately. Dropping or renaming a
  column breaks every consumer that still uses it.
- A view has no stored data, so changing its query needs no data migration.

## Dialect limits and features (verified on 11.12.4)

Not available / gotchas:

- **No `DATEADD`.** It only arrived later (≈11.9) and only for Java actions, not view/query OQL.
  Work around date math with weekday-ordinal comparison and range clamping (see patterns), not by
  computing "Monday's date, Tuesday's date…".
- **Every subquery needs its own `select`** — including inside `not exists ( ... )` and
  `exists ( ... )`. Omitting it errors with roughly "You could use here: SELECT". Either position
  parses: `exists (select 1 as Result from ... where ...)` and
  `exists (from ... where ... select x.ID as XID)` both work. For an existence check the selected
  column is never read, so any aliased constant or ID is enough.
- **A subquery used as a SELECT column must be exactly one column that is a bare aggregate, or use
  `limit 1`.** Wrapping the aggregate is rejected:
  `(select coalesce(sum(x.Amount), 0) from ...)` errors with "The SELECT clause of a subquery
  should consist of exactly one column with either an aggregate function or a LIMIT 1 clause."
  Write `(select sum(x.Amount) from ... where ...) as Total` and handle the NULL downstream (no
  matching rows → NULL, not 0). Such a scalar subquery must return one row and one column at
  runtime, or it throws.
- **A grouped column cannot also be used inside an aggregate**, not even inside
  `max(case when ... end)`. The error is "Column 'X/Date' cannot both be aggregated and appear in
  the GROUP BY clause". Move the per-row condition into the `left outer join ... on` clause, so the
  aggregates no longer reference the grouped column.
- `order by` in a subquery requires `limit` or `offset` (OQL v2).
- **Query parameters (`$Name`) are often not accepted** in view-entity OQL and in some
  Retrieve-by-OQL surfaces. If `$Param` errors:
  - Where dataset parameters are supported, declare them there.
  - Otherwise build the query string in a microflow and string-inject the value. Injecting a
    system-generated Mendix ID (`toString($Obj/ID)`) is safe from injection; never inject raw user
    input.
- **Date tokens vary by surface.** `[%BeginOfCurrentDayUTC%]` / `[%CurrentDateTime%]` work inline
  in some contexts; in others the same value must be passed as a parameter (`$BeginOfCurrentDay`).
  If an inline token errors, switch to a parameter.

Available / confirmed working:

- `WHERE`, and correlated `EXISTS` / `NOT EXISTS` subqueries, also inside a join's `on` clause
  (`inner join ... as d on not exists (select 1 as Result from ... where e.ID = d.ID)`). These are
  the tool of choice for role/status filtering, exact-match set logic, dedup, and "pick one"
  logic — prefer them over multi-branch `UNION` when a conditional join/subquery is cleaner.
- Correlated scalar subqueries as SELECT columns, within the shape rule above. They are the safe
  way to pull a per-row aggregate of a one-to-many child without duplicating the parent row — a
  plain `left outer join` to the child multiplies parent rows and inflates every sum.
- `UNION`.
- `DATEPART(part, datetime, timezone)`:
  - `DATEPART(WEEKDAY, d, 'UTC')` returns **1–7 with 1 = Sunday, 7 = Saturday** (so Monday = 2 …
    Friday = 6).
  - Always pass `'UTC'` explicitly when the stored dates are non-localized (`LocalizeDate: false`,
    i.e. UTC midnight). Omitting the timezone makes DATEPART use the user/session timezone and can
    shift the weekday by a day, producing "random" wrong results at day boundaries.
  - `DATEPART(YEAR, ...)` and `DATEPART(DAYOFYEAR, ...)` are useful for same-day matching across
    two datetimes.
- Aggregates: `sum`, `max`, `min`, `avg`, `count(1)`, `count(distinct x)`. `max`/`min` work on
  every type, strings included (alphabetical); NULLs are ignored.
- `coalesce(a, b, ...)` on plain expressions and columns (not around an aggregate inside a scalar
  subquery — see above). With mixed numeric types the result follows DECIMAL > LONG > INTEGER.
- `CASE WHEN ... THEN ... ELSE ... END`, including nested CASE.
- Typed/constant selects: `cast(0 as decimal)`, `0 as RowCount`, `1 as Members`,
  `0.00 as DeltaHours`, `'Fixed text' as Label`.
- `IS NULL` / `IS NOT NULL` for empty checks.
- `in (...)` lists, e.g. `o.Status in ('Approved', 'Archived')`.

Operators:

- **Division is `:`** — e.g. `t.Hours : coalesce(t.Members, 1)`. Do not use `/` for division;
  `/` is reserved for association-path navigation.
- `%` modulo works (e.g. `w."Week" % 2 = 1` for odd/even week parity).
- Reserved-word attribute names must be quoted: `w."Year"`, `w."Week"`.

Grouping:

- Every non-aggregated selected column must appear in `group by`.
- And, per the gotcha above, a `group by` column must not also appear inside an aggregate.

## Settling a dialect question against Mendix's documentation

The dialect rules above are the expensive kind of knowledge: wrong in a way that looks right, and
drifting with every release. Check a load-bearing claim rather than recalling it.

- **Studio Pro MCP**, when Studio Pro is open, exposes Mendix's own documentation and release notes:

      search_mendix_knowledge_base { query: "OQL DATEADD date functions supported view entity Studio Pro 11" }

- **Without Studio Pro**, the public reference pages answer most syntax questions:
  `docs.mendix.com/refguide/oql-clauses/`, `.../oql-expressions/`, `.../oql-expression-syntax/`.

Three properties of the MCP search, measured:

- **It returns community forum posts alongside official pages, in the same shape.** An entry
  beginning `Question:` is one person's opinion. Prefer a `docs.mendix.com` URL, and never present
  a forum answer as the platform's position.
- **A null result proves nothing.** Specific behavioural questions come back empty — and the docs
  pages are silent on many combinations too (for example, whether a function may wrap an aggregate
  in a subquery). If the sources are silent, say the point is undocumented and that Studio Pro's
  own error list is the final check.
- **It needs Studio Pro open**, since Studio Pro serves it. Without it, fall back to the rules above
  and the docs pages, and say which you relied on.

## Security / access rules

OQL **bypasses entity access (XPath security) rules by default** — it runs as the system, so it
can return rows the current user isn't allowed to read. XPath retrieves and
`Core.retrieveXPathQuery` apply access rules; raw OQL and `Core.createOQLTextGetRequest` do not. To
enforce security in OQL, replicate the access-rule constraints as explicit `WHERE` / `EXISTS` /
`NOT EXISTS` conditions (e.g. role-based `EXISTS` subqueries mirroring `[Assoc = $currentUser]`),
or switch to an XPath retrieve with "Apply entity access" enabled if user-scoping is the point.

## Patterns

- **Deduplicate before joining.** If a source can have duplicate rows per key (e.g. multiple
  holiday records on one date), collapse them first in a derived table
  (`from Cal.Holiday as h group by h.Date select h.Date as HolidayDate`) before joining, or
  aggregation over-counts.
- **Per-row child totals without row multiplication.** To show a sum over a one-to-many child next
  to each parent row, use a correlated scalar subquery per value
  (`(select sum(i.Amount) from Sales.OrderLine as i inner join i/Sales.OrderLine_Order/Sales.Order as io where io.ID = o.ID) as LineTotal`),
  not a join plus `group by` on every parent column.
- **Group-level flag, applied outside the inner CASE.** To zero out a value when a related
  condition holds (e.g. "person is absent"), compute `max(case when ... then 1 else 0 end)` at the
  group level and multiply the hours aggregate by `(1 - max(flag))`. Putting the flag inside the
  per-row CASE corrupts results when an entity has multiple related rows (the join
  cross-multiplies).
- **Unified reduction to avoid double subtraction.** When two independent reasons can make the
  same day unavailable (public holiday + absence), left-outer-join both into one availability chain
  and use `max(...)` weekday flags for a single "unavailable for any reason" signal, rather than
  subtracting two separate reductions.
- **Weekday clamping (no DATEADD).** To test whether a date range covers a given weekday within a
  week, compare ISO-ordered weekday numbers against start/end boundaries clamped to the week (using
  DATEPART weekday numbers and the week's StartDate/EndDate), instead of generating each day's date.
- **Correlated NOT EXISTS for "pick one" / exact match / dedup.** e.g. choose a single
  deterministic representative row: keep row X only when no sibling with a smaller ordering key
  exists —
  `where not exists (from ... where sibling.Parent = X.Parent and sibling.Name < X.Name select sibling.ID as SibID)`.
- **ISO week-year vs calendar year.** Watch the `YYYY` (ISO week-year) vs `yyyy` (calendar year)
  distinction when joining week/date data; mismatches silently yield zero rows.
- **Reference-set navigation.** A checkbox/multi-select is usually a reference set owned by a
  helper entity (e.g. `Report.Selection_Department`). The whole current selection is reachable in
  one hop: `s/Report.Selection_Department/Org.Department`. That means a view driven by such a
  helper can *see its own selection* and reason across it — it does not need to know a "live"
  runtime selection separately. Reverse-navigate a set the same way as a single reference (from the
  child entity back to the owner), e.g. people linked to the selected departments:
  `dep/Hr.Person_Department/Hr.Person`.
- **Selection-scoped dedup via the reference set + max-over-fan-out.** When a per-member metric
  must be counted once across the whole selection (e.g. a person linked to two selected departments
  must not be double-counted), do NOT compute it per department and then `sum` across departments —
  that double-counts shared members. Instead: (1) in an inner derived table, produce the DISTINCT
  members of the selection (`group by s.ID, member.ID`) *before* joining anything expensive;
  (2) join the per-member data once and aggregate keyed on the helper (`s.ID`), not the department;
  (3) because the outer query still fans out per department for genuinely per-department metrics,
  use `max(coalesce(dedupMetric, 0))` in the outer select for the selection-level value (it is
  constant across the department rows of a group, so `max` picks it once) while keeping `sum(...)`
  for the per-department metrics. This only holds while the view groups per selection(+period), not
  per department — a per-department breakdown of a shared quantity is inherently ambiguous.

## Performance

- **Never leave a calendar/week table cross-joined `on true` unconstrained.** It joins every row
  against every week in the table (all years) and carries the waste through the whole subquery
  before the outer join discards it. Constrain to the relevant year — carry the year out of the
  inner derived table and join `on w."Year" = <carriedYear>` instead of `on true`. This is usually
  the single biggest win.
- **Merge subqueries that walk the same association path.** If several metrics traverse an
  identical graph (e.g. `Department → Project → Task → Booking → Week`) and differ only by a status
  filter, collapse them into one pass with conditional sums:
  `sum(case when b.Status = 'Planned' then b.Hours else 0 end) as PlannedHours,
  sum(case when b.Status in (...) then b.Hours else 0 end) as DoneHours`.
  Keep a metric separate only when it keys off a different field (e.g. one uses a planned date,
  another an actual date).
- **Push the selection down into each subquery.** Don't aggregate every entity in the system and
  then discard the unselected ones at the outer join. Join the helper's reference set inside the
  subquery (`... inner join s/Report.Selection_Department/Org.Department as sel on sel.ID = d.ID`)
  so aggregation only touches selected rows. Big win when the selection is a handful out of many.
- **Index the filter/range attributes.** Add Studio Pro indexes on the attributes doing filtering
  and range work — status enums, the dates used in `StartDate <= x and EndDate >= x` range joins,
  week-table year/start/end, absence date bounds, holiday date. Range joins reward indexes most.
- **Precompute if the live math stays expensive.** Slow, infrequently-changing aggregates
  recomputed on every page load are the durable candidates for a scheduled/triggered helper
  entity, which turns the heaviest subqueries into a plain indexed join.

## Testing

- Validate against the **production database engine** (usually PostgreSQL) with realistic data,
  not the HSQLDB preview. `DATEPART` and some functions behave differently between the two, so a
  query that looks right in preview can still be wrong on production.
- Studio Pro's error list is the final syntax check; a query this skill considers valid can still
  be rejected there. When it is, quote the exact error back and fix against it.
- For a changed view, compare row counts before and after on the same data. A changed count from
  a change that should only add columns means a join is multiplying or dropping rows.
