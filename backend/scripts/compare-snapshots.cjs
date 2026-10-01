const fs = require('node:fs');
const assert = require('node:assert/strict');
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const after = JSON.parse(fs.readFileSync(process.argv[3], 'utf8').replace(/^\uFEFF/, ''));
assert.deepEqual(after, before, 'Database data must match across a normal restart.');
console.log(JSON.stringify({ event: 'restart_persistence_verified', ...after }));
