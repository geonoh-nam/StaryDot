import assert from 'node:assert/strict';
import { pickLine } from './lines.js';
import { hintLevel, isHit, speechPassed, HINT_SOLVE } from './rules.js';

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

test('hintLevel climbs at 8, 16 and 24 seconds', () => {
  assert.equal(hintLevel(0), 0);
  assert.equal(hintLevel(7999), 0);
  assert.equal(hintLevel(8000), 1);
  assert.equal(hintLevel(15999), 1);
  assert.equal(hintLevel(16000), 2);
  assert.equal(hintLevel(HINT_SOLVE), 3);
  assert.equal(hintLevel(99000), 3);
});

test('isHit accepts a touch inside the target circle', () => {
  const target = { x: 0.5, y: 0.5, r: 0.1 };
  assert.equal(isHit({ x: 0.5, y: 0.5 }, target), true);
  assert.equal(isHit({ x: 0.58, y: 0.5 }, target), true);
  assert.equal(isHit({ x: 0.7, y: 0.5 }, target), false);
});

test('speechPassed needs the level held above the floor long enough', () => {
  const loudBriefly = [
    { db: -50, atMs: 0 },
    { db: -12, atMs: 100 },
    { db: -50, atMs: 300 },
  ];
  assert.equal(speechPassed(loudBriefly), false);

  const loudHeld = [
    { db: -50, atMs: 0 },
    { db: -12, atMs: 100 },
    { db: -10, atMs: 300 },
    { db: -14, atMs: 600 },
  ];
  assert.equal(speechPassed(loudHeld), true);
});

test('speechPassed ignores a silent room', () => {
  const quiet = [{ db: -60, atMs: 0 }, { db: -58, atMs: 500 }, { db: -61, atMs: 1000 }];
  assert.equal(speechPassed(quiet), false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}
process.exit(failed ? 1 : 0);
