#!/usr/bin/env python3
"""사건 추출 → 개입지점.

정본 전사본을 claude CLI 에 넘겨 "무슨 일이 있었나"를 뽑고, 사건마다 직후의
안전한 자리로 스냅해 개입지점을 만든다.

    python3 events.py work/<작품>_plan.json

storydot.py 는 LLM 을 안 부른다. 사건 추출이 LLM 이므로 이 파일로 분리했다.
"""
from pathlib import Path

import grounding

ROOT = Path(__file__).parent
WORK = ROOT / "work"

# 사건 하나가 성립하는 최소 근거 수. storydot 의 min_evidence(5) 를 쓰면 안 된다 —
# 그건 "개입 직전 100초에서 긁어모은 대사"라 쉽게 차지만, 사건이 지목한 근거는
# "타요가 탈락했다" 처럼 보통 2~3개다. 5를 그대로 쓰면 정상 사건이 전멸한다.
EVENT_MIN_EVIDENCE = 2

# 열어 두면 호출마다 새 범주가 생겨 하류에서 분기를 못 짠다.
KINDS = ("결과", "감정", "시도", "발견", "갈등")

# 사건의 근거가 이보다 넓게 흩어져 있으면 사건이 아니라 뭉치다.
# storydot 의 같은 이름 상수에서 왔다 — "유아는 그만큼 거슬러 기억하지 못한다".
# Task 3 에서 storydot 쪽 원본은 지운다(거기선 evidence() 만 쓰던 값이다).
RECALL_WINDOW = 100.0

# 사건 직후 몇 초까지 안전한 자리를 찾을 것인가.
# visual.extract_evidence_frames 가 이미 span=20.0 을 쓴다. 같은 창을 써야
# 프레임 근거와 사건이 겹치고 새 눈금이 늘지 않는다.
SNAP_LOOK = 20.0


def gate(ev: dict, canon_by_id: dict, names: set[str]) -> tuple[bool, str, dict]:
    """사건 하나를 결정적으로 검사한다.

    Returns: (통과여부, 사유, 보정된 사건). 통과한 사건에는 `t` 가 채워진다.
    실패는 재시도가 아니라 폐기다 — activities.gate 와 같은 규약.
    """
    if ev.get("kind") not in KINDS:
        return False, f"kind 미허용: {ev.get('kind')!r}", ev

    ids = ev.get("evidence") or []
    if len(ids) < EVENT_MIN_EVIDENCE:
        return False, f"근거 {len(ids)}건 < {EVENT_MIN_EVIDENCE}", ev

    segs = []
    for i in ids:
        s = canon_by_id.get(i)
        if s is None:
            return False, f"세그먼트 {i} 없음", ev
        if s["conf"] not in ("high", "medium"):
            return False, f"{i} 신뢰도 미달: {s['conf']}", ev
        segs.append(s)

    # 근거가 흩어져 있으면 사건이 아니라 뭉치다. evidence() 의 RECALL_WINDOW 주석이
    # 근거다 — "유아는 그만큼 거슬러 기억하지 못한다".
    span = max(s["t1"] for s in segs) - min(s["t0"] for s in segs)
    if span > RECALL_WINDOW:
        return False, f"근거 스팬 {span:.0f}s > {RECALL_WINDOW:.0f}s", ev

    # 서술이 근거에서 나오는가. 내용 토큰이 없으면 비율 -1 이라 여기서 걸린다.
    ratio, _hit, miss = _grounding_score_of(ev.get("what", ""), segs)
    if ratio < grounding.GROUNDED_RATIO:
        return False, (f"서술이 근거에서 안 나온다 "
                       f"(비율 {ratio:.2f}, 미확인 {miss[:3]})"), ev

    out = dict(ev)
    who = ev.get("who")
    # 화자를 못 잡아도 사건은 유효하다. 캐릭터 매개 개입을 못 쓸 뿐이라 강등한다.
    if who and not (who in names or any(who in s["text"] for s in segs)):
        out["who"] = None
    out["t"] = round(max(s["t1"] for s in segs), 2)
    return True, "통과", out


def _grounding_score_of(what: str, segs: list[dict]):
    return grounding._grounding_score(what, [s["text"] for s in segs])


def snap_forward(t: float, canon: list[dict], end: float,
                 pad: float, look: float = SNAP_LOOK) -> tuple[float | None, float]:
    """사건 직후 pad 초 이상 조용한 **첫** 자리를 찾는다. 없으면 (None, 0.0).

    storydot.snap_back 은 더 큰 공백을 찾아 과거로 당긴다. 사건에는 못 쓴다 —
    사건 한복판으로 돌아가기 때문이다. "타요가 탈락했다" 를 물으려면 탈락이
    끝난 뒤여야 한다.

    가장 조용한 자리가 아니라 가장 **이른** 자리를 고른다. 사건 직후일수록
    아이 기억이 생생하다.
    """
    starts = sorted(s["t0"] for s in canon)
    cands = [t] + sorted(s["t1"] for s in canon if t < s["t1"] <= t + look)
    for b in cands:
        if b > end:
            break
        nxt = min((s for s in starts if s >= b), default=end)
        nxt = min(nxt, end)
        if nxt - b >= pad:
            return round(b, 2), round(nxt - b, 2)
    return None, 0.0


def selftest():
    """게이트가 무동작이 아님을 증명한다. 하나씩 위조해 반드시 걸려야 한다."""
    canon = {
        "s10": {"id": "s10", "t0": 100.0, "t1": 102.0,
                "text": "타요가 선발대회에서 떨어졌어요", "conf": "high"},
        "s11": {"id": "s11", "t0": 103.0, "t1": 105.0,
                "text": "괜찮아 타요, 다음에 또 기회가 있어", "conf": "medium"},
        "s90": {"id": "s90", "t0": 400.0, "t1": 402.0,
                "text": "멀리 떨어진 대사", "conf": "high"},
        "s99": {"id": "s99", "t0": 106.0, "t1": 108.0,
                "text": "저신뢰 대사", "conf": "low"},
    }
    names = {"타요"}
    good = {"what": "타요가 선발대회에서 떨어졌어요", "who": "타요",
            "kind": "결과", "evidence": ["s10", "s11"]}

    ok, why, out = gate(good, canon, names)
    assert ok, f"정상 사건이 막혔다: {why}"
    assert out["t"] == 105.0, f"t 는 근거의 마지막 t1 이어야 한다: {out['t']}"
    assert out["who"] == "타요"

    ok, why, _ = gate({**good, "kind": "웃김"}, canon, names)
    assert not ok and "kind" in why, "허용 안 된 kind 를 통과시켰다"

    ok, why, _ = gate({**good, "evidence": ["s10"]}, canon, names)
    assert not ok and "근거" in why, "근거 1건짜리를 통과시켰다"

    ok, why, _ = gate({**good, "evidence": ["s10", "s404"]}, canon, names)
    assert not ok and "없음" in why, "없는 세그먼트를 통과시켰다"

    ok, why, _ = gate({**good, "evidence": ["s10", "s99"]}, canon, names)
    assert not ok and "신뢰도" in why, "저신뢰 세그먼트를 통과시켰다"

    ok, why, _ = gate({**good, "evidence": ["s10", "s90"]}, canon, names)
    assert not ok and "스팬" in why, "5분 떨어진 근거를 묶은 사건을 통과시켰다"

    ok, why, _ = gate({**good, "what": "크롱이 이불을 꿰맸다"}, canon, names)
    assert not ok and "근거에서" in why, "근거에 없는 서술을 통과시켰다"

    ok, why, out = gate({**good, "who": "제시"}, canon, names)
    assert ok, "화자 불명은 폐기가 아니라 강등이어야 한다"
    assert out["who"] is None, "확인 안 되는 who 를 그대로 뒀다"

    # ── snap_forward ────────────────────────────────────────────────
    # 100~102 대사, 103~105 대사, 그 뒤 130 까지 침묵, 130~132 대사
    seq = [{"t0": 100.0, "t1": 102.0}, {"t0": 103.0, "t1": 105.0},
           {"t0": 130.0, "t1": 132.0}]

    # 사건이 105 에 끝났고 130 까지 25초 비었다 → 105 를 그대로 쓴다
    t, gap = snap_forward(105.0, seq, 200.0, pad=3.0)
    assert t == 105.0 and gap == 25.0, (t, gap)

    # 사건이 102 에 끝났는데 103 에 대사가 재개된다 → 105 로 민다
    t, gap = snap_forward(102.0, seq, 200.0, pad=3.0)
    assert t == 105.0 and gap == 25.0, (t, gap)

    # 창(look) 밖은 안 본다. 102 에서 2초만 보면 105 에 못 닿는다
    t, gap = snap_forward(102.0, seq, 200.0, pad=3.0, look=2.0)
    assert t is None and gap == 0.0, (t, gap)

    # 과거로는 절대 안 간다 — snap_back 과 반대 방향임을 못박는다
    t, _ = snap_forward(103.5, seq, 200.0, pad=3.0)
    assert t is not None and t >= 103.5, t

    # 본편 끝을 넘어가지 않는다
    t, gap = snap_forward(105.0, seq, 106.0, pad=3.0)
    assert t is None, t

    print("사건 게이트 자체검사 8/8 통과")


if __name__ == "__main__":
    selftest()
