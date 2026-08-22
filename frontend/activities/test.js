import assert from 'node:assert/strict';
import { pickLine } from './lines.js';

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('pickLine never repeats the previous line', () => {
  const pool = ['가', '나', '다'];
  for (let i = 0; i < 200; i += 1) {
    assert.notEqual(pickLine(pool, '가'), '가');
  }
});

test('pickLine returns the only line when the pool has one', () => {
  assert.equal(pickLine(['혼자'], '혼자'), '혼자');
});

test('pickLine handles an empty pool', () => {
  assert.equal(pickLine([], null), null);
});

test('pickLine returns the line when every entry equals last', () => {
  assert.equal(pickLine(['x', 'x', 'x'], 'x'), 'x');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}
process.exit(failed ? 1 : 0);
