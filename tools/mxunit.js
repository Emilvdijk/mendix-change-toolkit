// Minimal BSON decoder for Mendix .mxunit files -> readable JSON.
const fs = require('fs');

function cstr(b, i) {
  let j = i;
  while (b[j] !== 0) j++;
  return [b.toString('utf8', i, j), j + 1];
}

function readDoc(b, i) {
  const size = b.readInt32LE(i);
  const end = i + size - 1;
  i += 4;
  const out = [];
  while (i < end) {
    const t = b[i]; i++;
    if (t === 0) break;
    let name, v;
    [name, i] = cstr(b, i);
    [v, i] = readVal(b, i, t);
    out.push([name, v]);
  }
  return [out, end + 1];
}

function guid(raw) {
  const h = raw.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function readVal(b, i, t) {
  switch (t) {
    case 0x01: return [b.readDoubleLE(i), i + 8];
    case 0x02: case 0x0d: case 0x0e: {
      const n = b.readInt32LE(i); i += 4;
      return [b.toString('utf8', i, i + n - 1), i + n];
    }
    case 0x03: { const [d, ni] = readDoc(b, i); return [Object.fromEntries(d), ni]; }
    case 0x04: { const [d, ni] = readDoc(b, i); return [d.map(([, v]) => v), ni]; }
    case 0x05: {
      const n = b.readInt32LE(i); i += 4;
      const sub = b[i]; i += 1;
      const raw = b.subarray(i, i + n); i += n;
      if (n === 16) return [guid(raw), i];
      return [{ $bin: raw.toString('base64'), sub }, i];
    }
    case 0x06: case 0x0a: return [null, i];
    case 0x07: return [{ $oid: b.toString('hex', i, i + 12) }, i + 12];
    case 0x08: return [b[i] !== 0, i + 1];
    case 0x09: case 0x12: return [Number(b.readBigInt64LE(i)), i + 8];
    case 0x10: return [b.readInt32LE(i), i + 4];
    case 0x11: return [Number(b.readBigUInt64LE(i)), i + 8];
    default: throw new Error(`unhandled bson type 0x${t.toString(16)} at ${i}`);
  }
}

function decode(buf) {
  return Object.fromEntries(readDoc(buf, 0)[0]);
}

if (require.main === module) {
  const buf = fs.readFileSync(process.argv[2]);
  process.stdout.write(JSON.stringify(decode(buf), null, 2));
}
module.exports = { decode };
