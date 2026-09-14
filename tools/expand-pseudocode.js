// Split the single-line `pseudocode:` scalar out of exported mxlint YAML into a
// sibling *.flow.txt with real newlines, so git diff shows line-level flow changes.
// Usage: node expand-pseudocode.js <modelsourceDir>
//
// mxlint >= 3.17 already exports pseudocode as a literal block scalar (`pseudocode: |-`)
// with real newlines, so there is nothing to expand and git diff is line-level already.
// Older mxlint emitted a double-quoted one-liner, which is what this script unpacks.
// Both are fine; the script reports which form it saw so a no-op is never silent.
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: expand-pseudocode.js <modelsourceDir>');
  process.exit(2);
}
if (!fs.existsSync(root)) {
  console.error(`expand-pseudocode.js: no such directory: ${root}`);
  process.exit(2);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(p, out); }
    else if (e.name.endsWith('.yaml')) out.push(p);
  }
  return out;
}

let expanded = 0;   // old form: unpacked into a sibling .flow.txt
let alreadyBlock = 0;  // new form: mxlint already gave us real newlines
let unparsable = 0;

for (const f of walk(root)) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.startsWith('pseudocode:'));
  if (idx === -1) continue;

  // `pseudocode: |-` / `|` / `>-` etc: already multi-line, leave it alone.
  if (/^pseudocode:\s*[|>]/.test(lines[idx])) { alreadyBlock++; continue; }
  if (!lines[idx].startsWith('pseudocode: "')) { unparsable++; continue; }

  let text;
  try {
    // YAML double-quoted scalar on one line == JSON string
    text = JSON.parse(lines[idx].slice('pseudocode: '.length));
  } catch { unparsable++; continue; }

  fs.writeFileSync(f.replace(/\.yaml$/, '.flow.txt'), text.replace(/\r\n/g, '\n') + '\n');
  // drop the noisy one-liner from the yaml so it doesn't double-report
  lines[idx] = 'pseudocode: <see sibling .flow.txt>';
  fs.writeFileSync(f, lines.join('\n'));
  expanded++;
}

const parts = [`expanded ${expanded}`];
if (alreadyBlock) parts.push(`${alreadyBlock} already block scalars (mxlint >= 3.17, nothing to do)`);
if (unparsable) parts.push(`${unparsable} unrecognised`);
console.log(parts.join(', '));
