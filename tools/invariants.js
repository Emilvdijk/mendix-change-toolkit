#!/usr/bin/env node
/*
 * invariants.js - mechanical defect checks over a Mendix model export.
 *
 * These exist because reading does not scale with range size but checking does.
 * Every check here was derived from a real defect that a manual review missed or
 * would plausibly miss; each one names the defect class it came from.
 *
 * Output is CANDIDATES, not findings. Several checks are deliberately heuristic
 * (pair-skew especially). The reviewer must open the document and confirm before
 * reporting anything to a human.
 *
 *   node invariants.js --new <dir> [--old <dir>] [--changed <file>] [--json]
 *
 *   --new      tree of the model export at the head of the range (required)
 *   --old      tree at the base of the range; enables delta checks
 *   --changed  newline-delimited list of changed document paths; scopes the
 *              per-document checks. Omit to check every document in --new.
 *   --json     machine-readable output
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const NEW = opt('--new');
const OLD = opt('--old');
const CHANGED = opt('--changed');
const JSON_OUT = argv.includes('--json');

if (!NEW) {
  console.error('usage: node invariants.js --new <dir> [--old <dir>] [--changed <file>] [--json]');
  process.exit(2);
}

const findings = [];
const add = (check, severity, file, message, evidence) =>
  findings.push({ check, severity, file, message, evidence: evidence || [] });

// ---------------------------------------------------------------- fs helpers

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.yaml')) out.push(p);
  }
  return out;
}

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

const allNew = walk(NEW);
let scope = allNew;
if (CHANGED) {
  const want = new Set(
    read(CHANGED).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.endsWith('.yaml') ? s : s + '.yaml'))
  );
  scope = allNew.filter((p) => want.has(rel(NEW, p)));
}

const isFlow = (p) => /\$(Microflow|Nanoflow)\.yaml$/.test(p);

// ================================================================
// Per-document checks
// ================================================================

/* enum-guard-mismatch
 * Defect class: ACT_BackgroundTask_SyncAllProjects wrote
 * BackgroundTaskType = CustomerSync while both of its own guards filtered on
 * ProjectSync, so the dedupe never matched and the task was dispatched to the
 * wrong handler. A document that writes one value of an attribute and tests a
 * disjoint set of values of that same attribute is almost always a copy-paste
 * slip. */
function enumGuardMismatch(file, text) {
  const lines = text.split(/\r?\n/);
  const writes = new Map();   // "Entity.Attr" -> Set(value)
  const guards = new Map();   // "Entity.Attr" -> Set(value)
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

  // Writes carry their entity: "Attribute: Module.Entity.Attr".
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i].match(/^\s*Attribute:\s*[\w.]*?(\w+)\.(\w+)\s*$/);
    if (!a) continue;
    const v = (lines[i + 1] || '').match(/^\s*Value:\s*[\w.]*ENUM[\w.]*\.(\w+)\s*$/);
    if (v) push(writes, `${a[1]}.${a[2]}`, v[1]);
  }

  // Guards come only from XPath constraints, which can be tied to an entity:
  // the retrieve's own Entity, or an entity stepped into inside the path. An
  // expression guard ($Var/Attr = ...) cannot be qualified without variable
  // typing, and including it conflated every entity that has a "Status".
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i].match(/^\s*Entity:\s*[\w.]*?(\w+)\s*$/);
    if (!e) continue;
    let xpath = '';
    for (let j = i; j < Math.min(lines.length, i + 40); j++) {
      if (!/^\s*XpathConstraint:/.test(lines[j])) continue;
      const indent = (lines[j].match(/^(\s*)/) || ['', ''])[1].length;
      for (let k = j + 1; k < lines.length; k++) {
        const ind = (lines[k].match(/^(\s*)/) || ['', ''])[1].length;
        if (lines[k].trim() && ind <= indent) break;
        xpath += lines[k] + '\n';
      }
      break;
    }
    if (!xpath) continue;
    // Walk the path, tracking which entity the following constraints apply to.
    let entity = e[1];
    const tok = xpath.match(/\/[\w.]+\.(\w+)\s*\[|\[\s*\w+\s*=\s*'[^']+'\s*\]/g) || [];
    for (const t of tok) {
      const step = t.match(/\/[\w.]+\.(\w+)\s*\[$/);
      if (step) { entity = step[1]; continue; }
      const c = t.match(/\[\s*(\w+)\s*=\s*'([^']+)'\s*\]/);
      if (c) push(guards, `${entity}.${c[1]}`, c[2]);
    }
  }

  for (const [key, w] of writes) {
    const g = guards.get(key);
    if (!g || !g.size) continue;
    if ([...w].some((x) => g.has(x))) continue;
    add('enum-guard-mismatch', 'HIGH', file,
      `writes ${key} = {${[...w].join(', ')}} but only ever guards on {${[...g].join(', ')}}`,
      [`written: ${[...w].join(', ')}`, `guarded: ${[...g].join(', ')}`]);
  }
}

/* pair-skew  (heuristic - expect false positives, confirm by reading)
 * Defect class: the same bug seen from the other side. Paired flows
 * (Relation/Project, Customer/Object, POST/PUT) get copied and one token is
 * left behind. If a document's vocabulary is dominated by one domain family and
 * a small number of value lines reference a rival family, those lines are worth
 * a look. */
// No trailing \b: Mendix identifiers are compounds (CustomerSync, ProjectSync,
// BackgroundTask_Relation) and a trailing boundary would never match them.
// "Object" is deliberately absent: it is ServiceTab's word for a project but it
// also appears in Mendix built-ins (ObjectKey, ObjectMappingElement) often
// enough to drown the signal.
const FAMILIES = {
  relation: /(Relation|Customer|Client)/,
  project: /(Project)/,
  employee: /(Employee|Personel|Personnel)/,
};
function pairSkew(file, text) {
  const lines = text.split(/\r?\n/);
  const sem = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*(Value|Expression|Attribute|Association|Entity|Microflow|XpathConstraint):/.test(l)) continue;
    // an association explicitly cleared to empty carries no intent - skip it
    if (/^\s*Association:/.test(l)) {
      const near = (lines[i + 1] || '') + (lines[i + 2] || '');
      if (/Value:\s*empty/.test(near)) continue;
    }
    sem.push({ n: i + 1, t: l.trim() });
  }
  const hits = {};
  for (const fam of Object.keys(FAMILIES)) hits[fam] = sem.filter((s) => FAMILIES[fam].test(s.t));
  const total = Object.values(hits).reduce((a, b) => a + b.length, 0);
  if (total < 5) return;
  const ranked = Object.entries(hits).sort((a, b) => b[1].length - a[1].length);
  const [domFam, domHits] = ranked[0];
  if (domHits.length / total < 0.6) return;           // no clear owner
  for (const [fam, fhits] of ranked.slice(1)) {
    if (!fhits.length || fhits.length > 2) continue;   // absent, or a real second actor
    add('pair-skew', 'MEDIUM', file,
      `document is dominated by "${domFam}" (${domHits.length} lines) but ${fhits.length} line(s) reference "${fam}"`,
      fhits.map((h) => `L${h.n}: ${h.t}`));
  }
}

/* retrieve-nondeterministic
 * Defect class: SUB_Employee_SynchWithServiceTab retrieved a single WorkPermit
 * document with no sort order, so an employee holding a renewal got an
 * arbitrary one of the two. */
function retrieveNondeterministic(file, text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*SingleObject:\s*true\s*$/.test(lines[i])) continue;
    let sorted = true, varName = '(unnamed)', xpath = '';
    for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
      if (/^\s*Sortings:\s*\[\]\s*$/.test(lines[j])) sorted = false;
      const v = lines[j].match(/^\s*ResultVariableName:\s*(\S+)/);
      if (v && varName === '(unnamed)') varName = v[1];
      if (/\$Type:\s*Microflows\$RetrieveAction/.test(lines[j])) break;
    }
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const x = lines[j].match(/^\s*\[(.+)\]\s*$/);
      if (x) { xpath = x[1]; break; }
    }
    if (sorted) continue;
    add('retrieve-nondeterministic', 'MEDIUM', file,
      `single-object retrieve "${varName}" has no sort order; arbitrary row if more than one matches`,
      xpath ? [`constraint: [${xpath}]`] : []);
  }
}

/* unused-result
 * Defect class: ASU_Main captures the boolean returned by
 * ASU_Relation_SetExternalId and never tests it. Also catches a list operation
 * or aggregate whose result is computed and thrown away. */
function unusedResult(file, text) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:ResultVariableName|AggregateVariableName):\s*(\w+)\s*$/);
    if (!m) continue;
    const name = m[1];
    if (!name || name === 'true' || name === 'false') continue;
    // Read as an expression variable...
    if (new RegExp('\\$' + name + '\\b').test(text)) continue;
    // ...or consumed by name: a loop source, a commit, a list operation, a
    // REST body. Those never use the $ form.
    const byName = new RegExp(
      '^\\s*(?!ResultVariableName|AggregateVariableName)\\w*(?:VariableName|ListName):\\s*' + name + '\\s*$', 'm');
    if (byName.test(text)) continue;
    if (seen.has(name)) continue;          // one report per variable, not per assignment
    seen.add(name);
    add('unused-result', 'LOW', file,
      `result variable $${name} is assigned but never read in this document`, [`L${i + 1}: ${lines[i].trim()}`]);
  }
}

/* guard-already-enforced
 * Defect class: ACT_BackgroundTask_SyncAllRelations retrieved its source list
 * with [not(Assoc/Entity[X][Y])], then inside the loop retrieved that same
 * Entity[X][Y] again and skipped rows where a Find over Assoc hit. The XPath had
 * already excluded every such row, so the skip branch was unreachable and the
 * extra retrieve was pure cost.
 *
 * Narrow by design: it keys on the exact shape (a not() clause naming the same
 * association and the same constraints a second retrieve uses), which keeps the
 * false-positive rate near zero. */
function guardAlreadyEnforced(file, text) {
  const lines = text.split(/\r?\n/);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  // retrieves: ResultVariableName -> its XPath constraint text
  const retrieves = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*ResultVariableName:\s*(\w+)\s*$/);
    if (!m) continue;
    let xpath = '';
    for (let j = i; j < Math.min(lines.length, i + 40); j++) {
      if (!/^\s*XpathConstraint:/.test(lines[j])) continue;
      const indent = (lines[j].match(/^(\s*)/) || ['', ''])[1].length;
      for (let k = j + 1; k < lines.length; k++) {
        const ind = (lines[k].match(/^(\s*)/) || ['', ''])[1].length;
        if (lines[k].trim() && ind <= indent) break;
        xpath += lines[k] + '\n';
      }
      break;
    }
    if (xpath) retrieves.set(m[1], xpath);
  }

  // Find operations: which list, matched on which association
  for (let i = 0; i < lines.length; i++) {
    if (!/\$Type:\s*Microflows\$Find\s*$/.test(lines[i])) continue;
    let assoc = '', listName = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const a = lines[j].match(/^\s*Association:\s*(\S+)\s*$/); if (a) assoc = a[1];
      const l = lines[j].match(/^\s*ListName:\s*(\w+)\s*$/); if (l) listName = l[1];
    }
    if (!assoc || !listName) continue;
    const targetXpath = retrieves.get(listName);
    if (!targetXpath) continue;

    const constraints = [...targetXpath.matchAll(/\[\s*\w+\s*=\s*'[^']+'\s*\]/g)].map((m) => norm(m[0]));
    if (!constraints.length) continue;

    for (const [srcName, srcXpath] of retrieves) {
      if (srcName === listName) continue;
      const flat = norm(srcXpath);
      if (!flat.includes('not(')) continue;
      if (!flat.includes(assoc)) continue;
      if (!constraints.every((c) => flat.includes(c))) continue;
      add('guard-already-enforced', 'MEDIUM', file,
        `the Find over $${listName} can never hit: the retrieve of $${srcName} already excludes those rows via not(${assoc}...) with the same constraints, so the skip branch is dead and the extra retrieve is wasted`,
        [`source retrieve: $${srcName}`, `re-checked list: $${listName}`,
          `association: ${assoc}`, `constraints: ${constraints.join(' ')}`]);
      break;
    }
  }
}

/* date-format-guard-inconsistent
 * Defect class: SUB_Employee_SynchWithServiceTab guards the employee birthday
 * with "if ... != empty then formatDateTimeUTC(...)" but formats the document
 * ExpiryDate with no guard at all, in the same flow.
 *
 * Reported only when a document does both, so this is an internal-consistency
 * check rather than a claim about how Mendix handles an empty date - which
 * keeps it honest and quiet. */
function dateFormatGuardInconsistent(file, text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/formatDateTime/.test(lines[i])) continue;
    let start = i;
    while (start > 0 && !/^\s*(Value|Expression):/.test(lines[start])) start--;
    const indent = (lines[start].match(/^(\s*)/) || ['', ''])[1].length;
    let body = lines[start];
    let end = start;
    for (let k = start + 1; k < lines.length; k++) {
      const ind = (lines[k].match(/^(\s*)/) || ['', ''])[1].length;
      if (lines[k].trim() && ind <= indent) break;
      body += '\n' + lines[k];
      end = k;
    }
    if (!blocks.some((b) => b.start === start)) blocks.push({ start, body });
    i = Math.max(i, end);      // continue after this block, never before it
  }
  if (blocks.length < 2) return;
  const guarded = blocks.filter((b) => /!=\s*empty|=\s*empty/.test(b.body));
  const bare = blocks.filter((b) => !/!=\s*empty|=\s*empty/.test(b.body));
  if (!guarded.length || !bare.length) return;
  for (const b of bare) {
    const arg = (b.body.match(/formatDateTime\w*\(\s*(\$[\w/]+)/) || [])[1] || '(expression)';
    add('date-format-guard-inconsistent', 'MEDIUM', file,
      `${arg} is formatted with no empty guard, while ${guarded.length} other date mapping(s) in this same document do guard`,
      [`L${b.start + 1}: ${b.body.split('\n')[1] ? b.body.split('\n')[1].trim() : b.body.trim()}`]);
  }
}

/* cleared-association-consumed
 * Defect class: ACT_BackgroundTask_SyncAllProjects created a task with
 * BackgroundTask_Relation explicitly set to empty and BackgroundTaskType set to
 * CustomerSync. The dispatcher routes CustomerSync to
 * SUB_Relation_SyncWithServiceTab, whose first act is to retrieve over
 * BackgroundTask_Relation - the association the creator just cleared. Project
 * sync therefore never ran.
 *
 * Needs three documents to see it, which is exactly why a per-document read
 * misses it. The dispatch table comes from the rendered pseudocode block.
 */
function buildFlowIndex(files) {
  const byQualified = new Map();   // "Module.Name" -> file path
  const consumes = new Map();      // file path -> Set(associationId)
  const dispatchers = [];          // { file, attr, cases: Map(value -> "Module.Microflow") }

  for (const p of files) {
    if (!isFlow(p)) continue;
    const text = read(p);
    const nm = text.match(/^Name:\s*(.+)$/m);
    const module = rel(NEW, p).split('/')[0];
    if (nm) byQualified.set(`${module}.${nm[1].trim()}`, p);

    const assoc = new Set();
    for (const m of text.matchAll(/^\s*AssociationId:\s*(\S+)\s*$/gm)) assoc.add(m[1]);
    consumes.set(p, assoc);

    // dispatch table, from the pseudocode block
    const pi = text.indexOf('\npseudocode:');
    if (pi < 0) continue;
    const pseudo = text.slice(pi);
    const head = pseudo.match(/IF\s+\$\w+\/(\w+)\s+THEN/);
    if (!head) continue;
    const cases = new Map();
    for (const m of pseudo.matchAll(/GOTO\s+(L\d+)\s*\/\/\s*case:\s*(\w+)/g)) cases.set(m[2], m[1]);
    if (!cases.size) continue;
    const resolved = new Map();
    for (const [value, label] of cases) {
      const at = pseudo.indexOf(`LABEL ${label}`);
      if (at < 0) continue;
      const call = pseudo.slice(at, at + 600).match(/call\s+([\w]+\.[\w]+)\s*\(/);
      if (call) resolved.set(value, call[1]);
    }
    if (resolved.size) dispatchers.push({ file: p, attr: head[1], cases: resolved });
  }
  return { byQualified, consumes, dispatchers };
}

function clearedAssociationConsumed(scopeFiles, index) {
  for (const p of scopeFiles) {
    if (!isFlow(p)) continue;
    const lines = read(p).split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (!/\$Type:\s*Microflows\$CreateChangeAction\s*$/.test(lines[i])) continue;
      const indent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
      let block = '';
      for (let k = i; k < lines.length; k++) {
        const ind = (lines[k].match(/^(\s*)/) || ['', ''])[1].length;
        if (k > i && lines[k].trim() && ind < indent) break;
        block += lines[k] + '\n';
      }
      const bl = block.split('\n');

      const attrValues = new Map();
      const cleared = new Set();
      for (let k = 0; k < bl.length; k++) {
        const a = bl[k].match(/^\s*Attribute:\s*[\w.]+\.(\w+)\s*$/);
        if (a) {
          const v = (bl[k + 1] || '').match(/^\s*Value:\s*[\w.]*ENUM[\w.]*\.(\w+)\s*$/);
          if (v) attrValues.set(a[1], v[1]);
          continue;
        }
        const s = bl[k].match(/^\s*Association:\s*(\S+)\s*$/);
        if (s && /^\s*Value:\s*empty\s*$/.test(bl[k + 2] || bl[k + 1] || '')) cleared.add(s[1]);
      }
      if (!attrValues.size || !cleared.size) continue;

      for (const d of index.dispatchers) {
        const value = attrValues.get(d.attr);
        if (!value) continue;
        const handlerName = d.cases.get(value);
        if (!handlerName) continue;
        const handlerFile = index.byQualified.get(handlerName);
        if (!handlerFile) continue;
        const used = index.consumes.get(handlerFile) || new Set();
        const clash = [...cleared].filter((a) => used.has(a));
        if (!clash.length) continue;
        add('cleared-association-consumed', 'HIGH', rel(NEW, p),
          `sets ${d.attr} = ${value} and clears ${clash.join(', ')}, but ${handlerName} - the handler this value dispatches to - retrieves over ${clash.length > 1 ? 'those associations' : 'that association'}, so it receives nothing`,
          [`dispatcher: ${rel(NEW, d.file)}`,
            `${d.attr} = ${value} -> ${handlerName}`,
            `cleared here: ${[...cleared].join(', ')}`,
            `consumed there: ${clash.join(', ')}`]);
        break;
      }
      // Must always move forward: a one-line block would otherwise leave i
      // unchanged and spin here forever.
      i += Math.max(1, bl.length - 2);
    }
  }
}

// ================================================================
// Tree-level checks (run against --new)
// ================================================================

/* anonymous-grant
 * Defect class: EmployeeDocumentComplianceView granted Resource.Anonymous read
 * on employee names and their missing immigration documents, on a project with
 * EnableGuestAccess: true. */
function anonRoles(file) {
  const lines = read(file).split(/\r?\n/);
  const out = new Map();
  let i = lines.findIndex((l) => l === 'Entities:');
  if (i < 0) return out;
  let cur = null;
  const blocks = [];
  for (; i < lines.length; i++) {
    if (lines[i] === '    - $Type: DomainModels$EntityImpl') { cur = { name: null, roles: new Set() }; blocks.push(cur); continue; }
    if (!cur) continue;
    const n = lines[i].match(/^      Name: (.+)$/);
    if (n && !cur.name) cur.name = n[1].trim();
    const role = lines[i].match(/^\s+- ([\w]+\.(Anonymous|Guest))\s*$/);
    if (role) cur.roles.add(role[1]);
  }
  for (const b of blocks) if (b.name && b.roles.size) out.set(b.name, b.roles);
  return out;
}
function anonymousGrants(files, changedSet) {
  for (const p of files) {
    if (!/DomainModels\$DomainModel\.yaml$/.test(p)) continue;
    const r = rel(NEW, p);
    if (changedSet && !changedSet.has(r)) continue;
    const now = anonRoles(p);
    // Only what this range introduced. A pre-existing guest grant (a public
    // onboarding form, say) is a deliberate design decision, not a regression.
    const before = OLD && fs.existsSync(path.join(OLD, r)) ? anonRoles(path.join(OLD, r)) : new Map();
    for (const [name, roles] of now) {
      const had = before.get(name);
      const fresh = [...roles].filter((x) => !had || !had.has(x));
      if (!fresh.length) continue;
      add('anonymous-grant', 'HIGH', r,
        `entity ${name} newly grants ${fresh.join(', ')} - readable without authentication if guest access is on`,
        [`new roles: ${fresh.join(', ')}`, 'check Security$ProjectSecurity for EnableGuestAccess']);
    }
  }
}

/* secret-shared-value
 * Defect class: the live ServiceTab API key committed as a Settings$SharedValue
 * in one configuration while other configurations correctly used PrivateValue.
 * SharedValue is stored in the .mpr and therefore in git forever. */
function secretSharedValues(files, changedSet) {
  const p = files.find((f) => /Settings\$ProjectSettings\.yaml$/.test(f));
  if (!p) return;
  // A committed secret matters whether or not this range touched it, so never
  // suppress it - but do not dress a long-standing one up as news either.
  const touched = !changedSet || changedSet.has(rel(NEW, p));
  const lines = read(p).split(/\r?\n/);
  const hits = new Map();            // constantId -> [{config, line}]
  let config = '(unknown)';
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].match(/^          Name: (.+)$/);
    if (c) { config = c[1].trim(); continue; }
    const k = lines[i].match(/^\s*ConstantId:\s*(\S+)\s*$/);
    if (!k) continue;
    if (!/(key|secret|token|password|pwd|credential)/i.test(k[1])) continue;
    const win = lines.slice(i + 1, i + 5).join('\n');
    if (!/Settings\$SharedValue/.test(win)) continue;
    const val = win.match(/Value:\s*(\S+)/);
    if (!val || !val[1] || val[1] === '""') continue;
    if (!hits.has(k[1])) hits.set(k[1], []);
    hits.get(k[1]).push({ config, line: i + 1 });
  }
  // One finding per constant, listing the configurations - a secret in five
  // configurations is one problem, not five.
  for (const [id, where] of hits) {
    add('secret-shared-value', touched ? 'HIGH' : 'MEDIUM', rel(NEW, p),
      `${touched ? '' : '[pre-existing, untouched by this range] '}${id} is stored as a SharedValue in ${where.length} configuration(s) - the value is committed to the .mpr and lives in git history`,
      where.map((w) => `configuration "${w.config}" (L${w.line})`)
        .concat('use Settings$PrivateValue, or inject the value per environment'));
  }
}

/* gate-constant-never-configured
 * Defect class: CLE-635 wrapped its whole calculation in
 * @Finance.InvoiceRun_FractionRate, a Boolean defaulting to False that no
 * configuration sets - so the feature shipped inert in every environment. */
function gateConstants(files) {
  const settings = files.find((f) => /Settings\$ProjectSettings\.yaml$/.test(f));
  const settingsText = settings ? read(settings) : '';

  // Count every @Module.Constant reference in one pass over the flows. Doing
  // this per constant instead re-reads the whole model once for each constant,
  // which on a real project is tens of thousands of file reads.
  const refCount = new Map();
  for (const f of files) {
    if (!isFlow(f)) continue;
    const seenHere = new Set();
    for (const m of read(f).matchAll(/@([A-Za-z_]\w*\.[A-Za-z_]\w*)/g)) {
      if (seenHere.has(m[1])) continue;
      seenHere.add(m[1]);
      refCount.set(m[1], (refCount.get(m[1]) || 0) + 1);
    }
  }

  for (const p of files) {
    if (!/\$Constant\.yaml$/.test(p)) continue;
    const text = read(p);
    if (!/^DefaultValue:\s*"?False"?\s*$/m.test(text)) continue;
    const nm = text.match(/^Name:\s*(.+)$/m);
    if (!nm) continue;
    const name = nm[1].trim();
    const module = rel(NEW, p).split('/')[0];
    const qualified = `${module}.${name}`;
    const referenced = refCount.get(qualified) || 0;
    if (!referenced) continue;
    if (settingsText.includes(`ConstantId: ${qualified}`)) continue;
    // Only flag constants introduced by this range. A long-standing unset
    // Boolean is almost always an environment switch (IsProductionEnvironment
    // and friends) that is injected at deploy time, not a stalled feature flag.
    if (OLD && fs.existsSync(path.join(OLD, rel(NEW, p)))) continue;
    add('gate-constant-never-configured', 'MEDIUM', rel(NEW, p),
      `${qualified} is new, defaults to False, gates logic in ${referenced} microflow(s), and is set in no configuration - that logic ships inert unless it is injected per environment`,
      [`referenced by ${referenced} flow(s)`, 'no ConstantValue entry in Settings$ProjectSettings']);
  }
}

// ================================================================
// Delta checks (need --old)
// ================================================================

/* persistent-data-removed
 * Defect class: Resource.EmployeeDetails (persistable) deleted outright and
 * Relation.ExternalID dropped from a persistable entity. Both are irreversible
 * on deploy and neither is obvious from a diff stat. */
function parseEntities(file) {
  const lines = read(file).split(/\r?\n/);
  let i = lines.findIndex((l) => l === 'Entities:');
  const out = new Map();
  if (i < 0) return out;
  let cur = null, attr = null, inAttrs = false, persist = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === '    - $Type: DomainModels$EntityImpl') {
      cur = { name: null, persist: null, attrs: new Set() }; attr = null; inAttrs = false; persist = null; continue;
    }
    if (!cur) continue;
    const pm = l.match(/^\s+Persistable:\s*(\w+)\s*$/);
    if (pm) { persist = pm[1] === 'true'; continue; }
    const n = l.match(/^      Name: (.+)$/);
    if (n && !cur.name) { cur.name = n[1].trim(); cur.persist = persist; out.set(cur.name, cur); continue; }
    if (/^      Attributes:/.test(l)) { inAttrs = true; continue; }
    if (/^      (ValidationRules|Source|MaybeGeneralization|Name|AccessRules|Annotations|Index):/.test(l)) inAttrs = false;
    if (inAttrs && l === '        - $Type: DomainModels$Attribute') { attr = true; continue; }
    if (inAttrs && attr) {
      const an = l.match(/^          Name: (.+)$/);
      if (an) { cur.attrs.add(an[1].trim()); attr = null; }
    }
  }
  return out;
}
function persistentDataRemoved() {
  if (!OLD) return;
  for (const oldFile of walk(OLD)) {
    if (!/DomainModels\$DomainModel\.yaml$/.test(oldFile)) continue;
    const r = rel(OLD, oldFile);
    const newFile = path.join(NEW, r);
    const before = parseEntities(oldFile);
    const after = fs.existsSync(newFile) ? parseEntities(newFile) : new Map();
    for (const [name, e] of before) {
      if (!after.has(name)) {
        if (e.persist) {
          add('persistent-data-removed', 'HIGH', r,
            `persistable entity ${name} was deleted - its table is dropped on deploy and the data is unrecoverable`, []);
        }
        continue;
      }
      if (!e.persist) continue;
      const gone = [...e.attrs].filter((a) => !after.get(name).attrs.has(a));
      if (gone.length) {
        add('persistent-data-removed', 'HIGH', r,
          `persistable entity ${name} lost attribute(s) ${gone.join(', ')} - those columns are dropped on deploy`,
          gone.map((g) => `${name}.${g}`));
      }
    }
  }
}

// ================================================================
// run
// ================================================================

const changedSet = CHANGED ? new Set(scope.map((p) => rel(NEW, p))) : null;

for (const p of scope) {
  const r = rel(NEW, p);
  const text = read(p);
  if (isFlow(p)) {
    enumGuardMismatch(r, text);
    pairSkew(r, text);
    retrieveNondeterministic(r, text);
    unusedResult(r, text);
    guardAlreadyEnforced(r, text);
    dateFormatGuardInconsistent(r, text);
  }
}
// Cross-document: the dispatch index is built from the whole model, but only
// documents in scope are reported on.
clearedAssociationConsumed(scope, buildFlowIndex(allNew));
anonymousGrants(allNew, changedSet);
secretSharedValues(allNew, changedSet);
gateConstants(allNew);
persistentDataRemoved();

const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.check.localeCompare(b.check));

if (JSON_OUT) {
  console.log(JSON.stringify({ scanned: scope.length, findings }, null, 2));
} else {
  console.log(`# invariant candidates  (${scope.length} document(s) in scope)`);
  console.log('');
  if (!findings.length) {
    console.log('none');
  } else {
    for (const f of findings) {
      console.log(`[${f.severity}] ${f.check}`);
      console.log(`  ${f.file}`);
      console.log(`  ${f.message}`);
      for (const e of f.evidence) console.log(`    | ${e}`);
      console.log('');
    }
    const by = {};
    for (const f of findings) by[f.check] = (by[f.check] || 0) + 1;
    console.log('--');
    console.log(Object.entries(by).map(([k, v]) => `${k}=${v}`).join('  '));
    console.log('');
    console.log('These are CANDIDATES. Open each document and confirm before reporting.');
  }
}
