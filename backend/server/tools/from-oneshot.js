// oneshot 파이프라인이 만든 활동 JSON 을 DB 에 심는다.
//   node server/tools/from-oneshot.js <video_id> <activities.json> [--keep-draft]
//
// generate.js 는 서버가 파이프라인을 직접 부르는 경로다. 그쪽은 API 키가 필요하고
// 아직 실제 엔드포인트에 붙여본 적이 없다. 이 도구는 이미 만들어진 결과 파일을
// 읽어 심는다 — 사람이 활동을 손으로 고친 뒤 다시 넣을 때도 이 길을 쓴다.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, replaceActivities, setVideoStatus } from '../db.js';
import { toActivityRow } from '../activity-payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');

const [, , videoId, file, ...flags] = process.argv;
if (!videoId || !file) {
  console.error('usage: from-oneshot.js <video_id> <activities.json> [--keep-draft]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const activities = Array.isArray(raw) ? raw : raw.activities;
if (!Array.isArray(activities)) {
  console.error(`${file}: 활동 배열을 찾지 못했습니다 (최상위 배열이거나 activities 키가 있어야 합니다)`);
  process.exit(1);
}
if (activities.length === 0) {
  // 활동 0개를 ready 로 올리면 아이가 빈 영상을 본다.
  console.error(`${file}: 활동이 0개입니다`);
  process.exit(1);
}

const db = openDb(path.join(SERVER_DIR, 'data', 'stary.db'));
const video = db.prepare('SELECT id FROM video WHERE id = ?').get(videoId);
if (!video) {
  console.error(`no video ${videoId} — 먼저 ingest.js 로 등록하세요`);
  process.exit(1);
}

let rows;
try {
  rows = activities.map(toActivityRow);
} catch (err) {
  // 색 이름을 모르는 경우 등. 틀린 화면을 아이에게 내보내지 않는다.
  console.error(`변환 실패: ${err.message}`);
  process.exit(1);
}

replaceActivities(db, videoId, rows);
if (!flags.includes('--keep-draft')) setVideoStatus(db, videoId, 'ready');

const byType = rows.reduce((acc, r) => ({ ...acc, [r.type]: (acc[r.type] || 0) + 1 }), {});
console.log(`${videoId}: 활동 ${rows.length}개 (${JSON.stringify(byType)})`);
console.log(rows.map((r) => `  ${r.at_sec}s ${r.payload.activity_template ?? r.type}`).join('\n'));
console.log(flags.includes('--keep-draft') ? 'status=draft (그대로 둠)' : 'status=ready');
