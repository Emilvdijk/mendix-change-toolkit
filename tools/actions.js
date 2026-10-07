#!/usr/bin/env node
/*
 * actions.js - every microflow/nanoflow/rule activity of a given action type, straight from
 * the raw .mxunit BSON. Answers "where is X deleted / committed / retrieved?" completely.
 *
 *   node actions.js [--type Delete] [--match <regex>] [--project <dir>] [--json]
 *
 *   --type   action type without the "Action" suffix: Delete (default), Commit, Rollback,
 *            Retrieve, Change, CreateChange, MicroflowCall, JavaActionCall, ... (case-insensitive)
 *   --match  regex (case-insensitive) tested against document name, variable, entity,
 *            association and XPath - e.g. --match Order
 *
 * Exists because the obvious route is incomplete: mxcli's CATALOG.ACTIVITIES (v0.24.0) does
 * not list activities that sit inside a loop or while body. A catalog sweep for
 * DeleteObjectAction silently missed a list delete inside a while loop - the delete that
 * turned out to be the bug. Every activity here carries its loop depth so you can see it.
 *
 * Reads .mxunit files only - never the .mpr - so it is safe while Studio Pro is open.
 */
const fs = require('fs');
const path = require('path');
const { decode } = require('./mxunit.js');

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const JSON_OUT = argv.includes('--json');
const PROJECT = opt('--project', process.cwd());
const TYPE = opt('--type', 'Delete').replace(/Action$/i, '').toLowerCase();
const MATCH = opt('--match', null);
const re = MATCH ? new RegExp(MATCH, 'i') : null;

const ROOT = path.join(PROJECT, 'mprcontents');
if (!fs.existsSync(ROOT)) {
  console.error(`error: no mprcontents/ under ${PROJECT} - needs MPR v2 (Mendix 10.18+)`);
  process.exit(2);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.mxunit')) files.push(p);
  }
})(ROOT);

const FLOW_TYPES = new Set(['Microflows$Microflow', 'Microflows$Nanoflow', 'Microflows$Rule']);
const wanted = (t) => t && t.startsWith('Microflows$') && t.endsWith('Action') &&
  t.slice('Microflows$'.length, -'Action'.length).toLowerCase() === TYPE;

function describe(a) {
  const src = a.RetrieveSource || {};
  return {
    variable: a.DeleteVariableName || a.CommitVariableName || a.RollbackVariableName ||
      a.ChangeVariableName || a.ResultVariableName || a.VariableName || '',
    entity: a.Entity || src.Entity || '',
    association: src.AssociationId || '',
    xpath: (src.XpathConstraint || '').replace(/\s+/g, ' ').trim(),
    target: (a.MicroflowCall && a.MicroflowCall.Microflow) || a.JavaAction || '',
    commit: a.Commit || '',
    refreshInClient: a.RefreshInClient,
  };
}

const out = [];
let scanned = 0, failed = 0;
for (const f of files) {
  const buf = fs.readFileSync(f);
  if (!buf.includes('Microflows$')) continue;
  let doc;
  try { doc = decode(buf); } catch { failed++; continue; }
  if (!FLOW_TYPES.has(doc.$Type)) continue;
  scanned++;
  (function walk(n, loopDepth, disabled) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((v) => walk(v, loopDepth, disabled));
    const t = n.$Type || '';
    if (t === 'Microflows$LoopedActivity') loopDepth++;
    if (t === 'Microflows$ActionActivity' && n.Disabled) disabled = true;
    if (wanted(t)) {
      const d = describe(n);
      const hay = [doc.Name, d.variable, d.entity, d.association, d.xpath, d.target].join(' ');
      if (!re || re.test(hay)) {
        out.push({ doc: doc.Name, kind: doc.$Type.split('$')[1], action: t.split('$')[1],
          ...d, loopDepth, disabled,
          file: path.relative(PROJECT, f).split(path.sep).join('/') });
      }
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, loopDepth, disabled);
  })(doc, 0, false);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ type: TYPE, match: MATCH, scanned, failed, results: out }, null, 2));
} else {
  console.log(`# ${TYPE} actions${MATCH ? ` matching /${MATCH}/i` : ''}  ` +
    `(${scanned} flow(s) scanned${failed ? `, ${failed} undecodable` : ''}, ${out.length} hit(s))\n`);
  for (const o of out.sort((a, b) => a.doc.localeCompare(b.doc))) {
    const bits = [o.variable && `$${o.variable}`, o.entity, o.association && `via ${o.association}`,
      o.target && `-> ${o.target}`, o.xpath && o.xpath.slice(0, 140)].filter(Boolean);
    const flags = [o.loopDepth && `in loop (depth ${o.loopDepth})`, o.disabled && 'DISABLED']
      .filter(Boolean).join(', ');
    console.log(`${o.kind.padEnd(9)} ${o.doc}  ${bits.join('  ')}${flags ? `   [${flags}]` : ''}`);
  }
  console.log('\nVariables are names only: check the declaring retrieve/create to confirm the entity.');
}
