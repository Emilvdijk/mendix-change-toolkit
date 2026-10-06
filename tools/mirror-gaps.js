#!/usr/bin/env node
/*
 * mirror-gaps.js - the documents a range changed that the mxlint mirror cannot see,
 * each with the command that reads it.
 *
 * Driven by mirror-gaps.sh, which resolves the mirror and the worktree first.
 *
 *   node mirror-gaps.js --repo <dir> --mirror <dir> --base <sha> --head <sha>
 *                       --tag-a <tag> --tag-b <tag> [--worktree <dir> --mpr <file>]
 *                       [--limit N] [--all] [--json]
 *
 * Why it exists: mxlint skips marketplace modules on export, so review.sh --summary,
 * lint-diff.sh and invariants.sh - all scoped by the mirror - are blind to them. The
 * raw .mxunit blobs in git are the only complete census. Layouts are the common case,
 * because most apps own none: a story that makes something appear app-wide lands in a
 * marketplace UI module by definition.
 *
 * A module VERSION bump is different in kind from a hand edit: it rewrites hundreds of
 * documents, and reading them one at a time is waste. Those are reported as an upgrade
 * with a count; only the hand edits are listed document by document.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const { decode } = require('./mxunit.js');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);

const REPO = opt('--repo'), MIRROR = opt('--mirror');
const BASE = opt('--base'), HEAD = opt('--head');
const TAG_A = opt('--tag-a'), TAG_B = opt('--tag-b');
const WT = opt('--worktree'), MPR = opt('--mpr');
const LIMIT = parseInt(opt('--limit', '25'), 10);
const ALL = flag('--all'), JSON_OUT = flag('--json');

// Printed commands carry short shas: the reviewer retypes these, and a 40-character
// pair wraps the terminal and hides what the command actually says.
const sh = (x) => String(x).slice(0, 8);

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

// ---------------------------------------------------------------- the two censuses

const changed = git(REPO, ['diff', '--name-status', BASE, HEAD, '--', 'mprcontents'])
  .split('\n').filter(Boolean)
  .map((l) => { const p = l.split('\t'); return { status: p[0][0], path: p[p.length - 1] }; })
  .filter((c) => c.path.endsWith('.mxunit'));

const mirrorFiles = TAG_A && TAG_B
  ? git(MIRROR, ['diff', '--name-only', '-M', TAG_A, TAG_B]).split('\n').filter(Boolean)
  : [];

// One `git cat-file --batch` for every blob: a module upgrade touches hundreds of units,
// and one git process per unit would dominate the runtime.
function readBlobs(specs) {
  const out = new Map();
  if (!specs.length) return out;
  const r = spawnSync('git', ['-C', REPO, 'cat-file', '--batch'], {
    input: specs.join('\n') + '\n', maxBuffer: 1 << 30,
  });
  const buf = r.stdout;
  let i = 0, n = 0;
  while (i < buf.length && n < specs.length) {
    const nl = buf.indexOf(10, i);
    if (nl < 0) break;
    const header = buf.toString('utf8', i, nl).trim();
    i = nl + 1;
    const parts = header.split(' ');
    if (parts[parts.length - 1] === 'missing') { n++; continue; }
    const size = parseInt(parts[parts.length - 1], 10);
    out.set(specs[n], buf.subarray(i, i + size));
    i += size + 1;
    n++;
  }
  return out;
}

const specs = changed.map((c) => (c.status === 'D' ? BASE : HEAD) + ':' + c.path);
const blobs = readBlobs(specs);

const units = [];
for (let k = 0; k < changed.length; k++) {
  const b = blobs.get(specs[k]);
  if (!b) continue;
  let u;
  try { u = decode(b); } catch { continue; }
  units.push({ ...changed[k], type: u.$Type || '?', name: u.Name || u.Caption || '(unnamed)' });
}

// ---------------------------------------------------------------- module upgrades

const upgrades = [];
const impls = units.filter((u) => u.type === 'Projects$ModuleImpl' && u.status === 'M');
if (impls.length) {
  const pairs = [];
  for (const u of impls) pairs.push(BASE + ':' + u.path, HEAD + ':' + u.path);
  const got = readBlobs(pairs);
  const dec = (x) => { try { return decode(got.get(x)); } catch { return null; } };
  for (const u of impls) {
    const o = dec(BASE + ':' + u.path), n = dec(HEAD + ':' + u.path);
    if (o && n && o.AppStoreVersion !== n.AppStoreVersion) {
      upgrades.push({
        module: n.Name,
        from: o.AppStoreVersion || '(none)',
        to: n.AppStoreVersion || '(none)',
      });
    }
  }
}

// A platform upgrade (Studio Pro version conversion) rewrites hundreds of documents too,
// and leaves a fingerprint: Projects$ProjectConversion gains one-time conversions. Measured
// on an 11.x -> 11.12.4 upgrade - 368 units changed, every marketplace version identical.
let platform = null;
const conv = units.find((u) => u.type === 'Projects$ProjectConversion' && u.status === 'M');
if (conv) {
  const got = readBlobs([BASE + ':' + conv.path, HEAD + ':' + conv.path]);
  const dec = (x) => { try { return decode(got.get(x)); } catch { return null; } };
  const names = (d) => new Set(
    ((d && d.OneTimeConversions) || [])
      .filter((c) => c && typeof c === 'object' && c.Name)
      .map((c) => c.Name)
  );
  const before = names(dec(BASE + ':' + conv.path));
  const added = [...names(dec(HEAD + ':' + conv.path))].filter((n) => !before.has(n));
  if (added.length) platform = added;
}

// ---------------------------------------------------------------- coverage

const CONTAINERS = new Set(['Projects$Folder', 'Projects$ModuleImpl', 'Projects$Project']);
const short = (t) => t.split('$').pop();

function coveredByMirror(u) {
  const stem = u.name.slice(0, 16);           // mxlint truncates long filenames
  const tail = '$' + short(u.type) + '.yaml';
  for (const m of mirrorFiles) {
    const b = m.slice(m.lastIndexOf('/') + 1);
    if (!b.endsWith(tail)) continue;
    if (b.startsWith(stem)) return true;
    if (u.name === '(unnamed)') return true;  // per-module singletons carry no document name
  }
  return false;
}

const docs = units.filter((u) => !CONTAINERS.has(u.type));
const gaps = docs.filter((u) => !coveredByMirror(u));
const covered = docs.length - gaps.length;

// ---------------------------------------------------------------- qualified names

// mxcli `describe` auto-detect does not know layouts, so the type has to be passed
// explicitly - which means resolving the module too. One SHOW per type, not per document.
const SHOW = {
  'Forms$Layout': ['layout', 'SHOW LAYOUTS'],
  'Forms$Page': ['page', 'SHOW PAGES'],
  'Forms$Snippet': ['snippet', 'SHOW SNIPPETS'],
  'Microflows$Microflow': ['microflow', 'SHOW MICROFLOWS'],
  'Microflows$Nanoflow': ['nanoflow', 'SHOW NANOFLOWS'],
};

function showTable(cmd) {
  const r = spawnSync('mxcli', ['-p', path.join(WT, MPR), '-c', cmd], {
    encoding: 'utf8', maxBuffer: 1 << 26,
  });
  const rows = new Map();
  for (const line of String(r.stdout || '').split('\n')) {
    if (line[0] !== '|') continue;
    const f = line.split('|').map((x) => x.trim());
    if (f.length < 3) continue;
    if (f[1] === 'Qualified Name') continue;
    if (f[1].split('').every((c) => c === '-' || c === ' ')) continue;
    if (f[1].includes('.')) rows.set(f[1].split('.').pop(), f[1]);
  }
  return rows;
}

const resolvable = Boolean(WT && MPR) && (ALL || gaps.length <= LIMIT);
const tables = new Map();
if (resolvable) {
  for (const t of new Set(gaps.map((g) => g.type))) {
    if (SHOW[t]) tables.set(t, showTable(SHOW[t][1]));
  }
}
for (const g of gaps) {
  const tbl = tables.get(g.type);
  const qn = tbl && tbl.get(g.name);
  if (qn) { g.qualified = qn; g.mxType = SHOW[g.type][0]; }
}

// ---------------------------------------------------------------- report

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, head: HEAD, covered, upgrades, platform, gaps }, null, 2));
  process.exit(0);
}

console.log('# mirror gaps  ' + sh(BASE) + ' -> ' + sh(HEAD));
console.log('# ' + covered + ' document(s) covered by the mirror, ' + gaps.length + ' gap(s)\n');

if (platform) {
  console.log('PLATFORM UPGRADE in this range - a Studio Pro version conversion ran');
  const head = platform.slice(0, 6).join(', ');
  const rest = platform.length > 6 ? ' (+' + (platform.length - 6) + ' more)' : '';
  console.log('  ' + platform.length + ' one-time conversions added: ' + head + rest);
  console.log('  This rewrites documents across every module, marketplace ones included, and is');
  console.log('  why the counts below are large. It is one change, not hundreds. Report the');
  console.log('  version move and check what it converted - do not read the churn document by');
  console.log('  document.\n');
}

if (upgrades.length) {
  console.log('MARKETPLACE MODULE UPGRADES in this range');
  for (const u of upgrades) console.log('  ' + u.module + '  ' + u.from + ' -> ' + u.to);
  console.log('  A version bump rewrites whole modules. Review it as an upgrade - what the');
  console.log('  release notes change, and whether a local edit was overwritten - rather than');
  console.log('  by reading its documents one at a time.\n');
}

if (!gaps.length) {
  console.log('No gaps: every document this range changed is in the mirror.');
  process.exit(0);
}

if (!resolvable) {
  const byType = {};
  for (const g of gaps) byType[g.type] = (byType[g.type] || 0) + 1;
  console.log(gaps.length + ' gaps, over the limit of ' + LIMIT + ' - not listed one by one.');
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + String(n).padStart(5) + '  ' + t);
  }
  console.log('\nThat volume is an upgrade or a bulk edit, not hand work. Characterise it as one');
  console.log('change rather than N changes. To list them anyway: --all. To read any single one:');
  console.log('  bash sweep.sh ' + sh(BASE) + ' ' + sh(HEAD) + ' detail');
  process.exit(0);
}

console.log('GAPS - changed documents no other output of this toolkit will show you:\n');
for (const g of gaps) {
  console.log('  ' + g.status + '  ' + g.type + '|' + g.name);
  if (g.qualified) {
    console.log('     read: bash mdl-diff.sh ' + sh(BASE) + ' ' + sh(HEAD) + ' ' + g.mxType + ':' + g.qualified);
  } else {
    console.log('     read: bash sweep.sh ' + sh(BASE) + ' ' + sh(HEAD) + ' detail      (grep for ' + g.name + ')');
  }
}
console.log('\nRead every one, then fold them into the changed-document table yourself.');
