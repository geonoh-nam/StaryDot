// storydot 파이프라인의 work/ 폴더 하나를 앱이 바로 트는 라이브러리로 만든다.
//
//   node tools/seed-from-work.js ../../work --video-dir ~/Downloads
//   node tools/seed-from-work.js ../../work --placeholder ~/Downloads/test_video.mp4
//
// 작품마다 두 파일을 읽는다.
//   <작품>_plan.json   길이와 원본 영상 경로
//   <작품>_final.json  마무리 활동 (generate3.py)
//
// 작품 이름과 앱 시리즈를 잇는 표는 work-manifest.json 이다. 여기서 이름을 추측하지 않는다 —
// 잘못 이어 붙은 영상은 조용히 틀린 시리즈에 들어가고, 그걸 알아채는 사람이 없다.
//
// --placeholder 는 원본 mp4 가 없을 때 쓴다. 길이는 plan.json 의 실측값을 그대로 넣으므로
// 편성 계산은 진짜지만 재생되는 화면은 대역이다. 데모·배선 점검용이다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, upsertCategory, insertVideo, replaceActivities, setVideoStatus } from '../db.js';
import { toStorydotRow } from '../activity-payload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const MEDIA_DIR = path.join(SERVER_DIR, 'media');

const [, , workArg, ...rest] = process.argv;
if (!workArg) {
  console.error('usage: seed-from-work.js <work-dir> [--video-dir <dir>] [--placeholder <file.mp4>]');
  process.exit(1);
}
const opt = {};
for (let i = 0; i < rest.length; i += 2) {
  if (!rest[i].startsWith('--') || rest[i + 1] === undefined) {
    console.error(`error: bad flag near "${rest[i]}"`);
    process.exit(1);
  }
  opt[rest[i].replace(/^--/, '')] = rest[i + 1];
}
const expand = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const WORK = path.resolve(expand(workArg));
const manifest = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'work-manifest.json'), 'utf8'));

for (const sub of ['video', 'thumb', 'frame']) {
  fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
}

const db = openDb(path.join(SERVER_DIR, 'data', 'stary.db'));

// 원본 영상을 찾는다. plan.json 에 적힌 경로가 첫 번째다 — 다른 기계에서 돌린 결과면
// 그 경로는 없으므로 --video-dir 과 --placeholder 로 차례로 내려간다.
function findVideo(planVideoPath, work) {
  if (planVideoPath && fs.existsSync(planVideoPath)) return { file: planVideoPath, real: true };
  const dir = expand(opt['video-dir']);
  if (dir) {
    for (const ext of ['.mp4', '.mkv', '.mov']) {
      const guess = path.join(dir, work + ext);
      if (fs.existsSync(guess)) return { file: guess, real: true };
    }
  }
  const ph = expand(opt.placeholder);
  if (ph && fs.existsSync(ph)) return { file: ph, real: false };
  return null;
}

function ffmpegThumb(videoFile, at, outPath) {
  try {
    execFileSync('ffmpeg', ['-y', '-ss', String(at), '-i', videoFile, '-frames:v', '1',
                            '-vf', 'scale=480:-1', outPath], { stdio: 'ignore' });
    return fs.statSync(outPath).size > 0;
  } catch {
    return false;
  }
}

let seeded = 0;
const skipped = [];

for (const ep of manifest.episodes) {
  const planFile = path.join(WORK, `${ep.work}_plan.json`);
  const finalFile = path.join(WORK, `${ep.work}_final.json`);
  if (!fs.existsSync(planFile) || !fs.existsSync(finalFile)) {
    skipped.push([ep.work, `${fs.existsSync(planFile) ? '_final.json' : '_plan.json'} 이 없다`]);
    continue;
  }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const activities = JSON.parse(fs.readFileSync(finalFile, 'utf8')).activities || [];

  const found = findVideo(plan.video, ep.work);
  if (!found) {
    skipped.push([ep.work, '영상 파일을 못 찾았다 (--video-dir 이나 --placeholder 를 주세요)']);
    continue;
  }

  // 문항부터 만든다. 하나도 못 만들면 영상을 등록하지 않는다 — 퀴즈 없는 영상은
  // 편성기가 골라도 브레이크가 안 붙어 아이가 그냥 계속 보게 된다.
  const rows = [];
  const dropped = [];
  for (const a of activities) {
    if (a.answer == null || !Array.isArray(a.choices)) {
      dropped.push([a.fact_id ?? '?', a.type, '창의 문항 — 선택지가 없다']);
      continue;
    }
    if (!a.frame || !fs.existsSync(a.frame)) {
      dropped.push([a.fact_id ?? '?', a.type, '프레임 파일이 없다']);
      continue;
    }
    const rel = `frame/${ep.id}-${String(Math.round(a.t)).padStart(6, '0')}${path.extname(a.frame)}`;
    fs.copyFileSync(a.frame, path.join(MEDIA_DIR, rel));
    try {
      rows.push(toStorydotRow(a, `/media/${rel}`));
    } catch (err) {
      dropped.push([a.fact_id ?? '?', a.type, err.message]);
    }
  }
  if (rows.length === 0) {
    skipped.push([ep.work, '실을 수 있는 문항이 0개다']);
    continue;
  }

  const videoRel = `video/${ep.id}${path.extname(found.file)}`;
  fs.copyFileSync(found.file, path.join(MEDIA_DIR, videoRel));

  // 썸네일은 첫 문항의 근거 프레임에서 뜬다. 대역 영상일 때도 그 작품의 그림이 걸린다.
  const thumbRel = `thumb/${ep.id}.jpg`;
  const firstFrame = activities.find((a) => a.frame && fs.existsSync(a.frame))?.frame;
  let hasThumb = false;
  if (firstFrame) {
    fs.copyFileSync(firstFrame, path.join(MEDIA_DIR, thumbRel));
    hasThumb = true;
  } else {
    hasThumb = ffmpegThumb(path.join(MEDIA_DIR, videoRel), 3, path.join(MEDIA_DIR, thumbRel));
  }

  upsertCategory(db, { id: ep.category, label: ep.label, sort: ep.sort ?? 0 });
  insertVideo(db, {
    id: ep.id,
    category_id: ep.category,
    title: ep.title,
    // 편성 계산의 근거는 파이프라인이 실측한 길이다. 대역 영상의 길이가 아니다.
    duration_sec: Math.round(plan.duration),
    file_path: videoRel,
    thumb_path: hasThumb ? thumbRel : null,
    color: ep.color,
  });
  replaceActivities(db, ep.id, rows);
  setVideoStatus(db, ep.id, 'ready');
  seeded++;

  console.log(`${ep.id}  ${ep.title}  ${Math.round(plan.duration)}초  문항 ${rows.length}개${found.real ? '' : '  (영상은 대역)'}`);
  for (const r of rows) console.log(`    ${r.payload.activity_template} · 정답 ${r.payload.answer} · 근거 ${r.at_sec}s`);
  for (const [id, type, why] of dropped) console.log(`    버림 ${id} ${type}: ${why}`);
}

console.log(`\n${seeded}/${manifest.episodes.length} 편 등록`);
for (const [work, why] of skipped) console.log(`  건너뜀 ${work}: ${why}`);

// 편성기는 한 시리즈 안에서만 고르고, 브레이크는 **영상과 영상 사이**에만 붙는다.
// 그래서 시리즈에 영상이 한 편뿐이면 편성은 늘 1편이고 퀴즈는 한 번도 안 나온다.
// 문항을 아무리 잘 만들어도 화면에 뜨지 않으므로, 조용히 넘어가지 않고 여기서 말한다.
const thin = db.prepare(
  `SELECT c.id, c.label, COUNT(v.id) AS n FROM category c
   JOIN video v ON v.category_id = c.id AND v.status = 'ready'
   GROUP BY c.id HAVING n < 2`
).all();
if (thin.length) {
  console.log('\n⚠ 영상이 1편뿐인 시리즈 — 편성이 1편으로 끝나 브레이크(퀴즈)가 한 번도 안 나옵니다.');
  for (const t of thin) console.log(`  ${t.id} (${t.label}): ${t.n}편`);
  console.log('  같은 시리즈의 다른 화를 파이프라인에 돌려 work-manifest.json 에 더하세요.');
}

if (seeded === 0) process.exit(1);
