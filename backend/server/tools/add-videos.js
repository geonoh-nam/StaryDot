// 영상을 로컬 DB 에 넣는다. 파이프라인을 안 돌린 영상도 넣을 수 있다.
//
//   node tools/add-videos.js                                  inbox/<시리즈>/ 를 통째로
//   node tools/add-videos.js ~/Videos/tayo --category tayo     폴더 하나
//   node tools/add-videos.js a.mp4 b.mp4 --category tayo       파일 몇 개
//
// 문항이 없어도 편성에는 들어간다. 편성기는 문항이 있는 영상 뒤에만 브레이크를 붙이므로,
// **영상을 먼저 채워 재생목록을 만들고 문항은 나중에 얹는** 순서가 성립한다.
// 나중에 그 영상의 문항을 얹을 때는 tools/from-storydot.js 를 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb, upsertCategory, insertVideo, setVideoStatus } from '../db.js';
import { probeDuration, grabThumb } from '../ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const MEDIA_DIR = path.join(SERVER_DIR, 'media');
const INBOX = path.join(SERVER_DIR, 'inbox');
const VIDEO_EXT = new Set(['.mp4', '.mkv', '.mov', '.m4v']);

const expand = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const argv = process.argv.slice(2);
const targets = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) { targets.push(expand(argv[i])); continue; }
  const val = argv[i + 1];
  if (val === undefined || val.startsWith('--')) {
    console.error(`error: ${argv[i]} 에 값이 없습니다`);
    process.exit(1);
  }
  opt[argv[i].replace(/^--/, '')] = val;
  i++;
}

// 시리즈 표시 이름과 색은 매니페스트가 이미 알고 있다. 두 번 적지 않는다.
const manifest = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'work-manifest.json'), 'utf8'));
const known = new Map(manifest.episodes.map((e) => [e.category, e]));

function videosIn(target) {
  const st = fs.statSync(target);
  if (!st.isDirectory()) return VIDEO_EXT.has(path.extname(target).toLowerCase()) ? [target] : [];
  return fs.readdirSync(target)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(target, f));
}

// 무엇을 어느 시리즈로 넣을지. 인자가 없으면 inbox/<시리즈>/ 의 폴더 이름이 시리즈다.
const jobs = [];
if (targets.length === 0) {
  if (!fs.existsSync(INBOX)) {
    fs.mkdirSync(INBOX, { recursive: true });
    console.log(`inbox 를 만들었습니다: ${INBOX}`);
    console.log('시리즈 이름으로 폴더를 만들고 영상을 넣은 뒤 다시 실행하세요.');
    console.log(`  예) ${path.join(INBOX, 'tayo')}/타요2화.mp4`);
    console.log(`  쓸 수 있는 시리즈: ${[...known.keys()].join(', ')}`);
    process.exit(0);
  }
  for (const dir of fs.readdirSync(INBOX)) {
    const full = path.join(INBOX, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of videosIn(full)) jobs.push({ file: f, category: dir });
  }
} else {
  if (!opt.category) {
    console.error('error: --category 를 주세요 (또는 인자 없이 실행해 inbox/<시리즈>/ 를 쓰세요)');
    console.error(`  쓸 수 있는 시리즈: ${[...known.keys()].join(', ')}`);
    process.exit(1);
  }
  for (const t of targets) for (const f of videosIn(t)) jobs.push({ file: f, category: opt.category });
}

if (jobs.length === 0) {
  console.log('넣을 영상이 없습니다.');
  process.exit(0);
}

for (const sub of ['video', 'thumb']) fs.mkdirSync(path.join(MEDIA_DIR, sub), { recursive: true });
const db = openDb(path.join(SERVER_DIR, 'data', 'stary.db'));

// 같은 파일을 두 번 넣어도 영상이 두 개가 되지 않도록, id 는 시리즈 + 파일 이름으로 정한다.
const slug = (s) => s.normalize('NFC').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase();

let added = 0;
const failed = [];

for (const job of jobs) {
  const meta = known.get(job.category);
  const base = path.basename(job.file);
  const id = `${job.category}-${slug(base)}`;
  try {
    const duration = probeDuration(job.file, opt.duration);
    const videoRel = `video/${id}${path.extname(job.file)}`;
    fs.copyFileSync(job.file, path.join(MEDIA_DIR, videoRel));

    const thumbRel = `thumb/${id}.jpg`;
    // 영상 한복판에서 뜬다. 앞 3초는 로고나 검은 화면일 때가 많다.
    const hasThumb = grabThumb(path.join(MEDIA_DIR, videoRel), Math.round(duration / 2), path.join(MEDIA_DIR, thumbRel));

    upsertCategory(db, {
      id: job.category,
      label: opt.label || meta?.label || job.category,
      sort: meta?.sort ?? 99,
    });
    insertVideo(db, {
      id,
      category_id: job.category,
      title: opt.title || base.normalize('NFC').replace(/\.[^.]+$/, ''),
      duration_sec: duration,
      file_path: videoRel,
      thumb_path: hasThumb ? thumbRel : null,
      color: opt.color || meta?.color || null,
    });
    // 편성기는 ready 만 본다. 문항이 없어도 재생목록에는 들어가야 한다.
    setVideoStatus(db, id, 'ready');
    added++;
    const quiz = db.prepare("SELECT COUNT(*) AS n FROM activity WHERE video_id = ? AND type = 'quiz'").get(id).n;
    console.log(`+ ${id}  ${Math.floor(duration / 60)}분 ${duration % 60}초  문항 ${quiz}개${hasThumb ? '' : '  (썸네일 없음)'}`);
  } catch (err) {
    failed.push([base, err.message]);
  }
}

console.log(`\n${added}편 등록`);
for (const [f, why] of failed) console.log(`  실패 ${f}: ${why}`);

const counts = db.prepare(
  `SELECT c.id, c.label, COUNT(v.id) AS n,
          SUM(CASE WHEN EXISTS (SELECT 1 FROM activity a WHERE a.video_id = v.id AND a.type='quiz') THEN 1 ELSE 0 END) AS withQuiz
   FROM category c JOIN video v ON v.category_id = c.id AND v.status = 'ready'
   GROUP BY c.id ORDER BY c.sort, c.id`
).all();
console.log('\n시리즈별 상태');
for (const c of counts) {
  const warn = c.n < 2 ? '   ⚠ 1편뿐이라 브레이크가 안 뜹니다' : '';
  console.log(`  ${c.id.padEnd(12)} ${c.n}편 (문항 있는 영상 ${c.withQuiz}편)${warn}`);
}
if (failed.length) process.exit(1);
