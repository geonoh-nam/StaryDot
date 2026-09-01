"""지점마다 활동 유형을 미리 배정한다.

프롬프트에 "다양하게 쓰세요"라고 부탁하면 모델은 만들기 쉬운 유형으로 기운다.
whale_princess 실측: 9개 중 그림과_낱말_연결이 4개, 이야기_되새기기는 0개였다.
그래서 말로 부탁하지 않고 코드가 배정한다.

배정은 가중치 표에서 뽑는다. 기본은 균등이고, 아이 기록이 쌓이면 자주 틀리는 유형의
가중치가 올라간다 — 약점을 더 자주 만나게 하는 정책이다.
"""

import math
import random

# 이 횟수만큼 풀어보기 전에는 가중치를 건드리지 않는다.
# 한두 번 틀린 것으로 유형이 쏠리면 아이가 같은 벽에 계속 부딪힌다.
MIN_ATTEMPTS = 3

# 전부 틀리는 유형의 가중치 상한 배수. 1.0(안 틀림) ~ 1.0 + MAX_BOOST(다 틀림).
MAX_BOOST = 2.0


def max_points(duration_sec: float, min_spacing_sec: float) -> int:
    """영상 길이와 최소 간격에서 넣을 수 있는 지점의 최대 개수.

    이걸 상류에 알려주지 않으면 지점 선정자가 넣을 수 없는 개수만큼 후보를 뽑고,
    출제·검수를 다 거친 뒤 마지막 가드에서 버려진다. whale_princess 첫 실행에서
    후보 10곳 중 6곳이 그렇게 낭비됐다."""
    if duration_sec <= 0 or min_spacing_sec <= 0:
        return 0
    return max(1, math.floor(duration_sec / min_spacing_sec))


def weights_from_history(history: list[dict], templates: list[str]) -> dict[str, float]:
    """아이의 풀이 기록에서 유형별 가중치를 만든다.

    history 항목: {"activity_template": str, "correct": bool}
    자주 틀린 유형일수록 가중치가 높다. 기록이 MIN_ATTEMPTS 미만인 유형은 1.0(중립).
    """
    attempts: dict[str, int] = {}
    wrong: dict[str, int] = {}
    for record in history:
        template = record.get("activity_template")
        if template not in templates:
            continue
        attempts[template] = attempts.get(template, 0) + 1
        if not record.get("correct"):
            wrong[template] = wrong.get(template, 0) + 1

    weights = {}
    for template in templates:
        n = attempts.get(template, 0)
        if n < MIN_ATTEMPTS:
            weights[template] = 1.0
            continue
        error_rate = wrong.get(template, 0) / n
        weights[template] = 1.0 + MAX_BOOST * error_rate
    return weights


def _weighted_shuffle(templates: list[str], weights: dict[str, float], rng: random.Random) -> list[str]:
    """가중치에 비례해 하나씩 뽑아 빼는 방식으로 순서를 만든다.
    가중치가 높을수록 앞에 올 확률이 높지만, 낮은 것도 반드시 목록에 남는다."""
    remaining = list(templates)
    order = []
    while remaining:
        pool = [max(weights.get(t, 1.0), 0.0) for t in remaining]
        total = sum(pool)
        if total <= 0:
            rng.shuffle(remaining)
            order.extend(remaining)
            break
        pick = rng.uniform(0, total)
        acc = 0.0
        for i, w in enumerate(pool):
            acc += w
            if pick <= acc:
                order.append(remaining.pop(i))
                break
        else:
            order.append(remaining.pop())
    return order


def assign_types(
    point_count: int,
    templates: list[str],
    weights: dict[str, float] | None = None,
    rng: random.Random | None = None,
) -> list[list[str]]:
    """지점마다 유형 우선순위 목록을 돌려준다.

    하나로 못 박지 않고 목록으로 주는 이유: 출제자가 "이 지점에서 빠진_글자_완성은
    못 만든다"일 때 지점을 통째로 버리는 대신 다음 후보로 넘어갈 수 있어야 한다.

    한 영상 안에서는 카탈로그를 한 바퀴 다 돌기 전까지 같은 유형이 1순위로 다시
    나오지 않는다. 유형이 5종인데 활동은 3~5개라 한 영상 안의 균등은 애초에
    불가능하고, 균등은 여러 영상에 걸쳐 성립한다.
    """
    if point_count <= 0 or not templates:
        return []

    weights = weights or {t: 1.0 for t in templates}
    rng = rng or random.Random()

    assignments = []
    cycle: list[str] = []
    for _ in range(point_count):
        if not cycle:
            cycle = _weighted_shuffle(templates, weights, rng)
        first = cycle.pop(0)
        fallbacks = [t for t in _weighted_shuffle(templates, weights, rng) if t != first]
        assignments.append([first, *fallbacks])
    return assignments
