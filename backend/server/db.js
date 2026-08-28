import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS category (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS video (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES category(id),
  title        TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  file_path    TEXT NOT NULL,
  thumb_path   TEXT,
  emoji        TEXT,
  color        TEXT,
  status       TEXT NOT NULL,
  crop_bottom  REAL NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subtitle (
  id       INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES video(id),
  idx      INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms   INTEGER NOT NULL,
  text     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS subtitle_video_time ON subtitle(video_id, start_ms);
CREATE TABLE IF NOT EXISTS activity (
  id       INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES video(id),
  at_sec   INTEGER NOT NULL,
  type     TEXT NOT NULL,
  payload  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_video_time ON activity(video_id, at_sec);
CREATE TABLE IF NOT EXISTS child (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  age             INTEGER NOT NULL,
  daily_limit_min INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS child_name_age ON child(name, age);
CREATE TABLE IF NOT EXISTS session (
  id          INTEGER PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES child(id),
  video_id    TEXT NOT NULL REFERENCES video(id),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  watched_sec INTEGER
);
CREATE INDEX IF NOT EXISTS session_child_time ON session(child_id, started_at);
-- 한 번의 편성(영상 여러 편 + 미션 카드 하나)이 무엇이었는지. 편성기의 다양성 규칙이
-- "어제 본 조합"을 물리적으로 다시 못 만들게 하려면 세션이 아니라 편성 단위로 남아야 한다.
CREATE TABLE IF NOT EXISTS plan_session (
  id         INTEGER PRIMARY KEY,
  child_id   TEXT NOT NULL REFERENCES child(id),
  video_ids  TEXT NOT NULL,
  mission_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plan_session_child_time ON plan_session(child_id, created_at);
CREATE TABLE IF NOT EXISTS activity_result (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES session(id),
  activity_id  INTEGER NOT NULL REFERENCES activity(id),
  result       TEXT NOT NULL,
  drawing_path TEXT,
  latency_ms   INTEGER,
  created_at   INTEGER NOT NULL
);
`;

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// CREATE TABLE IF NOT EXISTS leaves an existing table alone, so a new column never
// reaches a DB that already has rows. Add it here instead of asking everyone to
// delete stary.db.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(video)').all().map((c) => c.name);
  if (!cols.includes('crop_bottom')) {
    db.exec('ALTER TABLE video ADD COLUMN crop_bottom REAL NOT NULL DEFAULT 0');
  }

  const rcols = db.prepare('PRAGMA table_info(activity_result)').all().map((c) => c.name);
  if (!rcols.includes('latency_ms')) {
    // 문항이 뜨고 아이가 처음 누르기까지 걸린 시간. 옛 행은 NULL 로 남는다.
    db.exec('ALTER TABLE activity_result ADD COLUMN latency_ms INTEGER');
  }
}

export function upsertCategory(db, { id, label, sort }) {
  db.prepare(
    `INSERT INTO category (id, label, sort) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, sort = excluded.sort`
  ).run(id, label, sort);
}

export function insertVideo(db, v) {
  db.prepare(
    `INSERT INTO video (id, category_id, title, duration_sec, file_path, thumb_path, emoji, color, status, crop_bottom, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       category_id = excluded.category_id, title = excluded.title,
       duration_sec = excluded.duration_sec, file_path = excluded.file_path,
       thumb_path = excluded.thumb_path, emoji = excluded.emoji, color = excluded.color,
       crop_bottom = excluded.crop_bottom`
  ).run(v.id, v.category_id, v.title, v.duration_sec, v.file_path, v.thumb_path ?? null,
        v.emoji ?? null, v.color ?? null, v.crop_bottom ?? 0, Date.now());
}

export function replaceSubtitles(db, videoId, cues) {
  db.prepare('DELETE FROM subtitle WHERE video_id = ?').run(videoId);
  const insert = db.prepare('INSERT INTO subtitle (video_id, idx, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)');
  for (const c of cues) insert.run(videoId, c.idx, c.start_ms, c.end_ms, c.text);
}

export function getSubtitles(db, videoId) {
  return db.prepare('SELECT idx, start_ms, end_ms, text FROM subtitle WHERE video_id = ? ORDER BY start_ms').all(videoId);
}

export function replaceActivities(db, videoId, rows) {
  db.prepare('DELETE FROM activity WHERE video_id = ?').run(videoId);
  const insert = db.prepare('INSERT INTO activity (video_id, at_sec, type, payload) VALUES (?, ?, ?, ?)');
  for (const r of rows) insert.run(videoId, r.at_sec, r.type, JSON.stringify(r.payload));
}

export function setVideoStatus(db, videoId, status) {
  db.prepare('UPDATE video SET status = ? WHERE id = ?').run(status, videoId);
}

export function getLibrary(db) {
  const cats = db.prepare('SELECT id, label FROM category ORDER BY sort, id').all();
  const videos = db.prepare(
    `SELECT id, category_id, title, duration_sec, emoji, color, thumb_path, file_path
     FROM video WHERE status = 'ready' ORDER BY created_at`
  ).all();
  return cats
    .map((c) => ({
      id: c.id,
      label: c.label,
      videos: videos
        .filter((v) => v.category_id === c.id)
        .map((v) => ({
          id: v.id, title: v.title, duration_sec: v.duration_sec,
          emoji: v.emoji, color: v.color,
          thumbPath: v.thumb_path ? `/media/${v.thumb_path}` : null,
          // The app streams from here rather than from a copy pushed onto the tablet.
          videoPath: v.file_path ? `/media/${v.file_path}` : null,
        })),
    }))
    .filter((c) => c.videos.length > 0);
}

export function getVideo(db, id) {
  const v = db.prepare('SELECT id, title, duration_sec, file_path FROM video WHERE id = ?').get(id);
  if (!v) return null;
  const acts = db.prepare('SELECT id, at_sec, type, payload FROM activity WHERE video_id = ? ORDER BY at_sec').all(id);
  return {
    id: v.id,
    title: v.title,
    duration_sec: v.duration_sec,
    videoPath: `/media/${v.file_path}`,
    activities: acts.map((a) => ({ id: a.id, at: a.at_sec, type: a.type, payload: JSON.parse(a.payload) })),
  };
}

export function upsertChild(db, { name, age, daily_limit_min }) {
  const found = db.prepare('SELECT id FROM child WHERE name = ? AND age = ?').get(name, age);
  if (found) {
    db.prepare('UPDATE child SET daily_limit_min = ? WHERE id = ?').run(daily_limit_min, found.id);
    return { id: found.id };
  }
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO child (id, name, age, daily_limit_min, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, age, daily_limit_min, Date.now());
  return { id };
}

export function startSession(db, { child_id, video_id }) {
  const info = db.prepare('INSERT INTO session (child_id, video_id, started_at) VALUES (?, ?, ?)')
    .run(child_id, video_id, Date.now());
  return { id: Number(info.lastInsertRowid) };
}

export function endSession(db, id, watchedSec) {
  db.prepare('UPDATE session SET ended_at = ?, watched_sec = ? WHERE id = ?').run(Date.now(), watchedSec, id);
}

export function addActivityResult(db, { session_id, activity_id, result, drawing_path, latency_ms }) {
  db.prepare(
    'INSERT INTO activity_result (session_id, activity_id, result, drawing_path, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(session_id, activity_id, result, drawing_path ?? null, latency_ms ?? null, Date.now());
}

export function getReport(db, childId) {
  const totals = db.prepare(
    `SELECT COALESCE(SUM(watched_sec), 0) AS watched_sec, COUNT(*) AS videos
     FROM session WHERE child_id = ? AND ended_at IS NOT NULL`
  ).get(childId);

  const counts = db.prepare(
    `SELECT a.type AS type, r.result AS result, COUNT(*) AS n
     FROM activity_result r
     JOIN session s ON s.id = r.session_id
     JOIN activity a ON a.id = r.activity_id
     WHERE s.child_id = ?
     GROUP BY a.type, r.result`
  ).all(childId);

  const sum = (fn) => counts.filter(fn).reduce((n, row) => n + row.n, 0);

  const recent = db.prepare(
    `SELECT s.video_id, v.title, s.started_at, s.watched_sec
     FROM session s JOIN video v ON v.id = s.video_id
     WHERE s.child_id = ? AND s.ended_at IS NOT NULL
     ORDER BY s.started_at DESC LIMIT 10`
  ).all(childId);

  return {
    watched_sec: totals.watched_sec,
    videos: totals.videos,
    quiz_correct: sum((r) => r.type === 'quiz' && r.result === 'correct'),
    drawing: sum((r) => (r.type === 'trace' || r.type === 'color') && r.result === 'done'),
    skip: sum((r) => r.result === 'skip'),
    recent,
  };
}


// ---------------------------------------------------------------- 세션 편성

// 편성기가 고를 수 있는 영상 전부와, 각 영상이 낼 수 있는 문항.
//
// characterId 는 카테고리 id 다 (teenieping·tayo·…). 아이가 고른 시리즈 안에서만 편성한다.
// 문항이 0개인 영상도 카탈로그에는 남긴다 — 편성은 되지만 그 뒤에 브레이크가 안 붙을 뿐이다.
// 문항 payload 의 age 는 "3세" 같은 문자열이다. 누리과정 만 나이라 child.age 와 같은 척도다.
function ageOf(payload) {
  const m = /\d+/.exec(payload?.age ?? '');
  return m ? Number(m[0]) : null;
}


/**
 * 편성기가 읽을 카탈로그.
 *
 * childAge 를 주면 **그 나이가 아직 감당 못 하는 문항을 빼고** 돌려준다. 문항의 age 는
 * 어휘가 정한 하한이다(observe.py 의 WORD_AGE) — "갈색 액자가 몇 개" 는 액자를 아는
 * 나이여야 풀린다. 거르는 자리를 여기로 둔 이유는, 편성기의 시간 회계가 "문항을 가진
 * 영상"만 세기 때문이다. 걸러진 결과를 그대로 넘겨야 예산과 실제 화면이 어긋나지 않는다.
 */
export function getCatalog(db, { childAge = null } = {}) {
  const videos = db.prepare(
    `SELECT id, category_id, title, duration_sec, file_path, thumb_path, color
     FROM video WHERE status = 'ready' ORDER BY created_at`
  ).all();
  const acts = db.prepare(
    `SELECT id, video_id, at_sec, payload FROM activity WHERE type = 'quiz' ORDER BY video_id, at_sec`
  ).all();

  const byVideo = new Map();
  for (const a of acts) {
    let payload;
    try {
      payload = JSON.parse(a.payload);
    } catch (e) {
      continue; // 못 읽는 행 하나 때문에 카탈로그 전체를 잃지 않는다
    }
    if (!Array.isArray(payload.options) || payload.answer == null) continue;
    const qAge = ageOf(payload);
    // age 를 못 읽는 문항은 거르지 않는다 — 판단 근거가 없는데 버리면 조용히 사라진다.
    if (childAge != null && qAge != null && qAge > childAge) continue;
    const list = byVideo.get(a.video_id) || [];
    list.push({
      age: qAge,
      // 편성기(planner.ts)가 읽는 네 칸.
      id: String(a.id),
      question: payload.title,
      choices: payload.options.map((o) => o.label),
      answerIndex: payload.options.findIndex((o) => o.label === payload.answer),
      // 앱이 그대로 그리는 원본. 편성기는 건드리지 않는다.
      activityId: a.id,
      atSec: a.at_sec,
      payload,
    });
    byVideo.set(a.video_id, list);
  }

  return videos.map((v) => ({
    id: v.id,
    characterIds: [v.category_id],
    durationSec: v.duration_sec,
    title: v.title,
    // 감당 가능한 것 중 **가장 어려운 것부터**. 브레이크는 두 문항만 싣기 때문에,
    // 다섯 살에게 세 살 문항만 돌아가는 일을 막으려면 여기서 순서를 정해야 한다.
    quizItems: (byVideo.get(v.id) || []).slice().sort((x, y) => (y.age ?? 0) - (x.age ?? 0)),
    // 편성 결과를 앱이 바로 재생할 수 있게 붙여 보낸다.
    videoPath: v.file_path ? `/media/${v.file_path}` : null,
    thumbPath: v.thumb_path ? `/media/${v.thumb_path}` : null,
    color: v.color,
  }));
}

export function getWatchHistory(db, childId, limit) {
  const rows = db.prepare(
    `SELECT video_ids, mission_id FROM plan_session
     WHERE child_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(childId, limit);
  return {
    recentSessions: rows.map((r) => ({
      videoIds: JSON.parse(r.video_ids),
      missionId: r.mission_id ?? null,
    })),
  };
}

export function recordPlanSession(db, { child_id, video_ids, mission_id }) {
  const info = db.prepare(
    'INSERT INTO plan_session (child_id, video_ids, mission_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(child_id, JSON.stringify(video_ids), mission_id ?? null, Date.now());
  return { id: Number(info.lastInsertRowid) };
}
