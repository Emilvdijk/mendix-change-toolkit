#!/usr/bin/env node
/*
 * usages.js - who references this document? Straight from the raw .mxunit BSON.
 *
 *   node usages.js <Name|Module.Name> [--project <dir>] [--qualified] [--json]
 *
 * Exists because nothing else in the chain answers it:
 *   - the mxlint export omits marketplace modules entirely, so a reference FROM one
 *     (a layout, typically - most apps own no layouts at all) is invisible to the
 *     mirror and to everything scoped by it;
 *   - `mxcli refs` indexes microflow calls and widget actions but NOT snippet-call
 *     placement, so a snippet sitting on a layout reports "no references found".
 * Measured on 11.12.4 / mxcli v0.24.0: a review called a placed snippet unplaced
 * because both blind spots line up on the same question.
 *
 * Reads .mxunit files only - never the .mpr - so it is safe while Studio Pro is open.
 */
const fs = require('fs');
const path = require('path');
const { decode } = require('./mxunit.js');

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const QUALIFIED = argv.includes('--qualified'); // only match Module.Name strings - drops variable-name noise
const pi = argv.indexOf('--project');
const PROJECT = pi >= 0 ? argv[pi + 1] : process.cwd();
const SKIP = pi >= 0 ? pi + 1 : -1;
const TARGET = argv.filter((a, i) => !a.startsWith('--') && i !== SKIP)[0];

if (!TARGET) {
  console.error('usage: node usages.js <Name|Module.Name> [--project <dir>] [--json]');
  process.exit(2);
}

const ROOT = path.join(PROJECT, 'mprcontents');
if (!fs.existsSync(ROOT)) {
  console.error(`error: no mprcontents/ under ${PROJECT} - needs MPR v2 (Mendix 10.18+)`);
  process.exit(2);
}

const bare = TARGET.includes('.') ? TARGET.split('.').pop() : TARGET;
const hit = (s) => QUALIFIED ? (s === TARGET || s.endsWith(String.fromCharCode(46) + bare)) : s === TARGET || s === bare || (s.endsWith('.' + bare) && !s.slice(0, -bare.length - 1).includes(' '));

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.mxunit')) files.push(p);
  }
})(ROOT);

const out = [];
let scanned = 0, failed = 0;

for (const f of files) {
  let doc;
  try { doc = decode(fs.readFileSync(f)); } catch { failed++; continue; }
  scanned++;
  const self = doc.Name === bare;
  const refs = [];
  (function walk(n, p) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((v) => walk(v, p));
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'string') { if (hit(v)) refs.push({ path: `${p}.${k}`, value: v, kind: n.$Type || null }); }
      else if (v && typeof v === 'object') walk(v, `${p}.${k}`);
    }
  })(doc, '');
  if (refs.length || self) {
    out.push({
      file: path.relative(PROJECT, f).split(String.fromCharCode(92)).join("/"),
      type: doc.$Type, name: doc.Name || doc.Caption || '(unnamed)',
      definition: self, refs,
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ target: TARGET, scanned, failed, results: out }, null, 2));
} else {
  console.log(`# usages of ${TARGET}  (${scanned} unit(s) scanned${failed ? `, ${failed} undecodable` : ''})\n`);
  const users = out.filter((o) => !o.definition);
  for (const o of out.filter((o) => o.definition)) console.log(`DEFINITION  ${o.type}|${o.name}   <- ${o.file}`);
  if (!users.length) console.log('\nNo other document references it.');
  for (const o of users) {
    console.log(`\nREFERENCED BY  ${o.type}|${o.name}   <- ${o.file}`);
    for (const r of o.refs) console.log(`    ${r.kind || ''}  ${r.path} = ${JSON.stringify(r.value)}`);
  }
}
