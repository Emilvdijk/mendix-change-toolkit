// Find a widget by Name inside a decoded page/snippet unit and print it.
const fs = require('fs');
const { decode } = require('./mxunit.js');
const doc = decode(fs.readFileSync(process.argv[2]));
const target = process.argv[3];

const hits = [];
(function walk(n, path) {
  if (!n || typeof n !== 'object') return;
  if (Array.isArray(n)) return n.forEach((v, i) => walk(v, path));
  if (n.Name === target) hits.push({ path, node: n });
  for (const [k, v] of Object.entries(n)) {
    if (v && typeof v === 'object') walk(v, `${path}.${k}`);
  }
})(doc, '');

for (const h of hits) {
  console.log(`PATH: ${h.path}`);
  console.log(JSON.stringify(h.node, null, 2).slice(0, 4000));
}
if (!hits.length) console.log('not found');
