import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getLibrary, getVideo, getSubtitles, upsertChild, startSession,
         endSession, addActivityResult, getReport } from './db.js';
import { planFor } from './session.js';
import { serveFile } from './media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STARY_PORT || 5056);
export const MEDIA_DIR = path.join(__dirname, 'media');
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

const db = openDb(path.join(__dirname, 'data', 'stary.db'));

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

class RequestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function readJson(req) {
  const chunks = [];
  let totalSize = 0;

  for await (const c of req) {
    totalSize += c.length;
    if (totalSize > MAX_BODY_SIZE) {
      throw new RequestError(413, 'request body too large');
    }
    chunks.push(c);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health') return json(res, 200, { ok: true });

    if (url.pathname.startsWith('/media/')) {
      const rel = decodeURIComponent(url.pathname.slice('/media/'.length));
      const file = path.join(MEDIA_DIR, rel);
      // Keep a crafted path from escaping the media directory.
      if (!file.startsWith(MEDIA_DIR + path.sep)) return json(res, 400, { error: 'bad path' });
      return serveFile(req, res, file);
    }

    if (url.pathname === '/library') return json(res, 200, getLibrary(db));

    // 오늘 한 회분 편성. 부모가 정한 총량 안에서 영상 몇 편과 그 사이 브레이크, 마지막
    // 미션 카드까지 정해 돌려준다.
    //   GET /plan?character_id=teenieping&child_id=c_x&budget_sec=1800
    // budget_sec 을 주지 않으면 아이에게 등록된 daily_limit_min 을 쓴다.
    if (url.pathname === '/plan') {
      const characterId = url.searchParams.get('character_id');
      if (!characterId) return json(res, 400, { error: 'character_id required' });
      const childId = url.searchParams.get('child_id');

      let budgetSec = Number(url.searchParams.get('budget_sec'));
      if (!Number.isFinite(budgetSec) || budgetSec <= 0) {
        const child = childId
          ? db.prepare('SELECT daily_limit_min FROM child WHERE id = ?').get(childId)
          : null;
        budgetSec = (child?.daily_limit_min ?? 30) * 60;
      }

      const result = planFor(db, { childId, characterId, budgetSec });
      // 편성 실패는 서버 오류가 아니다. 왜 못 만들었는지 앱이 알아야 화면을 고를 수 있다.
      return result.ok
        ? json(res, 200, { ok: true, budgetSec, plan: result.plan })
        : json(res, 200, { ok: false, budgetSec, reason: result.reason });
    }

    const videoMatch = /^\/videos\/([^/]+)$/.exec(url.pathname);
    if (videoMatch) {
      const v = getVideo(db, decodeURIComponent(videoMatch[1]));
      return v ? json(res, 200, v) : json(res, 404, { error: 'no such video' });
    }

    const subsMatch = /^\/videos\/([^/]+)\/subtitles$/.exec(url.pathname);
    if (subsMatch) return json(res, 200, getSubtitles(db, decodeURIComponent(subsMatch[1])));

    if (url.pathname === '/children' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.name) return json(res, 400, { error: 'name required' });
      return json(res, 200, upsertChild(db, {
        name: b.name, age: Number(b.age ?? 5), daily_limit_min: Number(b.daily_limit_min ?? 30),
      }));
    }

    if (url.pathname === '/sessions' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.child_id) return json(res, 400, { error: 'child_id required' });
      if (!b.video_id) return json(res, 400, { error: 'video_id required' });
      return json(res, 200, startSession(db, { child_id: b.child_id, video_id: b.video_id }));
    }

    const sessionMatch = /^\/sessions\/(\d+)$/.exec(url.pathname);
    if (sessionMatch && req.method === 'PATCH') {
      const b = await readJson(req);
      const watchedSec = b.watched_sec ?? 0;
      const watchedNum = Number(watchedSec);
      if (!Number.isFinite(watchedNum) || watchedNum < 0) {
        return json(res, 400, { error: 'watched_sec must be a non-negative number' });
      }
      endSession(db, Number(sessionMatch[1]), watchedNum);
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/activity-results' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.session_id) return json(res, 400, { error: 'session_id required' });
      if (!b.activity_id) return json(res, 400, { error: 'activity_id required' });
      addActivityResult(db, b);
      return json(res, 200, { ok: true });
    }

    const reportMatch = /^\/children\/([^/]+)\/report$/.exec(url.pathname);
    if (reportMatch) return json(res, 200, getReport(db, decodeURIComponent(reportMatch[1])));

    json(res, 404, { error: 'not found' });
  } catch (err) {
    if (err instanceof RequestError) {
      return json(res, err.code, { error: err.message });
    }
    if (err instanceof URIError) {
      return json(res, 400, { error: 'bad request' });
    }
    console.error('Unhandled error:', err);
    return json(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`stary content server on http://0.0.0.0:${PORT}`);
});
