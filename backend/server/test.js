import assert from 'node:assert/strict';
import { parseSrt } from './srt.js';
import { parseRange } from './media.js';
import { openDb, upsertChild, startSession, endSession, addActivityResult, getReport,
         upsertCategory, insertVideo, replaceActivities, setVideoStatus,
         getCatalog, getWatchHistory, recordPlanSession } from './db.js';
import { toStorydotRow, COLOR_SWATCHES } from './activity-payload.js';
import { planFor } from './session.js';

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('parseSrt reads index, timecodes and text', () => {
  const out = parseSrt('1\n00:00:08,000 --> 00:00:11,700\n아기 고래를 너무 사랑해서\n');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { idx: 1, start_ms: 8000, end_ms: 11700, text: '아기 고래를 너무 사랑해서' });
});

test('parseSrt handles hours, minutes and multi-line cues', () => {
  const out = parseSrt(
    '1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n' +
    '2\n01:02:03,456 --> 01:02:04,000\nline one\nline two\n\n'
  );
  assert.equal(out.length, 2);
  assert.equal(out[1].start_ms, 3723456);
  assert.equal(out[1].text, 'line one\nline two');
});

test('parseSrt keeps the last cue when the file has no trailing blank line', () => {
  const out = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nonly');
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'only');
});

test('parseSrt tolerates CRLF and a BOM', () => {
  const out = parseSrt('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nhello\r\n');
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'hello');
});

test('parseRange returns null when there is no Range header', () => {
  assert.equal(parseRange(undefined, 1000), null);
});

test('parseRange reads a closed range', () => {
  assert.deepEqual(parseRange('bytes=0-499', 1000), { start: 0, end: 499 });
});

test('parseRange treats an open end as the last byte', () => {
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
});

test('parseRange reads a suffix range', () => {
  assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
});

test('parseRange rejects a start past the end of the file', () => {
  assert.equal(parseRange('bytes=2000-', 1000), 'invalid');
});

test('getReport sums watch time and counts activity results', () => {
  const db = openDb(':memory:');
  upsertCategory(db, { id: 'c', label: 'c', sort: 0 });
  insertVideo(db, { id: 'v1', category_id: 'c', title: 'V1', duration_sec: 60, file_path: 'video/v1.mp4' });
  replaceActivities(db, 'v1', [
    { at_sec: 10, type: 'quiz', payload: {} },
    { at_sec: 20, type: 'trace', payload: {} },
  ]);
  const acts = db.prepare('SELECT id FROM activity WHERE video_id = ? ORDER BY at_sec').all('v1');

  const child = upsertChild(db, { name: '아리', age: 5, daily_limit_min: 30 });
  const again = upsertChild(db, { name: '아리', age: 5, daily_limit_min: 60 });
  assert.equal(again.id, child.id);

  const s1 = startSession(db, { child_id: child.id, video_id: 'v1' });
  endSession(db, s1.id, 40);
  const s2 = startSession(db, { child_id: child.id, video_id: 'v1' });
  endSession(db, s2.id, 25);
  startSession(db, { child_id: child.id, video_id: 'v1' }); // still open, must not count

  addActivityResult(db, { session_id: s1.id, activity_id: acts[0].id, result: 'correct' });
  addActivityResult(db, { session_id: s1.id, activity_id: acts[1].id, result: 'done', drawing_path: 'draw/a.png' });
  addActivityResult(db, { session_id: s2.id, activity_id: acts[0].id, result: 'skip' });

  const r = getReport(db, child.id);
  assert.equal(r.watched_sec, 65);
  assert.equal(r.videos, 2);
  assert.equal(r.quiz_correct, 1);
  assert.equal(r.drawing, 1);
  assert.equal(r.skip, 1);
  assert.equal(r.recent[0].title, 'V1');
});

// ---------------------------------------------------------------- 파이프라인 접합

const STORYDOT_ACTIVITY = {
  type: '색깔 퀴즈', domain: '예술경험', age: '3세',
  curriculum: '아름다움 찾아보기 — 색에 관심을 가진다',
  prompt: '이 그림에서 빵 얼굴 캐릭터는 무슨 색인가요?',
  fact_id: 'ocl0501', t: 372.0, answer: '갈색', choices: ['갈색', '보라', '초록'],
};

test('toStorydotRow 는 색 문항에 이름에 맞는 색을 칠한다', () => {
  const row = toStorydotRow(STORYDOT_ACTIVITY, '/media/frame/x.jpg');
  assert.equal(row.type, 'quiz');
  assert.equal(row.at_sec, 372);
  assert.equal(row.payload.answer, '갈색');
  assert.equal(row.payload.framePath, '/media/frame/x.jpg');
  const brown = row.payload.options.find((o) => o.label === '갈색');
  assert.equal(brown.color, COLOR_SWATCHES['갈색'].color);
  // 팔레트를 돌려 쓰면 "갈색"이 초록으로 칠해진다. 그러면 문제 자체가 틀린다.
  const green = row.payload.options.find((o) => o.label === '초록');
  assert.notEqual(green.color, brown.color);
});

test('toStorydotRow 는 창의 문항과 프레임 없는 문항을 거부한다', () => {
  assert.throws(() => toStorydotRow({ ...STORYDOT_ACTIVITY, answer: null, choices: null }, '/f.jpg'));
  assert.throws(() => toStorydotRow(STORYDOT_ACTIVITY, null));
  assert.throws(() => toStorydotRow({ ...STORYDOT_ACTIVITY, answer: '하양' }, '/f.jpg'));
});

// 편성 테스트용 카탈로그. 시리즈 하나에 짧은 영상 여러 편 — 실제 DB 에는 아직 시리즈당
// 1편뿐이라 브레이크가 생기는 경로를 실물로 밟을 수 없다.
function seedForPlan(db, { videos = 4, durationSec = 120 } = {}) {
  upsertCategory(db, { id: 'teenieping', label: '캐치 티니핑', sort: 0 });
  for (let i = 0; i < videos; i++) {
    const id = `v${i}`;
    insertVideo(db, { id, category_id: 'teenieping', title: `EP${i}`, duration_sec: durationSec,
                      file_path: `video/${id}.mp4`, thumb_path: `thumb/${id}.jpg`, color: '#ff5fa2' });
    replaceActivities(db, id, [
      toStorydotRow({ ...STORYDOT_ACTIVITY, fact_id: `f${i}a` }, `/media/frame/${id}-a.jpg`),
      toStorydotRow({ ...STORYDOT_ACTIVITY, fact_id: `f${i}b`, t: 400 }, `/media/frame/${id}-b.jpg`),
      toStorydotRow({ ...STORYDOT_ACTIVITY, fact_id: `f${i}c`, t: 500 }, `/media/frame/${id}-c.jpg`),
    ]);
    setVideoStatus(db, id, 'ready');
  }
  return db;
}

const MISSIONS = [{ id: 'm1', characterIds: ['teenieping'], title: '색깔 찾기', description: '분홍 세 개' }];

// 나이별 문항 한 편. 어휘가 어려운 문항일수록 age 가 높다(observe.py 의 WORD_AGE).
function seedByAge(db) {
  upsertCategory(db, { id: 'teenieping', label: '캐치 티니핑', sort: 0 });
  insertVideo(db, { id: 'v0', category_id: 'teenieping', title: 'EP0', duration_sec: 120,
                    file_path: 'video/v0.mp4', thumb_path: 'thumb/v0.jpg', color: '#ff5fa2' });
  replaceActivities(db, 'v0', ['3세', '4세', '5세'].map((age, i) =>
    toStorydotRow({ ...STORYDOT_ACTIVITY, age, fact_id: `age${i}`, t: 100 * (i + 1) },
                  `/media/frame/v0-${i}.jpg`)));
  setVideoStatus(db, 'v0', 'ready');
  return db;
}

test('getCatalog 은 아이가 감당 못 하는 나이의 문항을 뺀다', () => {
  const db = seedByAge(openDb(':memory:'));
  const ages = (childAge) => getCatalog(db, { childAge })[0].quizItems.map((q) => q.age);

  // 세 살에게 다섯 살 어휘 문항을 내면 못 푼다. 위로만 자른다.
  assert.deepEqual(ages(3), [3]);
  assert.deepEqual(ages(4), [4, 3], '어려운 것부터 와야 브레이크 두 칸이 아깝지 않다');
  assert.deepEqual(ages(5), [5, 4, 3]);
  // 나이를 모르면 거르지 않는다 — 프로필 없이도 앱은 돌아야 한다.
  assert.deepEqual(ages(null).sort(), [3, 4, 5]);
});

test('planFor 는 아이 프로필의 나이로 문항을 고른다', () => {
  const db = seedByAge(openDb(':memory:'));
  const three = upsertChild(db, { name: '세살이', age: 3, daily_limit_min: 30 });
  const five = upsertChild(db, { name: '다섯살이', age: 5, daily_limit_min: 30 });

  const pick = (childId) => {
    const r = planFor(db, { childId, characterId: 'teenieping', budgetSec: 600, missions: MISSIONS });
    assert.equal(r.ok, true);
    return r.plan.items.find((i) => i.kind === 'quiz').items.map((q) => q.age);
  };

  assert.deepEqual(pick(three.id), ['3세'], '세 살에게는 세 살 문항만');
  // 브레이크는 두 칸뿐이라, 다섯 살은 감당 가능한 것 중 어려운 둘을 받아야 한다.
  assert.deepEqual(pick(five.id), ['5세', '4세']);
});

test('getCatalog 은 활동 payload 를 편성기가 읽는 문항으로 편다', () => {
  const db = seedForPlan(openDb(':memory:'), { videos: 1 });
  const [v] = getCatalog(db);
  assert.deepEqual(v.characterIds, ['teenieping']);
  assert.equal(v.durationSec, 120);
  assert.equal(v.quizItems.length, 3);
  assert.equal(v.quizItems[0].question, STORYDOT_ACTIVITY.prompt);
  assert.deepEqual(v.quizItems[0].choices, ['갈색', '보라', '초록']);
  assert.equal(v.quizItems[0].choices[v.quizItems[0].answerIndex], '갈색');
  assert.equal(v.videoPath, '/media/video/v0.mp4');
});

test('planFor 는 영상마다 브레이크를 넣고 미션으로 닫는다', () => {
  const db = seedForPlan(openDb(':memory:'));
  const child = upsertChild(db, { name: '아리', age: 5, daily_limit_min: 30 });
  const r = planFor(db, { childId: child.id, characterId: 'teenieping', budgetSec: 600, missions: MISSIONS });
  assert.equal(r.ok, true);

  const kinds = r.plan.items.map((i) => i.kind);
  const videos = kinds.filter((k) => k === 'video').length;
  const quizzes = kinds.filter((k) => k === 'quiz').length;
  assert.ok(videos >= 2, `영상이 ${videos}편뿐이라 브레이크 경로를 못 밟는다`);
  // 브레이크는 영상마다 — 마지막 영상 뒤에도 묻고, 그 다음 미션이 닫는다.
  assert.equal(quizzes, videos);
  assert.equal(kinds[kinds.length - 1], 'mission');
  assert.equal(kinds[kinds.length - 2], 'quiz');
  assert.equal(kinds[kinds.length - 3], 'video');

  // 브레이크 한 번에 두 문항, 앱이 그릴 payload 가 그대로 실려 있다.
  const firstBreak = r.plan.items.find((i) => i.kind === 'quiz');
  assert.equal(firstBreak.items.length, 2);
  assert.ok(firstBreak.items[0].framePath, '문항에 근거 프레임이 없다');
  assert.ok(firstBreak.items[0].options.length >= 2);

  // 예산을 넘지 않는다. 넘으면 부모가 정한 총량이 무의미해진다.
  assert.ok(r.plan.plannedTotalSec <= 600, `${r.plan.plannedTotalSec} > 600`);
  assert.equal(r.plan.underrunSec, 600 - r.plan.plannedTotalSec);
  // 영상은 길이 내림차순 — 뒤로 갈수록 짧아져야 끝이 자연스럽다.
  assert.equal(r.plan.plannedTotalSec, videos * 120 + videos * 40 + 20);
});

test('planFor 는 편성을 남기고, 다음 편성이 그 조합을 피한다', () => {
  const db = seedForPlan(openDb(':memory:'), { videos: 4, durationSec: 60 });
  const child = upsertChild(db, { name: '아리', age: 5, daily_limit_min: 30 });

  const first = planFor(db, { childId: child.id, characterId: 'teenieping', budgetSec: 200, missions: MISSIONS });
  assert.equal(first.ok, true);
  const seen = new Set(first.plan.videoIds);

  const history = getWatchHistory(db, child.id, 2);
  assert.equal(history.recentSessions.length, 1);
  assert.deepEqual(history.recentSessions[0].videoIds, first.plan.videoIds);
  assert.equal(history.recentSessions[0].missionId, 'm1');

  const second = planFor(db, { childId: child.id, characterId: 'teenieping', budgetSec: 200, missions: MISSIONS });
  assert.equal(second.ok, true);
  // 어제 본 조합을 물리적으로 다시 만들 수 없어야 다양성이 산다.
  for (const id of second.plan.videoIds) assert.ok(!seen.has(id), `${id} 가 연속 두 번 나왔다`);
});

test('planFor 는 카탈로그가 마르면 반복 시청을 허용한다', () => {
  // 2편뿐인데 두 번 편성하면 제외 규칙을 풀어야 한다 — 못 트는 것보다 다시 보는 게 낫다.
  const db = seedForPlan(openDb(':memory:'), { videos: 2, durationSec: 60 });
  const child = upsertChild(db, { name: '아리', age: 5, daily_limit_min: 30 });
  for (let i = 0; i < 3; i++) {
    const r = planFor(db, { childId: child.id, characterId: 'teenieping', budgetSec: 200, missions: MISSIONS });
    assert.equal(r.ok, true, `${i}회차에서 편성이 끊겼다`);
  }
});

test('planFor 는 예산이 모자라거나 시리즈가 비면 사유를 돌려준다', () => {
  const db = seedForPlan(openDb(':memory:'), { videos: 2, durationSec: 600 });
  assert.equal(planFor(db, { characterId: 'teenieping', budgetSec: 100, missions: MISSIONS }).reason, 'BUDGET_TOO_SMALL');
  assert.equal(planFor(db, { characterId: 'nope', budgetSec: 3000, missions: MISSIONS }).reason, 'NO_VIDEOS_FOR_CHARACTER');
});

test('planFor 는 미션이 없는 시리즈에서도 편성한다', () => {
  // 미션 없음은 실패가 아니다. 앱이 mission === null 을 분기해야 한다.
  const db = seedForPlan(openDb(':memory:'), { videos: 2, durationSec: 60 });
  const r = planFor(db, { characterId: 'teenieping', budgetSec: 300, missions: [] });
  assert.equal(r.ok, true);
  assert.equal(r.plan.mission, null);
  assert.ok(!r.plan.items.some((i) => i.kind === 'mission'));
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
