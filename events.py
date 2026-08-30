#!/usr/bin/env python3
"""사건 추출 → 개입지점.

정본 전사본을 claude CLI 에 넘겨 "무슨 일이 있었나"를 뽑고, 사건마다 직후의
안전한 자리로 스냅해 개입지점을 만든다.

    python3 events.py work/<작품>_plan.json

storydot.py 는 LLM 을 안 부른다. 사건 추출이 LLM 이므로 이 파일로 분리했다.
"""
import json
import subprocess
import sys
from pathlib import Path

import generate
import grounding
import motion
import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
# 사건 경로 산출물 전용 서브디렉터리. work/ 바로 밑에 *_ev_plan.json 을 두면
# judge.py 의 WORK.glob("*_plan.json") 이 그걸 별개 작품으로 집어삼켜 신구 비교용
# 합계 행을 오염시킨다 (judge.py 는 읽기 전용이라 여길 고쳐서 피한다). glob 은
# 재귀하지 않으므로 서브디렉터리로 옮기면 그 글롭에 안 걸린다.
EV_DIR = WORK / "ev"

# 사건 하나가 성립하는 최소 근거 수. storydot 의 min_evidence(5) 를 쓰면 안 된다 —
# 그건 "개입 직전 100초에서 긁어모은 대사"라 쉽게 차지만, 사건이 지목한 근거는
# "타요가 탈락했다" 처럼 보통 2~3개다. 5를 그대로 쓰면 정상 사건이 전멸한다.
EVENT_MIN_EVIDENCE = 2

# 열어 두면 호출마다 새 범주가 생겨 하류에서 분기를 못 짠다.
# `발견` 을 한 번 뺐다가 되살렸다. 21건 중 10건이 발견이었고 그 대부분이
# "누가 뭐라고 말했다" 였는데, 범주를 없애니 개입지점이 5 → 1 로 무너졌다.
# 진짜 원인은 범주가 아니라 전달문을 사건으로 본 것이라, SKILL.md 의
# 전달문 배제 규칙으로 거르고 범주는 유지한다.
KINDS = ("결과", "감정", "시도", "발견", "갈등")

# 사건의 근거가 이보다 넓게 흩어져 있으면 사건이 아니라 뭉치다.
# storydot 의 같은 이름 상수에서 왔으나 — "유아는 그만큼 거슬러 기억하지 못한다" —
# storydot.py 가 읽기 전용이라 여기에 중복시킨다.
RECALL_WINDOW = 100.0

# 멈춘 자리에서 **몇 초 전까지의 사건**을 붙일 것인가.
# RECALL_WINDOW(100초)를 그대로 쓰면 1분 전 일을 묻게 된다 — 실측에서 타요 2:12 개입에
# 1:03 사건이 붙었다. 아이가 그걸 기억해서 답하기는 어렵다.
# 게이트의 근거 스팬 검사는 RECALL_WINDOW 를 그대로 쓴다. 그건 "사건의 근거들이 서로
# 얼마나 떨어져 있나"이지 "개입과 사건 사이 거리"가 아니다.
#
# 20초로 조였더니 5편에 개입지점이 3개(편당 0.6)로 무너졌고 브레드는 0이 됐다.
# 40초면 자리가 9 → 19 로 늘어 5편 모두 살아난다. 점수의 recency 항(0.20)이
# 가까운 자리를 우선하므로, 창이 40초여도 실제로 뽑히는 것은 더 가깝다.
ATTACH_WINDOW = 40.0

# 사건 직후 몇 초까지 안전한 자리를 찾을 것인가.
# visual.extract_evidence_frames 가 이미 span=20.0 을 쓴다. 같은 창을 써야
SKILLS = ROOT / "skills"
TIMEOUT = 300
MAX_EVENTS = 12          # 한 편에서 받아들일 사건 수 상한

# 정착(ffmpeg)에 넘길 자리 수 상한. 자리가 수백 곳이라 전부 돌리면 느리다.
# 자리를 모으는 바닥. speech_pad(3초=페이드아웃 시간)보다 낮게 잡고,
# 실제 개입 방식은 settle 이 화면을 보고 정한다. 브레드1화는 전 구간에
# 3초 공백이 2곳뿐인데 2초 이상은 5곳, 1.5초 이상은 10곳이다 —
# 3초라는 값이 대사 촘촘한 작품을 통째로 잘라내고 있었다.
PAD_FLOOR = 1.5

# 개입 방식. 여유가 넉넉하면 페이드아웃, 짧으면 컷 직후에만 얼린다.
# 컷 직후는 장면 경계라 소리 여유가 짧아도 얼리는 것이 자연스럽다.
MODE_FADE_PAD = 3.0

SETTLE_CAP = 12


# 사건 직후라는 보장이 사라졌으므로 "얼마나 가까운가"를 점수가 대신 잰다.
PICK_W = {"pause": 0.35, "shot": 0.20, "evidence": 0.15, "gap": 0.10, "recency": 0.20}
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
    # 사건에서 멀수록 아이 기억이 흐려진다. ATTACH_WINDOW 끝에서 0 이 된다.
    rc = max(0.0, 1.0 - c.get("since", 0.0) / ATTACH_WINDOW)
    s = (PICK_W["pause"] * c.get("pause_score", 0.0)
         + PICK_W["shot"] * SHOT_BONUS.get(c.get("shot"), 0.0)
         + PICK_W["evidence"] * ev
         + PICK_W["gap"] * gp
         + PICK_W["recency"] * rc)
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
    # SKILL.md 가 "확실치 않으면 null" 이라고 시키므로 who 키 자체가 없을 수 있다.
    # 없는 채로 두면 run() 의 c["event"]["who"] 가 KeyError — claude 호출·ffmpeg 다
    # 끝난 뒤 아무것도 못 쓰고 죽는다. 여기서 무조건 키를 만들어 둔다.
    out.setdefault("who", None)
    who = ev.get("who")
    # 화자를 못 잡아도 사건은 유효하다. 캐릭터 매개 개입을 못 쓸 뿐이라 강등한다.
    if who and not (who in names or any(who in s["text"] for s in segs)):
        out["who"] = None
    out["t"] = round(max(s["t1"] for s in segs), 2)
    return True, "통과", out


def _grounding_score_of(what: str, segs: list[dict]):
    return grounding._grounding_score(what, [s["text"] for s in segs])


def stop_candidates(canon, end: float, P: dict) -> list[dict]:
    """대사가 PAD_FLOOR 이상 쉬는 자리를 **전 구간에서** 모은다.

    사건에서 출발해 직후에서 멈출 자리를 찾으면 대부분 실패한다 — 실측에서
    사건 10건 중 창을 100초까지 넓혀도 5건뿐이었고, 타요·브레드는 0이었다.
    멈출 자리는 편당 수백 곳으로 널려 있고 희소한 건 사건 쪽이다.
    그래서 방향을 뒤집어 자리에서 출발한다.
    """
    starts = sorted(x["t0"] for x in canon)
    out = []
    for seg in canon:
        b = seg["t1"]
        if b < P["min_start"] or b > end:
            continue
        nxt = min(min((x for x in starts if x >= b), default=end), end)
        gap = nxt - b
        if gap >= PAD_FLOOR:
            out.append({"t": round(b, 2), "gap": round(gap, 2)})
    return out


def attach_event(spots: list[dict], events: list[dict],
                 window: float = ATTACH_WINDOW) -> list[dict]:
    """각 자리에 **직전 window 초 안의 가장 최근 사건**을 붙인다. 없으면 버린다.

    창을 RECALL_WINDOW(100초)로 열었더니 1분 전 사건이 붙었다 — 타요 2:12 개입에
    1:03 의 사건. 아이가 그만큼 거슬러 기억해서 답하기는 어렵다. 방금 본 일이어야 한다.
    """
    out = []
    for sp in spots:
        prior = [e for e in events if sp["t"] - window <= e["t"] <= sp["t"]]
        if not prior:
            continue
        e = max(prior, key=lambda x: x["t"])
        out.append({**sp, "event": e, "n_ev": len(e["evidence"]),
                    "since": round(sp["t"] - e["t"], 1)})
    return out



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

    no_who = {k: v for k, v in good.items() if k != "who"}
    assert "who" not in no_who
    ok, why, out = gate(no_who, canon, names)
    assert ok, f"who 키가 아예 없는 사건이 막혔다: {why}"
    assert "who" in out and out["who"] is None, (
        "who 키가 없는 사건은 통과 후에도 who=None 이어야 한다 "
        "(없으면 run() 의 c['event']['who'] 에서 KeyError)")

    # ── 자리 모으기 · 사건 붙이기 ─────────────────────────────────
    seq = [{"t0": 100.0, "t1": 102.0}, {"t0": 103.0, "t1": 105.0},
           {"t0": 130.0, "t1": 132.0}]
    Ps = {"min_start": 50.0, "speech_pad": 3.0}

    spots = stop_candidates(seq, 200.0, Ps)
    # 105(다음 대사 130 까지 25초)와 132(끝 200 까지 68초)만 남는다.
    # 102 는 103 에 대사가 재개돼 1초뿐이라 빠진다.
    assert [x["t"] for x in spots] == [105.0, 132.0], spots
    assert spots[0]["gap"] == 25.0, spots[0]
    assert stop_candidates(seq, 200.0, {**Ps, "min_start": 120.0})[0]["t"] == 132.0
    assert stop_candidates(seq, 106.0, Ps) == []

    events_x = [{"t": 40.0, "what": "옛일", "evidence": ["a", "b"]},
                {"t": 95.0, "what": "최근", "evidence": ["c", "d", "e"]}]
    got = attach_event(spots, events_x, window=100.0)
    assert len(got) == 2, got
    assert got[0]["event"]["what"] == "최근", got[0]      # 40 이 아니라 95
    assert got[0]["since"] == 10.0 and got[0]["n_ev"] == 3, got[0]
    assert got[1]["since"] == 37.0, got[1]
    assert attach_event(spots, events_x, window=5.0) == []
    # 기본 창(ATTACH_WINDOW)이 실제로 거리를 제한한다. 창을 20초로 주면 37초 떨어진
    # 자리는 떨어져 나간다 — 1분 전 사건을 묻지 않게 하는 것이 이 창의 존재 이유다.
    assert [x["t"] for x in attach_event(spots, events_x, window=20.0)] == [105.0]
    # 기본 창에서는 둘 다 붙되 거리가 기록된다. 점수의 recency 항이 이 값을 쓴다.
    near = attach_event(spots, events_x)
    assert [x["since"] for x in near] == [10.0, 37.0], near
    assert all(x["since"] <= ATTACH_WINDOW for x in near), near
    # 자리보다 나중에 일어난 사건은 안 붙인다
    assert attach_event([{"t": 60.0, "gap": 9.0}], events_x, 100.0)[0]["event"]["t"] == 40.0

    # ── 점수와 선택 ──────────────────────────────────────────────────
    P = {"min_gap": 120.0, "max_activities": 2, "speech_pad": 3.0}

    def cand(t, pause, shot, n_ev, gap, since=0.0):
        return {"t": t, "pause_score": pause, "shot": shot,
                "n_ev": n_ev, "gap": gap, "since": since}

    # 근거 정규화 기준이 EVENT_MIN_EVIDENCE(2) 여야 한다.
    # storydot 의 5 를 그대로 쓰면 근거 항이 항상 0점인 죽은 항이 된다.
    floor = cand(0.0, 0.0, "medium", EVENT_MIN_EVIDENCE, P["speech_pad"], ATTACH_WINDOW)
    assert pick_score(floor, P) == round(PICK_W["shot"] * SHOT_BONUS["medium"], 3)
    full = cand(0.0, 1.0, "wide", EVENT_MIN_EVIDENCE * 2, P["speech_pad"] * 2, 0.0)
    assert pick_score(full, P) == 1.0, pick_score(full, P)
    # 사건에 가까울수록 높다 — 방향 뒤집기의 안전장치
    assert pick_score(cand(0.0, 0.5, "wide", 4, 6.0, 5.0), P) > \
           pick_score(cand(0.0, 0.5, "wide", 4, 6.0, 90.0), P)

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

    # ── find_act ─────────────────────────────────────────────────────
    acts = [{"t0": 0.0, "t1": 100.0, "beat": "1장"},
            {"t0": 100.0, "t1": 200.0, "beat": "2장"}]
    assert find_act(acts, 150.0)["beat"] == "2장"
    assert find_act(acts, 100.0)["beat"] == "2장"          # 경계는 다음 장 소속
    assert find_act(acts, 250.0)["beat"] == "2장"          # 장 밖이면 마지막 장
    assert find_act([], 50.0) == {"t0": 0.0, "t1": 50.0, "beat": "(장 정보 없음)"}

    # ── 개입 방식 분기 ───────────────────────────────────────────
    cn = [{"t0": 100.0, "t1": 102.0}, {"t0": 110.0, "t1": 112.0}]
    Pm = {"speech_pad": 3.0, "min_start": 0.0}
    real = motion.best_pause, motion.scale_stats
    try:
        motion.scale_stats = lambda v, t: (100.0, 0.0)          # 항상 wide
        base = {"t": 102.0, "n_ev": 3, "gap": 8.0, "since": 5.0,
                "event": {"t": 97.0}}

        # 여유 8초(102 → 110) → fade
        motion.best_pause = lambda v, t: {"t": 102.0, "score": 0.9,
                                          "kind": "still", "why": "x"}
        out = settle(None, [dict(base)], cn, 200.0, Pm, 10.0, [])
        assert out and out[0]["mode"] == "fade", out
        # 정착이 t 를 옮기면 사건과의 거리도 다시 재야 한다. 여기선 102 로 그대로
        # 앉으므로 사건(97)과 5초. 재계산이 빠지면 입력값이 그대로 남아 안 걸린다 —
        # 그래서 아래에서 t 가 옮겨지는 경우로 한 번 더 확인한다.
        assert out[0]["since"] == 5.0, out[0]

        # 정착이 t 를 104 로 옮기면 사건(97)과의 거리는 입력 5.0 이 아니라 7.0 이다.
        # 재계산이 빠지면 5.0 이 그대로 남아 이 단언이 터진다.
        motion.best_pause = lambda v, t: {"t": 104.0, "score": 0.9,
                                          "kind": "still", "why": "x"}
        out = settle(None, [dict(base)], cn, 200.0, Pm, 10.0, [])
        assert out and out[0]["since"] == 7.0, out

        # 정착이 사건(97)보다 앞으로 당기면 기각한다 — 아직 일어나지 않은 일을
        # 물을 수는 없다. 실측에서 since=-0.8s 인 개입지점이 나왔다.
        motion.best_pause = lambda v, t: {"t": 96.0, "score": 0.9,
                                          "kind": "still", "why": "x"}
        rej = []
        assert settle(None, [dict(base)], cn, 200.0, Pm, 10.0, rej) == []
        assert "앞선다" in rej[0][1], rej

        # 여유 2초인데 컷 직후 → freeze
        cn2 = [{"t0": 100.0, "t1": 102.0}, {"t0": 104.0, "t1": 106.0}]
        motion.best_pause = lambda v, t: {"t": 102.0, "score": 0.9,
                                          "kind": "post-cut", "why": "x"}
        out = settle(None, [dict(base)], cn2, 200.0, Pm, 10.0, [])
        assert out and out[0]["mode"] == "freeze", out

        # 같은 여유인데 컷 직후가 아니면 기각 — freeze 를 아무 데나 쓰면 안 된다
        motion.best_pause = lambda v, t: {"t": 102.0, "score": 0.9,
                                          "kind": "still", "why": "x"}
        rej = []
        assert settle(None, [dict(base)], cn2, 200.0, Pm, 10.0, rej) == []
        assert "컷 직후도 아니다" in rej[0][1], rej
    finally:
        motion.best_pause, motion.scale_stats = real

    print("events 자체검사 통과")


def settle(video, cands, canon, end, P, baseline_tv, rejected) -> list[dict]:
    """후보 전원을 화면 기준으로 정착시킨다.

    오디오는 "이야기가 한 단락 끝났다"를 알려주지만 카메라가 그때 멈춰 있는지는
    말해 주지 않는다. 실측 9개 지점 중 3개가 동작 한복판이었다 (바느질 클로즈업·
    점프·기차 주행). motion.py 가 컷≠동작과 샷 크기를 더 본다.

    정착이 t 를 옮기면 발화 여유를 **옮긴 자리에서** 다시 잰다. 옮기기 전 값으로
    규칙을 통과시키면 실제로는 여유가 없는 자리에 활동이 붙는다.
    """
    out = []
    for c in cands:
        pause = motion.best_pause(video, c["t"])
        if pause["kind"] == "none":
            rejected.append((c["t"], f"멈출 자리 없음 — {pause['why']}"))
            continue
        tv, _flat = motion.scale_stats(video, pause["t"])
        scale = "closeup" if tv < baseline_tv * storydot.CLOSEUP_REL else (
            "wide" if tv > baseline_tv * 1.15 else "medium")
        if scale == "closeup":
            # 수치는 조용해도 익스트림 클로즈업은 동작 한복판이다.
            rejected.append((c["t"], f"클로즈업 (디테일 {tv:.1f} < 기준 {baseline_tv:.1f})"))
            continue
        t = pause["t"]
        nxt = min(min((s["t0"] for s in canon if s["t0"] >= t), default=end), end)
        gap = nxt - t
        # 개입 방식을 여기서 정한다. 여유가 페이드아웃 시간만큼 있으면 fade,
        # 없으면 컷 직후일 때만 freeze — 장면 경계라 얼려도 덜 어색하다.
        if gap >= MODE_FADE_PAD:
            mode = "fade"
        elif pause["kind"] == "post-cut" and gap >= PAD_FLOOR:
            mode = "freeze"
        else:
            rejected.append((c["t"], f"정착 {t:.2f}s 여유 {gap:.1f}s — "
                                     f"페이드아웃엔 짧고 컷 직후도 아니다({pause['kind']})"))
            continue
        # 정착이 t 를 ±4초 옮기므로 사건과의 거리도 다시 잰다. gap 은 다시 재면서
        # since 는 안 재면, 점수의 recency 항이 옮기기 전 값으로 계산된다.
        since = round(t - c["event"]["t"], 1)
        if since < 0:
            # 정착이 사건보다 앞으로 당겼다. 아직 일어나지 않은 일을 물을 수는 없다.
            rejected.append((c["t"], f"정착 {t:.2f}s 가 사건({c['event']['t']:.1f}s)보다 앞선다"))
            continue
        c.update(t=t, gap=round(gap, 2), mode=mode, since=since,
                 pause_score=round(pause["score"], 2),
                 pause_kind=pause["kind"], shot=scale, why=pause["why"])
        out.append(c)
    return out


def find_act(acts: list[dict], t: float) -> dict:
    """시각 t 가 속한 장(act)을 찾는다. `generate.bundle()` 이 `it['act']['beat']`
    로 "직전에 끝난 장면"을 읽으므로, 사건 기준 개입지점에도 같은 모양을 채워 줘야
    옛 생성 경로(generate.py, 읽기 전용)와 스키마가 맞는다.

    1) t 를 포함하는 장 (t0 <= t < t1).
    2) 없으면 t 이전에 시작한 장 중 가장 나중 것 (장 경계에 걸쳤을 때 대비).
    3) 그마저 없으면 "장 정보 없음" 자리표시자.
    """
    for a in acts:
        if a["t0"] <= t < a["t1"]:
            return a
    before = [a for a in acts if a["t0"] <= t]
    if before:
        return max(before, key=lambda a: a["t0"])
    return {"t0": 0.0, "t1": t, "beat": "(장 정보 없음)"}


def run(plan_path: Path) -> dict:
    """plan.json 을 **읽기만** 하고 사건·개입지점을 채운 ev_plan.json 을 새로 쓴다.

    원본을 덮어쓰지 않는다. 기존 파이프라인(generate.py, seed-from-work.js)이
    계속 옛 결과로 돌 수 있어야 하고, 옛 결과와 새 결과를 나란히 비교해야 한다.
    """
    plan = json.loads(plan_path.read_text())
    video = Path(plan["video"])
    P, canon, end = plan["params"], plan["canonical"], plan["end"]

    evs, dropped = extract(plan)
    rejected = [(0.0, f"[사건폐기] {w}: {r}") for w, r in dropped]

    # 자리 → 사건 (방향 뒤집기). 자리는 수백 곳, 사건은 편당 몇 건뿐이다.
    spots = stop_candidates(canon, end, P)
    cands = attach_event(spots, evs)
    rejected.append((0.0, f"[정보] 멈출 자리 {len(spots)} → 사건 붙은 자리 {len(cands)}"))
    # 정착은 자리마다 ffmpeg 를 돌린다. 영상 없이 미리 추려 비용을 묶는다.
    cands.sort(key=lambda c: (-c["n_ev"], c["since"], -c["gap"]))
    if len(cands) > SETTLE_CAP:
        for c in cands[SETTLE_CAP:]:
            rejected.append((c["t"], f"사전선별 {SETTLE_CAP}위 밖 "
                                     f"(근거 {c['n_ev']}, 사건 후 {c['since']}s)"))
        cands = cands[:SETTLE_CAP]

    # detail_baseline 과 CLOSEUP_REL 은 storydot 에 이미 있으므로 그대로 쓴다.
    # settle 은 storydot 에 없다 — 아래에서 events.py 가 직접 정의한다.
    baseline_tv = storydot.detail_baseline(video, plan["duration"])
    chosen = choose(settle(video, cands, canon, end, P, baseline_tv, rejected),
                    P, rejected)

    for c in chosen:
        try:
            frames = visual.extract_evidence_frames(video, c["t"], span=20.0, n=4,
                                                    out_dir=WORK / "shots")
            c["frames"] = frames
            c["colors"] = visual.frame_facts(frames[-1:])
        except Exception as exc:
            c["frames"], c["colors"] = [], {"error": str(exc)}

    by_id = {s["id"]: s for s in canon}
    plan["events"] = evs
    plan["interrupts"] = [{
        "id": f"i{k:02d}", "t": c["t"], "gap": c["gap"], "score": c.get("score"),
        "n_ev": c["n_ev"], "mode": c.get("mode"), "since": c.get("since"),
        "event_id": c["event"]["id"], "kind": c["event"]["kind"],
        "asked_by": c["event"]["who"], "what": c["event"]["what"],
        "act": find_act(plan.get("acts") or [], c["t"]),
        "pause": {"score": c.get("pause_score"), "kind": c.get("pause_kind"),
                  "shot": c.get("shot"), "why": c.get("why")},
        "frames": c.get("frames", []), "colors": c.get("colors", {}),
        "snapped": c.get("snapped", False),
        "evidence": [{"id": i, "t0": by_id[i]["t0"], "t1": by_id[i]["t1"],
                      "text": by_id[i]["text"], "conf": by_id[i]["conf"]}
                     for i in c["event"]["evidence"]],
    } for k, c in enumerate(chosen)]
    plan["rejected"] = [{"t": t, "why": w} for t, w in rejected]
    EV_DIR.mkdir(parents=True, exist_ok=True)
    out = EV_DIR / plan_path.name.replace("_plan.json", "_ev_plan.json")
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    plan["_out"] = str(out)
    return plan


def report(plan: dict) -> None:
    """실행 결과를 사람이 읽을 수 있게 콘솔에 찍는다."""
    print(f"\n{'='*74}\n{Path(plan['video']).stem}")
    print(f"사건 {len(plan['events'])}건  "
          f"kind: " + " · ".join(f"{k}{sum(1 for e in plan['events'] if e['kind']==k)}"
                                 for k in KINDS))
    print(f"\n채택 개입지점 {len(plan['interrupts'])}")
    for it in plan["interrupts"]:
        pz = it.get("pause") or {}
        who = it["asked_by"] or "(화자불명)"
        print(f"  ★ {storydot.mmss(it['t'])}  점수 {it.get('score')}  [{it['kind']}] {who}")
        print(f"       {it['what']}")
        print(f"       화면 {pz.get('kind')}/{pz.get('shot')} {pz.get('score')}"
              f"  여유 {it['gap']}s  개입 {it.get('mode')}  근거 {len(it['evidence'])}건")
    if plan["rejected"]:
        print("기각:")
        for x in plan["rejected"]:
            print(f"  ✗ {storydot.mmss(x['t'])}  {x['why']}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        selftest()
        sys.exit(0)
    for p in args:
        r = run(Path(p).expanduser())
        report(r)
        print(f"  → {r['_out']}")
