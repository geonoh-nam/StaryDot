/**
 * 셀프체크. 프레임워크 없이 assert만 쓴다.
 *
 *   node --experimental-strip-types src/planner/planner.selfcheck.ts
 */

import assert from 'node:assert/strict'
import {
  planSession,
  totalSec,
  QUIZ_SEC,
  MISSION_CARD_SEC,
  MAX_VIDEOS,
  BAND_SEC,
  type MissionCard,
  type PlanInput,
  type Video,
  type WatchHistory,
} from './planner.ts'

// ---------------------------------------------------------------- 픽스처

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHAR = 'pororo'

function makeVideo(i: number, durationSec?: number): Video {
  return {
    id: `v${i}`,
    characterIds: [CHAR],
    // 4:00 ~ 12:00 사이 초 단위 임의값. 30초 격자로 만들면 실제 카탈로그에는
    // 없는 동점 조합이 양산되어 다양성이 과대평가된다.
    durationSec: durationSec ?? 240 + ((i * 149 + 37) % 481),
    title: `영상 ${i}`,
    quizItems: [
      { id: `q${i}a`, question: '무엇을 했나요?', choices: ['A', 'B'], answerIndex: 0 },
      { id: `q${i}b`, question: '누가 나왔나요?', choices: ['A', 'B'], answerIndex: 1 },
    ],
  }
}

const makeCatalog = (n: number) => Array.from({ length: n }, (_, i) => makeVideo(i))

const MISSIONS: MissionCard[] = Array.from({ length: 5 }, (_, i) => ({
  id: `m${i}`,
  characterIds: [CHAR],
  title: `미션 ${i}`,
  description: '오늘 본 장면을 그려보세요',
}))

const EMPTY_HISTORY: WatchHistory = { recentSessions: [] }

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    budgetSec: 1800,
    characterId: CHAR,
    catalog: makeCatalog(40),
    missions: MISSIONS,
    history: EMPTY_HISTORY,
    rng: mulberry32(1),
    ...over,
  }
}

// ---------------------------------------------------------------- 1. 시간 회계

{
  const v = [makeVideo(1, 300), makeVideo(2, 300), makeVideo(3, 300)]
  // 900 + 3*40 + 20 — 브레이크는 문항을 가진 영상마다 하나씩, 마지막 편 뒤에도 붙는다.
  assert.equal(totalSec(v), 900 + 3 * QUIZ_SEC + MISSION_CARD_SEC)
  assert.equal(totalSec([makeVideo(1, 300)]), 300 + QUIZ_SEC + MISSION_CARD_SEC)
  // 문항이 없는 영상은 브레이크를 만들지 않으므로 예산에도 잡히지 않는다.
  assert.equal(totalSec([{ ...makeVideo(1, 300), quizItems: [] }]), 300 + MISSION_CARD_SEC)
  assert.equal(totalSec([]), 0)
}

// ------------------------------------------- 2. 절대 불변식: 예산 초과 없음

{
  const rng = mulberry32(42)
  let planned = 0
  for (let i = 0; i < 1000; i++) {
    const size = 1 + Math.floor(rng() * 40)
    const budgetSec = 300 + Math.floor(rng() * 3300)
    const catalog = Array.from({ length: size }, (_, j) =>
      makeVideo(j, 120 + Math.floor(rng() * 780)),
    )
    const result = planSession(baseInput({ budgetSec, catalog, rng }))
    if (!result.ok) continue
    planned++
    assert.ok(
      result.plan.plannedTotalSec <= budgetSec,
      `예산 초과: ${result.plan.plannedTotalSec} > ${budgetSec}`,
    )
    assert.ok(result.plan.underrunSec >= 0)
    assert.ok(result.plan.videoIds.length <= MAX_VIDEOS)
    assert.equal(result.plan.plannedTotalSec + result.plan.underrunSec, budgetSec)
  }
  assert.ok(planned > 900, `유효 플랜이 너무 적다: ${planned}/1000`)
  console.log(`  예산 불변식      1000케이스 중 ${planned}건 편성, 초과 0건`)
}

// ---------------------------------------------------------------- 3. 다양성

function measure(input: PlanInput, runs = 100) {
  const counts = new Map<string, number>()
  for (let i = 0; i < runs; i++) {
    const result = planSession(input)
    assert.ok(result.ok)
    const key = [...result.plan.videoIds].sort().join('|')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return {
    unique: counts.size,
    topShare: Math.max(...counts.values()) / runs,
  }
}

{
  // 카탈로그가 작으면 조합 수 자체가 산수로 제한된다. 기준을 크기별로 나눈다.
  const thresholds = [
    { size: 40, minUnique: 12, maxTopShare: 0.3 },
    { size: 20, minUnique: 8, maxTopShare: 0.4 },
    { size: 8, minUnique: 3, maxTopShare: 0.6 },
  ]
  for (const t of thresholds) {
    const m = measure(baseInput({ catalog: makeCatalog(t.size), rng: mulberry32(7) }))
    console.log(
      `  다양성 ${String(t.size).padStart(2)}편      고유 ${String(m.unique).padStart(3)}종  최빈 ${(m.topShare * 100).toFixed(0)}%` +
        `  (기준 ≥${t.minUnique}, <${t.maxTopShare * 100}%)`,
    )
    assert.ok(m.unique >= t.minUnique, `고유 조합 부족: ${m.unique} < ${t.minUnique}`)
    assert.ok(m.topShare < t.maxTopShare, `최빈 조합 편중: ${m.topShare}`)
  }
}

{
  // 밴드가 실제로 일하는 구간은 소형 카탈로그다. 40편이면 조합 공간이 9만 개라
  // 200회 샘플링이 수렴하지 못해 argmin으로도 호출마다 답이 달라진다. 즉 밴드가
  // 없어도 다양성이 나온다. 큐레이션 DB는 작게 시작하므로 8편에서 검증한다.
  const small = { catalog: makeCatalog(8) }
  const off = measure(baseInput({ ...small, bandSec: 0, rng: mulberry32(7) }))
  const on = measure(baseInput({ ...small, bandSec: BAND_SEC, rng: mulberry32(7) }))

  // 최빈 비율이 아니라 고유 조합 수로 본다. 밴드를 끄면 argmin 이 사실상 한두 조합에
  // 고정되는데, 그 한두 개가 몇 대 몇으로 갈리는지는 밴드 설계와 무관하다.
  assert.ok(
    off.unique <= 3,
    `소형 카탈로그에서 밴드 0인데도 조합이 흩어진다면 밴드 설계의 전제가 틀린 것: 고유 ${off.unique}종`,
  )
  assert.ok(on.unique > off.unique * 3, '밴드가 다양성을 유의미하게 늘리지 못한다')
  console.log(
    `  밴드 대조군 8편  밴드0 → 고유 ${off.unique}종/최빈 ${(off.topShare * 100).toFixed(0)}%` +
      `   밴드${BAND_SEC} → 고유 ${on.unique}종/최빈 ${(on.topShare * 100).toFixed(0)}%`,
  )
}

// ------------------------------------------------------------ 4. 구조 검증

{
  const result = planSession(baseInput({ rng: mulberry32(3) }))
  assert.ok(result.ok)
  const { items, videoIds, mission } = result.plan

  const videos = items.filter((i) => i.kind === 'video')
  const quizzes = items.filter((i) => i.kind === 'quiz')
  const missions = items.filter((i) => i.kind === 'mission')

  assert.equal(videos.length, videoIds.length)
  assert.equal(quizzes.length, videos.length, '퀴즈 브레이크는 영상마다 하나')
  assert.equal(items.at(-2)?.kind, 'quiz', '마지막 영상 뒤에도 문항이 온다')
  assert.equal(missions.length, 1, '미션 카드는 정확히 1개')
  assert.equal(items.at(-1)?.kind, 'mission', '미션 카드는 항상 마지막')
  assert.ok(mission !== null)

  // 길이 내림차순
  const durations = videos.map((i) => (i.kind === 'video' ? i.video.durationSec : 0))
  for (let i = 1; i < durations.length; i++) {
    assert.ok(durations[i] <= durations[i - 1], `내림차순 위반: ${durations}`)
  }

  // 퀴즈는 직전 영상에서 온 것이어야 한다
  items.forEach((item, i) => {
    if (item.kind !== 'quiz') return
    const prev = items[i - 1]
    assert.ok(prev?.kind === 'video' && prev.video.id === item.videoId)
    assert.ok(item.items.length > 0)
    assert.ok(item.items.every((q) => prev.video.quizItems.includes(q)))
  })
}

// -------------------------------------------------------- 5. 실패 케이스

{
  const tooSmall = planSession(baseInput({ budgetSec: 100 }))
  assert.equal(tooSmall.ok, false)
  assert.equal(tooSmall.ok === false && tooSmall.reason, 'BUDGET_TOO_SMALL')

  const noChar = planSession(baseInput({ characterId: 'unknown' }))
  assert.equal(noChar.ok, false)
  assert.equal(noChar.ok === false && noChar.reason, 'NO_VIDEOS_FOR_CHARACTER')

  // 경계: 최단 영상 + 그 영상의 브레이크 + 미션 카드 시간이면 정확히 통과해야 한다.
  // 영상 한 편짜리 세션에도 문항이 붙으므로 최소 예산에 QUIZ_SEC 이 포함된다.
  const catalog = [makeVideo(1, 300)]
  const exact = planSession(
    baseInput({ catalog, budgetSec: 300 + QUIZ_SEC + MISSION_CARD_SEC }),
  )
  assert.ok(exact.ok)
  assert.equal(exact.plan.videoIds.length, 1)
  assert.equal(exact.plan.underrunSec, 0)
}

// ------------------------------------------------- 6. 최근 시청 제외와 완화

{
  const catalog = makeCatalog(40)
  const watched = ['v0', 'v1', 'v2', 'v3', 'v4', 'v5']
  const history: WatchHistory = {
    recentSessions: [
      { videoIds: watched.slice(0, 3), missionId: 'm0' },
      { videoIds: watched.slice(3), missionId: 'm1' },
    ],
  }
  const rng = mulberry32(11)
  for (let i = 0; i < 50; i++) {
    const result = planSession(baseInput({ catalog, history, rng }))
    assert.ok(result.ok)
    for (const id of result.plan.videoIds) {
      assert.ok(!watched.includes(id), `최근 시청 영상이 재등장: ${id}`)
    }
    // 최근 2회 미션도 제외된다
    assert.ok(!['m0', 'm1'].includes(result.plan.mission!.id))
  }
  console.log('  최근 시청 제외    50회 연속 재등장 0건')
}

{
  // 후보가 고갈되면 완화가 발동해야 한다 — 아예 못 트는 것보다 반복이 낫다.
  const catalog = makeCatalog(3)
  const history: WatchHistory = {
    recentSessions: [
      { videoIds: ['v0', 'v1', 'v2'], missionId: 'm0' },
      { videoIds: ['v0', 'v1', 'v2'], missionId: 'm1' },
    ],
  }
  const result = planSession(baseInput({ catalog, history }))
  assert.ok(result.ok, '완화 실패 — 카탈로그 고갈 시에도 편성되어야 한다')
  assert.ok(result.plan.videoIds.length > 0)
  console.log('  고갈 시 완화      정상 발동')
}

// ------------------------------------------- 7. 미션 없는 캐릭터 (조용한 실패 방지)

{
  const result = planSession(baseInput({ missions: [] }))
  assert.ok(result.ok)
  assert.equal(result.plan.mission, null, '미션이 없으면 null로 드러나야 한다')
  assert.ok(!result.plan.items.some((i) => i.kind === 'mission'))
}

// ------------------------------------------- 8. 퀴즈 없는 영상 (브레이크 생략)

{
  const catalog = makeCatalog(6).map((v) => ({ ...v, quizItems: [] }))
  const result = planSession(baseInput({ catalog }))
  assert.ok(result.ok)
  assert.equal(
    result.plan.items.filter((i) => i.kind === 'quiz').length,
    0,
    '문항 없는 영상 뒤에는 빈 브레이크를 만들지 않는다',
  )
  assert.ok(result.plan.plannedTotalSec <= 1800)
}

// ---------------------------------------------- 밴드 스윕 (튜닝 참고용, 비검증)

{
  console.log('\n  BAND_SEC 스윕 (예산 30분)')
  console.log('    카탈로그   밴드   고유조합   최빈점유   평균언더슛')
  for (const size of [8, 20, 40]) {
    for (const bandSec of [0, 30, 60, 90, 120, 180, 300]) {
      const input = baseInput({ catalog: makeCatalog(size), bandSec, rng: mulberry32(7) })
      const m = measure(input)
      const rng2 = mulberry32(7)
      let sum = 0
      for (let i = 0; i < 100; i++) {
        const r = planSession({ ...input, rng: rng2 })
        if (r.ok) sum += r.plan.underrunSec
      }
      const mark = bandSec === BAND_SEC ? ' ←현재' : ''
      console.log(
        `    ${String(size).padStart(6)}편  ${String(bandSec).padStart(4)}초  ${String(m.unique).padStart(6)}종  ${(m.topShare * 100).toFixed(0).padStart(6)}%  ${(sum / 100).toFixed(0).padStart(8)}초${mark}`,
      )
    }
  }
}

console.log('\n✓ 전체 통과')
