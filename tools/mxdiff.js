// Structural diff between two decoded .mxunit BSON documents.
// Usage: node mxdiff.js old.bin new.bin [--keep-ids]
const fs = require('fs');
const { decode } = require('./mxunit.js');

const keepIds = process.argv.includes('--keep-ids');
const NOISE = new Set(keepIds ? [] : ['$ID', 'RelativeMiddlePoint', 'Size', 'PersistentId']);

function label(node) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const t = node.$Type ? String(node.$Type).split('$').pop() : null;
    const n = node.Name || node.Caption || node.ModuleName || null;
    const name = typeof n === 'string' ? n : null;
    if (t && name) return `${t}:${name}`;
    if (t) return t;
  }
  return null;
}

// Key used to align array elements across versions.
function keyOf(node, idx) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (node.$ID) return `id=${node.$ID}`;
    const l = label(node);
    if (l) return `lbl=${l}`;
  }
  if (typeof node !== 'object') return `val=${JSON.stringify(node)}`;
  return `idx=${idx}`;
}

const out = [];
function rec(path, a, b) {
  if (a === b) return;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;

  if (ta !== tb || ta !== 'object' && ta !== 'array') {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, from: a, to: b });
    return;
  }

  if (ta === 'array') {
    const ma = new Map(), mb = new Map();
    a.forEach((v, i) => ma.set(keyOf(v, i), v));
    b.forEach((v, i) => mb.set(keyOf(v, i), v));
    for (const [k, v] of ma) {
      if (!mb.has(k)) out.push({ path: `${path}[${label(v) || k}]`, removed: v });
    }
    for (const [k, v] of mb) {
      if (!ma.has(k)) out.push({ path: `${path}[${label(v) || k}]`, added: v });
      else rec(`${path}[${label(v) || k}]`, ma.get(k), v);
    }
    return;
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    if (!(k in a)) { out.push({ path: `${path}.${k}`, added: b[k] }); continue; }
    if (!(k in b)) { out.push({ path: `${path}.${k}`, removed: a[k] }); continue; }
    rec(`${path}.${k}`, a[k], b[k]);
  }
}

const A = decode(fs.readFileSync(process.argv[2]));
const B = decode(fs.readFileSync(process.argv[3]));
rec('', A, B);

const trunc = (v) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 600 ? s.slice(0, 600) + ` …(${s.length} chars)` : s;
};

console.log(`# ${B.$Type}  Name=${B.Name || '(n/a)'}`);
console.log(`# ${out.length} change(s)\n`);
for (const c of out) {
  if ('added' in c) console.log(`+ ADDED   ${c.path}\n          ${trunc(c.added)}\n`);
  else if ('removed' in c) console.log(`- REMOVED ${c.path}\n          ${trunc(c.removed)}\n`);
  else console.log(`~ CHANGED ${c.path}\n          - ${trunc(c.from)}\n          + ${trunc(c.to)}\n`);
}
