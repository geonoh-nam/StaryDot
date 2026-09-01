// DB 한 칸 ↔ 편성 알고리즘 한 칸을 잇는 자리.
//
// 편성 알고리즘(planner/planner.ts)은 부수효과가 없는 순수 모듈이다. DB 도 HTTP 도 모른다.
// 그 순수함을 지키려고 읽기·쓰기를 전부 여기로 모은다.
//
// 알고리즘 설계: docs/curri/2026-08-25-screentime-session-planner-design.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSession, RECENT_SESSIONS, QUIZ_SEC, QUIZ_ITEMS_PER_BREAK, MISSION_CARD_SEC }
  from './planner/planner.ts';
import { getCatalog, getWatchHistory, recordPlanSession } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 미션 카드는 사람이 쓴 오프라인 과제라 DB 가 아니라 파일에 산다. 고칠 때 서버를 재시작한다.
export function loadMissions(file = path.join(__dirname, 'missions.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 예산에 들어가야 하는 것은 화면을 보는 시간 전부다. 브레이크에 문항이 몇 개 붙는지는
// 편성기 상수가 정하므로, 그 상수를 다시 적지 않고 가져다 쓴다.
export const BREAK_SEC = QUIZ_SEC;

/**
 * 오늘 한 회분을 편성한다.
 *
 * 편성 결과를 곧바로 plan_session 에 남긴다. 아이가 중간에 그만두면 안 본 조합이 이력에
 * 들어가지만, 편성기는 조합이 안 나올 때 제외 규칙을 단계적으로 푼다 — 못 트는 일은 없다.
 * 반대로 남기지 않으면 새로고침할 때마다 같은 조합이 되돌아온다.
 */
export function planFor(db, { childId, characterId, budgetSec, missions = loadMissions(), rng }) {
  // 아이 나이는 어떤 문항을 낼 수 있는지를 정한다. 프로필에 나이가 없으면 거르지 않는다.
  const child = childId
    ? db.prepare('SELECT age FROM child WHERE id = ?').get(childId)
    : null;
  const catalog = getCatalog(db, { childAge: child?.age ?? null });
  const history = childId
    ? getWatchHistory(db, childId, RECENT_SESSIONS)
    : { recentSessions: [] };

  const result = planSession({ budgetSec, characterId, catalog, missions, history, rng });
  if (!result.ok) return result;

  const { plan } = result;
  if (childId) {
    recordPlanSession(db, {
      child_id: childId,
      video_ids: plan.videoIds,
      mission_id: plan.mission?.id ?? null,
    });
  }
  return { ok: true, plan: toWire(plan) };
}

// 앱이 그대로 재생할 수 있는 모양으로 편다. 편성기 타입을 앱 화면 사정에 맞춰 고치는 대신
// 경계에서 한 번 옮긴다 — 화면이 바뀌어도 알고리즘은 손댈 이유가 없다.
function toWire(plan) {
  return {
    items: plan.items.map((item) => {
      if (item.kind === 'video') {
        const v = item.video;
        return {
          kind: 'video',
          id: v.id,
          title: v.title,
          durationSec: v.durationSec,
          videoPath: v.videoPath,
          thumbPath: v.thumbPath,
          color: v.color,
        };
      }
      if (item.kind === 'quiz') {
        return {
          kind: 'quiz',
          videoId: item.videoId,
          // 문항 본문은 앱이 그리는 payload 를 그대로 넘긴다.
          items: item.items.map((q) => ({ activityId: q.activityId, ...q.payload })),
        };
      }
      return { kind: 'mission', mission: item.mission };
    }),
    videoIds: plan.videoIds,
    mission: plan.mission,
    plannedTotalSec: plan.plannedTotalSec,
    underrunSec: plan.underrunSec,
    budget: { breakSec: BREAK_SEC, itemsPerBreak: QUIZ_ITEMS_PER_BREAK, missionSec: MISSION_CARD_SEC },
  };
}
