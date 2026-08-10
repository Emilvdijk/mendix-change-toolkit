// Split the single-line `pseudocode:` scalar out of exported mxlint YAML into a
// sibling *.flow.txt with real newlines, so git diff shows line-level flow changes.
// Usage: node expand-pseudocode.js <modelsourceDir>
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p, out); }
    else if (e.name.endsWith('.yaml')) out.push(p);
  }
  return out;
}

let n = 0;
for (const f of walk(process.argv[2])) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith('pseudocode: "'));
  if (idx === -1) continue;
  let text;
  try {
    // YAML double-quoted scalar on one line == JSON string
    text = JSON.parse(lines[idx].slice('pseudocode: '.length));
  } catch { continue; }
  fs.writeFileSync(f.replace(/\.yaml$/, '.flow.txt'), text.replace(/\r\n/g, '\n') + '\n');
  // drop the noisy one-liner from the yaml so it doesn't double-report
  lines[idx] = 'pseudocode: <see sibling .flow.txt>';
  fs.writeFileSync(f, lines.join('\n'));
  n++;
}
console.log(`expanded ${n} pseudocode blocks`);
