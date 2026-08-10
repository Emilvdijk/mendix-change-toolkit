const { decode } = require('./mxunit.js');
const d = decode(require('fs').readFileSync(process.argv[2]));
console.log(`${d.$Type}|${d.Name || d.Caption || '(unnamed)'}`);
