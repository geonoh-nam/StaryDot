import assert from 'node:assert/strict';
import { pickLine } from './lines.js';
import { fitsHole, hintLevel, speechPassed, HINT_SOLVE } from './rules.js';
import { nearestWheelSlot, wheelLayout } from './wheel-layout.js';
import { POT_SHAPES } from '../data/pot-shapes.js';
import { TOON_SHAPES } from '../data/toon-shapes.js';
import { DUO_FRAME_AT, DUO_SHAPES } from '../data/duo-shapes.js';

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('fitsHole takes a piece dropped near its hole', () => {
  assert.equal(fitsHole({ x: 100, y: 100 }, { x: 130, y: 120 }, 60), true);
});

test('fitsHole refuses a piece dropped on the wrong wheel', () => {
  assert.equal(fitsHole({ x: 100, y: 100 }, { x: 300, y: 100 }, 60), false);
});

test('fitsHole measures both axes, not just the nearer one', () => {
  // 45,45 is inside a 60 box on each axis but 63.6 away — a diagonal miss must not count.
  assert.equal(fitsHole({ x: 0, y: 0 }, { x: 45, y: 45 }, 60), false);
});

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

test('speechPassed tolerates a short dip at a plosive', () => {
  const shortDip = [
    { db: -10, atMs: 0 },
    { db: -50, atMs: 100 },
    { db: -10, atMs: 200 },
    { db: -10, atMs: 450 },
  ];
  assert.equal(speechPassed(shortDip), true);
});

test('speechPassed resets on a silence longer than gapMs', () => {
  const longSilence = [
    { db: -10, atMs: 0 },
    { db: -50, atMs: 100 },
    { db: -50, atMs: 300 },
    { db: -10, atMs: 400 },
    { db: -10, atMs: 600 },
  ];
  assert.equal(speechPassed(longSilence), false);
});

let failed = 0;
const pots = POT_SHAPES;

test('pot source crops and board coordinates share the exact native frame', () => {
  pots.forEach((h) => {
    assert.ok(Math.abs(h.x * 1920 / 940 - h.crop.x) < 0.001);
    assert.ok(Math.abs(h.y * 1080 / 529 - h.crop.y) < 0.001);
    assert.ok(Math.abs(h.w * 1920 / 940 - h.crop.w) < 0.001);
    assert.ok(Math.abs(h.h * 1080 / 529 - h.crop.h) < 0.001);
  });
});

test('pot pieces fit inside the dock and never cover their slots on tablet sizes', () => {
  for (const [width, height] of [[600, 338], [940, 529], [1024, 576], [1194, 672]]) {
    const g = wheelLayout(width, height, pots, true);
    assert.ok(g.size >= 60);
    assert.ok(g.dock.x >= 0 && g.dock.x + g.dock.w <= width);
    assert.ok(g.dock.y + g.dock.h <= height);
    g.homes.forEach((home, i) => {
      assert.ok(home.x >= g.dock.x && home.x + g.size <= g.dock.x + g.dock.w);
      assert.ok(home.y + g.size <= g.dock.y + g.dock.h);
      // 조각 줄은 판 위에 겹쳐 뜬다 — 판이 화면을 꽉 채우므로 아래로 비켜설 자리가 없다.
      // 대신 그 줄이 빈 자리를 덮지 않아야 아이가 어디에 넣을지 볼 수 있다.
      const overlapsDock = g.targets[i].x < g.dock.x + g.dock.w && g.targets[i].x + g.size > g.dock.x
        && g.targets[i].y < g.dock.y + g.dock.h && g.targets[i].y + g.size > g.dock.y;
      assert.ok(!overlapsDock);
    });
  }
});

test('fitted chip centers align precisely with the original cutouts', () => {
  for (const inline of [true, false]) {
    const g = wheelLayout(1024, 700, pots, inline);
    pots.forEach((h, i) => {
      assert.ok(Math.abs(g.targets[i].x + (g.size - h.w * g.fit) / 2 - (g.board.x + h.x * g.fit)) < 0.001);
      assert.ok(Math.abs(g.targets[i].y + (g.size - h.h * g.fit) / 2 - (g.board.y + h.y * g.fit)) < 0.001);
    });
  }
});

test('episode 10 contours use closed paths and native-frame aligned targets', () => {
  assert.equal(TOON_SHAPES.length, 3);
  assert.equal(new Set(TOON_SHAPES.map(h => h.id)).size, 3);
  for (const [width, height] of [[600, 338], [940, 529], [1194, 672]]) {
    const g = wheelLayout(width, height, TOON_SHAPES, true);
    TOON_SHAPES.forEach((h, i) => {
      assert.match(h.outline, /^M.*C.*Z$/);
      assert.ok(!h.outline.includes('NaN'));
      assert.ok(h.crop.x >= 0 && h.crop.x + h.crop.w <= 1920);
      assert.ok(h.crop.y >= 0 && h.crop.y + h.crop.h <= 1080);
      assert.ok(Math.abs(h.x * 1920 / 940 - h.crop.x) < 0.001);
      assert.ok(Math.abs(h.y * 1080 / 529 - h.crop.y) < 0.001);
      assert.ok(Math.abs(h.w * 1920 / 940 - h.crop.w) < 0.001);
      assert.ok(Math.abs(h.h * 1080 / 529 - h.crop.h) < 0.001);
      assert.ok(Math.abs(g.targets[i].x + (g.size - h.w * g.fit) / 2 - (g.board.x + h.x * g.fit)) < 0.001);
      assert.ok(Math.abs(g.targets[i].y + (g.size - h.h * g.fit) / 2 - (g.board.y + h.y * g.fit)) < 0.001);
    });
  }
});

test('drop chooses nearest open slot, rejects outside drops and ignores completed slots', () => {
  const targets = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
  assert.equal(nearestWheelSlot({ x: 45, y: 0 }, targets, [false, false], 60), 1);
  assert.equal(nearestWheelSlot({ x: 50, y: 0 }, targets, [false, true], 30), -1);
  assert.equal(nearestWheelSlot({ x: 150, y: 100 }, targets, [false, false], 60), -1);
  assert.equal(nearestWheelSlot({ x: 20, y: 10 }, targets, [false, false], 60), 0);
});

test('episode 5 has two full-resolution character contours aligned with their slots', () => {
  assert.equal(DUO_FRAME_AT, 539.75);
  assert.equal(DUO_SHAPES.length, 2);
  assert.equal(new Set(DUO_SHAPES.map(h => h.id)).size, 2);
  for (const inline of [true, false]) {
    for (const [width, height] of [[600, 338], [940, 529], [1194, 672]]) {
      const g = wheelLayout(width, height, DUO_SHAPES, inline, true);
      DUO_SHAPES.forEach((h, i) => {
        assert.match(h.outline, /^M.*C.*Z$/);
        assert.ok(!h.outline.includes('NaN'));
        assert.ok(h.crop.x >= 0 && h.crop.x + h.crop.w <= 1920);
        assert.ok(h.crop.y >= 0 && h.crop.y + h.crop.h <= 1080);
        assert.ok(Math.abs(h.x * 1920 / 940 - h.crop.x) < 0.001);
        assert.ok(Math.abs(h.y * 1080 / 529 - h.crop.y) < 0.001);
        assert.ok(Math.abs(g.targets[i].x + (g.size - h.w * g.fit) / 2 - (g.board.x + h.x * g.fit)) < 0.001);
        assert.ok(Math.abs(g.targets[i].y + (g.size - h.h * g.fit) / 2 - (g.board.y + h.y * g.fit)) < 0.001);
        assert.equal(nearestWheelSlot(g.targets[i], g.targets, [false, false], g.snap), i);
        assert.ok(g.homes[i].y + g.size <= height);
        // 판이 화면을 꽉 채우므로 그림 아래끝은 조각 줄보다 내려간다. 대신 빈 자리 자체가
        // 그 줄에 덮이지 않는지만 본다.
        assert.ok(g.targets[i].y + g.size <= g.dock.y || g.targets[i].y >= g.dock.y + g.dock.h
          || g.targets[i].x + g.size <= g.dock.x || g.targets[i].x >= g.dock.x + g.dock.w);
      });
    }
  }
});

for (const [name, fn] of tests) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}
process.exit(failed ? 1 : 0);
