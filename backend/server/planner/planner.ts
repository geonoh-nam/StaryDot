/**
 * 스크린타임 세션 편성 알고리즘.
 *
 * 부수효과 없는 순수 모듈이다. Expo 앱 내부에서도, Node 서버 API로도
 * 코드 변경 없이 동작한다.
 *
 * 설계: docs/superpowers/specs/2026-08-25-screentime-session-planner-design.md
 */

// ---------------------------------------------------------------- 상수

export const QUIZ_SEC = 40
export const MISSION_CARD_SEC = 20
export const QUIZ_ITEMS_PER_BREAK = 2
export const MAX_VIDEOS = 5
export const K_ATTEMPTS = 200
export const BAND_SEC = 90
export const RECENT_SESSIONS = 2

// ---------------------------------------------------------------- 타입

export type QuizItem = {
  id: string
  question: string
  choices: string[]
  answerIndex: number
}

export type Video = {
  id: string
  characterIds: string[]
  durationSec: number
  title: string
  quizItems: QuizItem[]
}

export type MissionCard = {
  id: string
  characterIds: string[]
  title: string
  description: string
}

export type WatchHistory = {
  /** 최신순 정렬 */
  recentSessions: {
    videoIds: string[]
    missionId: string | null
  }[]
}

export type PlanItem =
  | { kind: 'video'; video: Video }
  | { kind: 'quiz'; videoId: string; items: QuizItem[] }
  | { kind: 'mission'; mission: MissionCard }

export type SessionPlan = {
  items: PlanItem[]
  videoIds: string[]
  /** 캐릭터에 등록된 미션이 없으면 null. 호출부가 반드시 분기해야 한다. */
  mission: MissionCard | null
  plannedTotalSec: number
  underrunSec: number
}

export type PlanFailureReason =
  | 'BUDGET_TOO_SMALL'
  | 'NO_VIDEOS_FOR_CHARACTER'
  | 'CATALOG_EXHAUSTED'

export type PlanResult =
  | { ok: true; plan: SessionPlan }
  | { ok: false; reason: PlanFailureReason }

export type PlanInput = {
  budgetSec: number
  characterId: string
  catalog: Video[]
  missions: MissionCard[]
  history: WatchHistory
  rng?: () => number
  scoreVideo?: (video: Video, history: WatchHistory) => number
  /** 미지정 시 BAND_SEC. 튜닝 측정용으로만 덮어쓴다. */
  bandSec?: number
}

// ---------------------------------------------------------------- 시간 회계

/**
 * 영상 k편을 편성했을 때의 총 스크린타임.
 *
 * 퀴즈 개수는 영상 개수에 종속된다 — 영상을 하나 더 넣으면 퀴즈도 하나 늘어
 * 예산이 두 번 깎인다. 고정 용량 배낭문제가 아니라 선택 개수에 따라 유효 용량이
 * 변하는 문제인 이유다. 이 공식은 알고리즘 전체에서 단 하나의 출처여야 한다.
 *
 * 브레이크는 **문항이 있는 영상마다 하나씩** 붙는다. 마지막 영상도 예외가 아니다 —
 * 방금 본 것을 묻지 않고 넘어가면 그 영상은 아이에게 아무것도 남기지 않는다.
 * 그래서 편수가 아니라 '문항을 가진 편수' 를 센다. buildPlan 이 실제로 만드는
 * 브레이크 수와 정확히 같아야 예산이 어긋나지 않는다.
 */
export function totalSec(videos: Video[]): number {
  if (videos.length === 0) return 0
  const sum = videos.reduce((acc, v) => acc + v.durationSec, 0)
  const breaks = videos.filter((v) => v.quizItems.length > 0).length
  return sum + breaks * QUIZ_SEC + MISSION_CARD_SEC
}

// ---------------------------------------------------------------- 개인화 훅

/**
 * 셔플 가중치. MVP에서는 상수를 반환한다.
 *
 * 데이터가 쌓이면 이 함수만 교체하면 개인화가 반영되며, 알고리즘 본체는
 * 손댈 필요가 없다.
 */
export function scoreVideo(_video: Video, _history: WatchHistory): number {
  return 1
}

// ---------------------------------------------------------------- 내부 유틸

/** Efraimidis-Spirakis 가중 표본추출. 가중치가 모두 같으면 균등 셔플과 동일하다. */
function weightedShuffle<T>(
  items: T[],
  weight: (item: T) => number,
  rng: () => number,
): T[] {
  return items
    .map((item) => ({
      item,
      key: Math.pow(rng(), 1 / Math.max(weight(item), 1e-9)),
    }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item)
}

function pickOne<T>(items: T[], rng: () => number): T {
  // rng()가 1.0을 반환해도 인덱스가 벗어나지 않도록 막는다.
  return items[Math.min(Math.floor(rng() * items.length), items.length - 1)]
}

/** 최근 `sessions`개 세션에서 시청한 영상 ID. sessions=0이면 빈 집합. */
function recentVideoIds(history: WatchHistory, sessions: number): Set<string> {
  const ids = new Set<string>()
  for (const session of history.recentSessions.slice(0, sessions)) {
    for (const id of session.videoIds) ids.add(id)
  }
  return ids
}

/**
 * 랜덤 그리디 best-of-K.
 *
 * 정확한 DP로 최적해를 구할 수도 있으나 쓰지 않는다. 최적해는 결정적이라
 * 같은 캐릭터 + 같은 예산이면 매일 똑같은 조합이 나오기 때문이다.
 * 언더슛은 예산을 넘지 않는 방향의 오차이므로 근사로 충분하다.
 */
function search(
  candidates: Video[],
  budgetSec: number,
  weight: (v: Video) => number,
  rng: () => number,
): Video[][] {
  const plans: Video[][] = []
  for (let attempt = 0; attempt < K_ATTEMPTS; attempt++) {
    const pool = weightedShuffle(candidates, weight, rng)
    const chosen: Video[] = []
    for (const video of pool) {
      if (chosen.length >= MAX_VIDEOS) break
      if (totalSec([...chosen, video]) <= budgetSec) chosen.push(video)
    }
    if (chosen.length > 0) plans.push(chosen)
  }
  return plans
}

/**
 * 밴드 내 무작위 추출 — 다양성의 핵심.
 *
 * argmin으로 최선 하나를 고르면 K를 키울수록 오히려 같은 답이 확실해진다.
 * 탐색을 열심히 할수록 다양성이 죽는 구조라 선택 단계에도 무작위성을 넣는다.
 *
 * 중복 제거가 반드시 선행되어야 한다. K회 중 50번 발견된 조합과 1번 발견된
 * 조합을 그대로 섞어 뽑으면 "우연히 발견되기 쉬운 조합"이 50배 유리해진다.
 */
function pickFromBand(
  plans: Video[][],
  budgetSec: number,
  bandSec: number,
  rng: () => number,
): Video[] {
  const scored = plans.map((plan) => ({
    plan,
    underrun: budgetSec - totalSec(plan),
  }))
  const best = Math.min(...scored.map((s) => s.underrun))

  const unique = new Map<string, Video[]>()
  for (const s of scored) {
    if (s.underrun > best + bandSec) continue
    const key = s.plan
      .map((v) => v.id)
      .sort()
      .join('|')
    if (!unique.has(key)) unique.set(key, s.plan)
  }
  return pickOne([...unique.values()], rng)
}

function pickMission(
  missions: MissionCard[],
  characterId: string,
  history: WatchHistory,
  rng: () => number,
): MissionCard | null {
  const pool = missions.filter((m) => m.characterIds.includes(characterId))
  if (pool.length === 0) return null

  const recent = new Set(
    history.recentSessions
      .slice(0, RECENT_SESSIONS)
      .map((s) => s.missionId)
      .filter((id): id is string => id !== null),
  )
  const fresh = pool.filter((m) => !recent.has(m.id))
  return pickOne(fresh.length > 0 ? fresh : pool, rng)
}

/**
 * 영상을 길이 내림차순으로 배치하고 활동을 끼운다.
 *
 * 뒤로 갈수록 짧아져 세션이 자연스럽게 줄어드는 느낌을 주고, 마지막 영상이
 * 짧아 종료 시 상실감이 적다.
 *
 * 영상이 끝날 때마다 그 영상에서 나온 문항을 낸다. **마지막 영상 뒤에도 낸다** —
 * 아이가 마지막으로 본 것이 늘 질문 없이 지나가면 안 된다. 그 뒤에 미션 카드가 온다.
 *
 * 퀴즈 문항이 없는 영상 뒤에는 브레이크를 만들지 않는다. totalSec 도 같은 기준으로
 * 세므로 예산은 어긋나지 않는다.
 */
function buildPlan(
  videos: Video[],
  mission: MissionCard | null,
  budgetSec: number,
): SessionPlan {
  const ordered = [...videos].sort((a, b) => b.durationSec - a.durationSec)
  const items: PlanItem[] = []

  ordered.forEach((video) => {
    items.push({ kind: 'video', video })
    if (video.quizItems.length > 0) {
      items.push({
        kind: 'quiz',
        videoId: video.id,
        items: video.quizItems.slice(0, QUIZ_ITEMS_PER_BREAK),
      })
    }
  })

  if (mission) items.push({ kind: 'mission', mission })

  const plannedTotalSec = totalSec(ordered)
  return {
    items,
    videoIds: ordered.map((v) => v.id),
    mission,
    plannedTotalSec,
    underrunSec: budgetSec - plannedTotalSec,
  }
}

// ---------------------------------------------------------------- 진입점

export function planSession(input: PlanInput): PlanResult {
  const rng = input.rng ?? Math.random
  const score = input.scoreVideo ?? scoreVideo
  const { budgetSec, characterId, catalog, missions, history } = input

  const byCharacter = catalog.filter((v) => v.characterIds.includes(characterId))
  if (byCharacter.length === 0) return { ok: false, reason: 'NO_VIDEOS_FOR_CHARACTER' }

  const shortest = Math.min(...byCharacter.map((v) => v.durationSec))
  if (budgetSec < shortest + MISSION_CARD_SEC) {
    return { ok: false, reason: 'BUDGET_TOO_SMALL' }
  }

  // 최근 시청 제외가 다양성의 실제 주력이다. 어제의 조합을 물리적으로
  // 구성 불가능하게 만든다. 조합이 아예 안 나올 때만 단계적으로 완화한다 —
  // 아예 못 트는 것보다 반복 시청이 낫다.
  for (const excludeSessions of [RECENT_SESSIONS, 1, 0]) {
    const excluded = recentVideoIds(history, excludeSessions)
    const candidates = byCharacter.filter((v) => !excluded.has(v.id))
    if (candidates.length === 0) continue

    const plans = search(candidates, budgetSec, (v) => score(v, history), rng)
    if (plans.length === 0) continue

    const chosen = pickFromBand(plans, budgetSec, input.bandSec ?? BAND_SEC, rng)
    const mission = pickMission(missions, characterId, history, rng)
    return { ok: true, plan: buildPlan(chosen, mission, budgetSec) }
  }

  return { ok: false, reason: 'CATALOG_EXHAUSTED' }
}
