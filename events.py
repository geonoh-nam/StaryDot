#!/usr/bin/env python3
"""사건 추출 → 개입지점.

정본 전사본을 claude CLI 에 넘겨 "무슨 일이 있었나"를 뽑고, 사건마다 직후의
안전한 자리로 스냅해 개입지점을 만든다.

    python3 events.py work/<작품>_plan.json

storydot.py 는 LLM 을 안 부른다. 사건 추출이 LLM 이므로 이 파일로 분리했다.
"""
import subprocess
from pathlib import Path

import generate
import grounding
import storydot

ROOT = Path(__file__).parent
WORK = ROOT / "work"

# 사건 하나가 성립하는 최소 근거 수. storydot 의 min_evidence(5) 를 쓰면 안 된다 —
# 그건 "개입 직전 100초에서 긁어모은 대사"라 쉽게 차지만, 사건이 지목한 근거는
# "타요가 탈락했다" 처럼 보통 2~3개다. 5를 그대로 쓰면 정상 사건이 전멸한다.
EVENT_MIN_EVIDENCE = 2

# 열어 두면 호출마다 새 범주가 생겨 하류에서 분기를 못 짠다.
KINDS = ("결과", "감정", "시도", "발견", "갈등")

# 사건의 근거가 이보다 넓게 흩어져 있으면 사건이 아니라 뭉치다.
# storydot 의 같은 이름 상수에서 왔으나 — "유아는 그만큼 거슬러 기억하지 못한다" —
# storydot.py 가 읽기 전용이라 여기에 중복시킨다.
RECALL_WINDOW = 100.0

# 사건 직후 몇 초까지 안전한 자리를 찾을 것인가.
# visual.extract_evidence_frames 가 이미 span=20.0 을 쓴다. 같은 창을 써야
# 프레임 근거와 사건이 겹치고 새 눈금이 늘지 않는다.
SNAP_LOOK = 20.0


PICK_W = {"pause": 0.40, "shot": 0.25, "evidence": 0.20, "gap": 0.15, "snap": 0.10}
SHOT_BONUS = {"wide": 1.0, "medium": 0.6}   # closeup 은 정착 단계에서 이미 기각된다


def _sat(x: float, full: float) -> float:
    """0 에서 시작해 full 에서 1 로 포화. 음수는 0."""
    return min(1.0, max(0.0, x / full)) if full > 0 else 0.0


def pick_score(c: dict, P: dict) -> float:
    """개입지점 후보의 상대 점수 0~1. 후보끼리 비교하는 데만 쓴다.

    storydot.pick_score 와 가중치는 같고 근거 정규화 기준만 다르다.
    storydot 은 min_evidence(5) 로 재는데 그건 100초 긁기 기준이라,
    사건이 지목한 근거(보통 2~3건)에 쓰면 이 항이 늘 0점이 된다.
    """
    ev = _sat(c["n_ev"] - EVENT_MIN_EVIDENCE, EVENT_MIN_EVIDENCE)
    gp = _sat(c["gap"] - P["speech_pad"], P["speech_pad"])
    s = (PICK_W["pause"] * c.get("pause_score", 0.0)
         + PICK_W["shot"] * SHOT_BONUS.get(c.get("shot"), 0.0)
         + PICK_W["evidence"] * ev
         + PICK_W["gap"] * gp)
    if c.get("snapped"):
        # 스냅으로 옮긴 자리는 사건이 끝난 그 자리가 아니다. 같은 조건이면 진다.
        s -= PICK_W["snap"]
    return round(max(0.0, s), 3)


def choose(settled: list[dict], P: dict, rejected: list) -> list[dict]:
    """점수 높은 순으로 고르되 활동 간 최소 간격을 지킨다.

    정원을 다 못 채울 수 있다 — 좋은 자리 하나가 옆의 평범한 둘을 막으면 그게 맞다.
    밀려난 후보도 사유를 남긴다.
    """
    for c in settled:
        c["score"] = pick_score(c, P)
    picked = []
    for c in sorted(settled, key=lambda c: (-c["score"], c["t"])):
        if len(picked) >= P["max_activities"]:
            rejected.append((c["t"], f"정원 초과 — 점수 {c['score']}, "
                                     f"상위 {P['max_activities']}개에 밀림"))
            continue
        near = next((q for q in picked if abs(c["t"] - q["t"]) < P["min_gap"]), None)
        if near is not None:
            rejected.append((c["t"], f"{storydot.mmss(near['t'])} 와 간격 "
                                     f"{abs(c['t'] - near['t']):.0f}s < {P['min_gap']:.0f}s "
                                     f"— 점수 {c['score']} vs {near['score']}"))
            continue
        picked.append(c)
    return sorted(picked, key=lambda c: c["t"])


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


SKILLS = ROOT / "skills"
TIMEOUT = 300
MAX_EVENTS = 12


def _claude(prompt: str) -> dict:
    """claude CLI 를 헤드리스로 1회 호출한다. generate.py 의 _claude 와 같은 규약."""
    sysmsg = (SKILLS / "events" / "SKILL.md").read_text()
    cmd = ["claude", "-p", prompt, "--append-system-prompt", sysmsg,
           "--allowed-tools", "Read", "--output-format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패(events): {r.stderr[-300:]}")
    return generate._first_json_object(storydot.claude_result(r.stdout), "events")


def extract(plan: dict) -> tuple[list[dict], list[tuple[str, str]]]:
    """정본에서 사건을 뽑고 게이트를 통과한 것만 돌려준다.

    Returns: (통과한 사건, [(what, 폐기사유)])
    """
    usable = [s for s in plan["canonical"]
              if s["conf"] in ("high", "medium") and s["t1"] <= plan["end"]]
    canon_by_id = {s["id"]: s for s in usable}
    names = set(plan["names"]) | {v for vs in plan["names"].values() for v in vs}

    lines = "\n".join(f'{s["id"]}  [{s["t0"]:.1f}-{s["t1"]:.1f}]  {s["text"]}'
                      for s in usable)
    raw = _claude(f"아래는 만화 한 편의 정본 전사본이다.\n\n{lines}\n\n"
                  f"여기서 사건을 뽑아라.")

    kept, dropped = [], []
    # 게이트 통과 후 MAX_EVENTS 까지만 유지. 통과 못 한 사건은 모두 기록한다.
    for ev in raw.get("events", []):
        ok, why, out = gate(ev, canon_by_id, names)
        if not ok:
            dropped.append((ev.get("what", "?"), why))
            continue
        if len(kept) < MAX_EVENTS:
            out["evidence_text"] = [canon_by_id[j]["text"] for j in out["evidence"]]
            kept.append(out)
        else:
            dropped.append((ev.get("what", "?"), f"정원 초과 — 상위 {MAX_EVENTS}개에 밀림"))
    # 시간순으로 정렬한 뒤 시간 순서대로 id 를 부여한다.
    kept.sort(key=lambda e: e["t"])
    for i, ev in enumerate(kept):
        ev["id"] = f"e{i:02d}"
    return kept, dropped


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

    # ── 점수와 선택 ──────────────────────────────────────────────────
    P = {"min_gap": 120.0, "max_activities": 2, "speech_pad": 3.0}

    def cand(t, pause, shot, n_ev, gap):
        return {"t": t, "pause_score": pause, "shot": shot,
                "n_ev": n_ev, "gap": gap}

    # 근거 정규화 기준이 EVENT_MIN_EVIDENCE(2) 여야 한다.
    # storydot 의 5 를 그대로 쓰면 근거 항이 항상 0점인 죽은 항이 된다.
    floor = cand(0.0, 0.0, "medium", EVENT_MIN_EVIDENCE, P["speech_pad"])
    assert pick_score(floor, P) == round(PICK_W["shot"] * SHOT_BONUS["medium"], 3)
    full = cand(0.0, 1.0, "wide", EVENT_MIN_EVIDENCE * 2, P["speech_pad"] * 2)
    assert pick_score(full, P) == 1.0, pick_score(full, P)

    # 시간순이 아니라 점수순으로 고른다
    rej = []
    got = choose([cand(100.0, 0.30, "medium", 2, 3.0),
                  cand(400.0, 0.95, "wide", 6, 9.0)],
                 {**P, "max_activities": 1}, rej)
    assert [c["t"] for c in got] == [400.0], got
    assert rej and "정원" in rej[0][1], rej

    # 최소 간격을 지키고 밀려난 후보는 사유를 남긴다
    rej = []
    got = choose([cand(300.0, 0.90, "wide", 5, 8.0),
                  cand(350.0, 0.50, "medium", 3, 4.0)], P, rej)
    assert [c["t"] for c in got] == [300.0], got
    assert any("간격" in w for _, w in rej), rej

    print("events 자체검사 통과")


if __name__ == "__main__":
    selftest()
