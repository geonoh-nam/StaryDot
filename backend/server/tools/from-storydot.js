// storydot 파이프라인이 만든 마무리 활동을 DB 에 심는다.
//   node tools/from-storydot.js <video_id> <work/<작품>_final.json>
//
// generate3.py 는 영상이 끝난 뒤 화면과 함께 낼 문항을 만든다. 문항마다 근거 프레임이
// 딸려 오므로 그 이미지를 media/frame/ 로 복사해 앱이 스트리밍할 수 있게 만든다.
//
// at_sec 은 프레임을 뜬 시각이다. 지금 편성에서는 재생 위치가 아니라 "이 문제가 영상의
// 어디를 근거로 하는가"의 기록으로만 쓰인다 — 영상 중간 개입을 다시 켤 때 그대로 쓸 수 있다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, replaceActivities, setVideoStatus } from '../db.js';
import { toStorydotRow } from '../activity-payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const MEDIA_DIR = path.join(SERVER_DIR, 'media');

const [, , videoId, file, ...flags] = process.argv;
if (!videoId || !file) {
  console.error('usage: from-storydot.js <video_id> <work/<작품>_final.json> [--keep-draft]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const activities = Array.isArray(raw) ? raw : raw.activities;
if (!Array.isArray(activities)) {
  console.error(`${file}: 활동 배열을 찾지 못했습니다 (최상위 배열이거나 activities 키가 있어야 합니다)`);
  process.exit(1);
}

const db = openDb(path.join(SERVER_DIR, 'data', 'stary.db'));
if (!db.prepare('SELECT id FROM video WHERE id = ?').get(videoId)) {
  console.error(`no video ${videoId} — 먼저 tools/ingest.js 로 등록하세요`);
  process.exit(1);
}

fs.mkdirSync(path.join(MEDIA_DIR, 'frame'), { recursive: true });

// 버린 것은 사유와 함께 남긴다. 재시도가 없는 구조라 이게 파이프라인을 고칠 유일한 신호다.
const dropped = [];
const rows = [];
for (const a of activities) {
  // 창의 문항(장면 감상·이어질 말 상상)은 정답이 없어 4지선다 화면에 못 넣는다.
  // 대신 말하기 활동(type:'say')으로 온다 — 버디가 질문을 읽어 주고 아이가 대답하며
  // 채점하지 않는다. 그 형태로 오지 않은 무정답 문항만 버린다.
  if (a.type !== 'say' && (a.answer == null || !Array.isArray(a.choices))) {
    dropped.push([a.fact_id ?? '?', a.type, '창의 문항 — 선택지도 say 형태도 아니다']);
    continue;
  }
  if (!a.frame || !fs.existsSync(a.frame)) {
    dropped.push([a.fact_id ?? '?', a.type, `프레임 파일이 없다 (${a.frame ?? '경로 없음'})`]);
    continue;
  }
  const rel = `frame/${videoId}-${String(Math.round(a.t)).padStart(6, '0')}${path.extname(a.frame)}`;
  fs.copyFileSync(a.frame, path.join(MEDIA_DIR, rel));
  try {
    rows.push(toStorydotRow(a, `/media/${rel}`));
  } catch (err) {
    dropped.push([a.fact_id ?? '?', a.type, err.message]);
  }
}

if (rows.length === 0) {
  // 문항 0개를 ready 로 올리면 편성기가 퀴즈 없는 영상을 고른다.
  console.error(`${file}: 실을 수 있는 문항이 0개입니다`);
  for (const [id, type, why] of dropped) console.error(`  버림 ${id} ${type}: ${why}`);
  process.exit(1);
}

replaceActivities(db, videoId, rows);
if (!flags.includes('--keep-draft')) setVideoStatus(db, videoId, 'ready');

console.log(`${videoId}: 문항 ${rows.length}개`);
for (const r of rows) console.log(`  ${r.payload.activity_template} · 정답 ${r.payload.answer} · 근거 ${r.at_sec}s`);
if (dropped.length) {
  console.log(`\n버림 ${dropped.length}개`);
  for (const [id, type, why] of dropped) console.log(`  ${id} ${type}: ${why}`);
}
console.log(flags.includes('--keep-draft') ? '\nstatus=draft (그대로 둠)' : '\nstatus=ready');
