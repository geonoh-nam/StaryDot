# 사건 기반 퀴즈 지점 추출 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개입지점을 "장면 표지"가 아니라 "사건"에서 뽑아, 아이에게 물을 가치가 있는 순간에 활동을 붙인다.

**Architecture:** `claude` CLI 1프로세스가 정본 전사본을 읽고 사건 목록을 낸다. 사건은 자기 근거 세그먼트를 지목한다. 결정적 게이트 6개가 환각을 거른 뒤, 사건 직후 20초 안의 안전한 자리로 스냅해 개입지점을 만든다. 개입지점 산출 로직은 `storydot.py` 에서 새 파일 `events.py` 로 옮겨, `storydot.py` 가 LLM 을 안 부르는 성질을 지킨다.

**Tech Stack:** Python 3 표준 라이브러리만. 외부 패키지 0개. `ffmpeg` · `whisper-cli` · `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-08-28-event-driven-quiz-points-design.md`

## Global Constraints

- **파이썬 외부 패키지 0개.** `pip install` 금지. 표준 라이브러리 + 기존 사내 모듈만.
- **테스트는 pytest 가 아니다.** 각 모듈 안 `_selftest()` / `selftest()` 를 `python3 <파일>.py` 로 돌린다 (`motion.py`, `activities.py`, `storydot.py` 가 이미 이 방식).
- **린트는 `ruff check <파일>`.** 모든 커밋 전에 통과해야 한다.
- **주석과 문서는 한국어.** 기존 코드 전체가 한국어다.
- **게이트는 LLM 판단이 아니다.** 결정적 검사 실패는 재시도가 아니라 폐기.
- **0을 내는 것이 정상 동작이다.** 재료가 얇으면 빈 결과를 낸다. 억지로 채우지 않는다.
- `EVENT_MIN_EVIDENCE = 2` · `KINDS = ("결과", "감정", "시도", "발견", "갈등")` · `SNAP_LOOK = 20.0`
- **기존 파일을 고치지 않는다.** `storydot.py` · `generate.py` · `skills/quiz/` · `README.md` ·
  기존 `work/*_plan.json` 은 읽기 전용이다. 필요한 것은 **임포트해서 재사용**하고,
  달라져야 하는 것만 새 파일에 다시 정의한다. 기존 파이프라인은 계속 돌아야 한다.
- **결과는 새 파일에 쓴다.** `events.py` 는 `work/<작품>_plan.json` 을 읽고
  `work/<작품>_ev_plan.json` 을 쓴다. 원본을 덮어쓰지 않는다.
- **커밋 시 `git add -A` 금지.** 작업 트리에 이 작업과 무관한 대량 삭제가 있다. 파일 경로를 정확히 지정한다.

---

## File Structure

**전부 신규다. 기존 파일은 임포트 대상일 뿐 수정하지 않는다.**

| 파일 | 책임 | 재사용하는 것 |
| --- | --- | --- |
| `events.py` | 사건 추출 · 게이트 · 정착 · 개입지점 · `_ev_plan.json` 출력 | `storydot.detail_baseline` · `storydot.CLOSEUP_REL` · `storydot.claude_result` · `storydot.mmss` · `motion` · `grounding` · `visual` |
| `skills/events/SKILL.md` | 사건 추출 계약 | — |
| `skills/quiz_ev/SKILL.md` | 활동 생성 계약 + `level` 축 + 사건 절 | `skills/quiz/SKILL.md` 를 베껴 고친다 |
| `generate_ev.py` | 사건을 프롬프트에 넣는 생성 오케스트레이션 | `generate` 모듈을 임포트해 프롬프트 조립만 덮어쓴다 |
| `scan_ev.py` | 전편 스캔 그림 + 사건 트랙 | `scan` 모듈을 임포트해 `funnel`/`svg` 만 덮어쓴다 |
| `docs/사건파이프라인.md` | 새 경로 실행법과 회귀 결과 | README 는 안 고친다 |

### 왜 점수 함수를 다시 정의하는가

`storydot.pick_score` 는 근거 정규화 기준으로 `P["min_evidence"]`(5) 를 쓴다. 사건 경로는
`EVENT_MIN_EVIDENCE`(2) 여야 하므로 `events.py` 가 자기 `pick_score` 와 `choose` 를 갖는다
(합쳐 30줄 미만). `settle` 도 storydot 에 없어서 events.py 가 직접 갖는다.
`detail_baseline` 과 `CLOSEUP_REL` 은 storydot 에 이미 있으므로 임포트해 쓴다.

---

## Task 1: 사건 게이트

**Files:**
- Create: `events.py`
- Test: `events.py` 안 `selftest()` (별도 테스트 파일 없음 — 이 저장소 관례)

**Interfaces:**
- Consumes: `grounding._grounding_score`, `grounding.GROUNDED_RATIO`, `storydot.claude_result`
- Produces: `EVENT_MIN_EVIDENCE: int`, `RECALL_WINDOW: float`, `KINDS: tuple[str, ...]`, `gate(ev: dict, canon_by_id: dict, names: set[str]) -> tuple[bool, str, dict]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`events.py` 를 새로 만들고 아래를 넣는다.

```python
#!/usr/bin/env python3
"""사건 추출 → 개입지점.

정본 전사본을 claude CLI 에 넘겨 "무슨 일이 있었나"를 뽑고, 사건마다 직후의
안전한 자리로 스냅해 개입지점을 만든다.

    python3 events.py work/<작품>_plan.json

storydot.py 는 LLM 을 안 부른다. 사건 추출이 LLM 이므로 이 파일로 분리했다.
"""
import sys
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

    print("사건 게이트 자체검사 8/8 통과")


if __name__ == "__main__":
    selftest()
```

- [ ] **Step 2: 실패를 확인한다**

Run: `python3 events.py`
Expected: FAIL — `NameError: name 'gate' is not defined`

- [ ] **Step 3: 최소 구현을 쓴다**

`selftest()` 정의 **앞에** 넣는다.

```python
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `python3 events.py`
Expected: `사건 게이트 자체검사 8/8 통과`

- [ ] **Step 5: 린트하고 커밋한다**

```bash
ruff check events.py
git add events.py
git commit -m "feat(events): 사건 결정적 게이트 6종"
```

---

## Task 2: snap_forward

**Files:**
- Modify: `events.py`

**Interfaces:**
- Consumes: Task 1 의 `events.py`
- Produces: `SNAP_LOOK: float`, `snap_forward(t: float, canon: list[dict], end: float, pad: float, look: float = SNAP_LOOK) -> tuple[float | None, float]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`selftest()` 의 `print(...)` 바로 **앞에** 넣는다.

```python
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `python3 events.py`
Expected: FAIL — `NameError: name 'snap_forward' is not defined`

- [ ] **Step 3: 최소 구현을 쓴다**

`gate()` 앞에 상수를, `_grounding_score_of()` 뒤에 함수를 넣는다.

```python
# 사건 직후 몇 초까지 안전한 자리를 찾을 것인가.
# visual.extract_evidence_frames 가 이미 span=20.0 을 쓴다. 같은 창을 써야
# 프레임 근거와 사건이 겹치고 새 눈금이 늘지 않는다.
SNAP_LOOK = 20.0
```

```python
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
        # 본편 끝을 넘는 발화 시작을 여유로 세면 안 된다. 엔딩 주제가 뒤는
        # 개입 금지 구간이라 "그때까지 조용하다"가 성립하지 않는다.
        nxt = min(min((s for s in starts if s >= b), default=end), end)
        if nxt - b >= pad:
            return round(b, 2), round(nxt - b, 2)
    return None, 0.0
```

- [ ] **Step 4: 통과를 확인한다**

Run: `python3 events.py`
Expected: `사건 게이트 자체검사 8/8 통과` (assert 가 하나도 안 터진다)

- [ ] **Step 5: 린트하고 커밋한다**

```bash
ruff check events.py
git add events.py
git commit -m "feat(events): snap_forward — 사건 직후로만 스냅"
```

---

## Task 3: 사건용 점수와 선택

**Files:**
- Modify: `events.py` (Task 1·2 에서 만든 신규 파일)

**Interfaces:**
- Consumes: Task 1·2, `storydot.mmss`
- Produces: `PICK_W: dict`, `SHOT_BONUS: dict`, `_sat(x, full) -> float`, `pick_score(c: dict, P: dict) -> float`, `choose(settled: list[dict], P: dict, rejected: list) -> list[dict]`

**`storydot.py` 는 건드리지 않는다.** `settle` 과 `detail_baseline` 은 Task 5 에서 임포트해 쓰고,
점수 기준이 다른 `pick_score`/`choose` 만 여기서 새로 정의한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`events.py` 의 `selftest()` 안, snap_forward 블록 뒤에 넣는다.

```python
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

    # storydot 원본을 덮어쓰지 않았음을 못박는다
    assert storydot.pick_score is not pick_score, "storydot 을 덮어썼다"
```

- [ ] **Step 2: 실패를 확인한다**

Run: `python3 events.py`
Expected: FAIL — `NameError: name 'pick_score' is not defined`

- [ ] **Step 3: 최소 구현을 쓴다**

먼저 임포트를 추가한다 (Task 1 에서는 안 썼으므로 넣지 않았다 — ruff F401):
```python
import storydot
```

`gate()` 앞에 넣는다. `storydot.py` 의 같은 이름 함수를 베끼되 정규화 기준만 바꾼다.

```python
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `python3 events.py`
Expected: 전 항목 통과

- [ ] **Step 5: 원본 무변경을 확인하고 커밋한다**

```bash
git diff --stat storydot.py generate.py skills/quiz/SKILL.md
```
Expected: 출력 없음

```bash
ruff check events.py
git add events.py
git commit -m "feat(events): 사건 기준 점수와 선택"
```

---

## Task 4: 사건 추출 계약과 claude 호출

**Files:**
- Create: `skills/events/SKILL.md`
- Modify: `events.py`

**Interfaces:**
- Consumes: Task 1~3, `storydot.claude_result`
- Produces: `extract(plan: dict) -> tuple[list[dict], list[tuple[str, str]]]` — (게이트 통과 사건, [(what, 폐기사유)])

- [ ] **Step 1: SKILL.md 를 쓴다**

`skills/events/SKILL.md`:

````markdown
---
name: events
description: 아동 애니메이션 정본 전사본을 읽고 "무슨 일이 있었나"를 사건 목록으로 뽑는다. 추출 전담 — 활동을 만들지 않는다.
allowed-tools: Read
---

# 사건 추출자

너는 아동 애니메이션 한 편의 전사본을 읽고 **사건**을 뽑는다.
활동이나 퀴즈를 만들지 마라. 사건만 낸다.

## 사건이란

**"무슨 일이 있었다"** 이다. **"이제 다음 장면이다"** 가 아니다.

| 사건이다 | 사건이 아니다 |
| --- | --- |
| 타요가 선발대회에서 탈락했다 | 시간이 흘러 선발대회 날이 되었어요 |
| 크롱이 곰인형의 실을 가져갔다 | 며칠 뒤, 버스들이 모여 있어요 |
| 아기상어가 새 동굴을 찾아냈다 | 드디어 대회가 열렸네요 |

오른쪽은 **장면 표지**다. 언제인지만 알려줄 뿐 무엇이 일어났는지 말하지 않는다.
아이에게 되물을 것이 없으므로 뽑지 마라.

## 절대 규칙

1. **근거 없는 사건은 쓰지 않는다.** 네 배경지식은 증거가 아니다.
   뽀로로가 펭귄이라는 것, 타요가 버스라는 것 — 전사본에 없으면 없는 것이다.
2. **모든 사건은 세그먼트 id 를 지목한다.** `evidence` 에 **2개 이상** 넣는다.
   1개짜리는 "누가 그렇게 말했다" 수준이라 되물을 게 없다.
3. **지목한 세그먼트는 서로 가까워야 한다.** 처음과 끝이 **100초를 넘으면 폐기**된다.
   유아는 그만큼 거슬러 기억하지 못한다.
4. **`what` 은 지목한 세그먼트에서 나와야 한다.** 그 대사들만 읽고도 그 문장이
   납득되어야 한다. 안 그러면 자동 폐기다.
5. **시각을 쓰지 마라.** `t` 같은 필드를 넣지 마라. 시각은 파이프라인이 계산한다.
6. **자신 없으면 만들지 마라.** 억지로 채운 10개보다 확실한 3개가 낫다.
   뽑을 게 없으면 빈 배열을 낸다. 그게 정상 동작이다.

## kind — 다섯 개뿐이다

| kind | 무엇 | 예 |
| --- | --- | --- |
| `결과` | 시도가 끝나고 결말이 났다 | 타요가 탈락했다 |
| `감정` | 인물이 감정을 드러냈다 | 크롱이 울음을 터뜨렸다 |
| `시도` | 인물이 무언가를 하려 했다 | 곰인형이 이불을 꿰매기 시작했다 |
| `발견` | 인물이 무언가를 알아냈다 | 아기상어가 동굴을 찾아냈다 |
| `갈등` | 인물들이 부딪쳤다 | 크롱과 뽀로로가 이불을 두고 다퉜다 |

이 다섯 개 밖의 값을 쓰면 폐기된다.

## who

사건의 주체. 전사본에 이름이 나온 인물만 쓴다. 확실치 않으면 `null` 을 넣어라.
지어낸 이름은 자동으로 `null` 로 강등된다.

## 출력

설명 없이 JSON 만. 코드블록으로 감싸지 마라. JSON 뒤에 아무 말도 붙이지 마라.

```
{"events": [
  {"what": "타요가 구조대 선발대회에서 탈락했다",
   "who": "타요", "kind": "결과",
   "evidence": ["s142", "s143", "s147"]},

  {"what": "곰인형이 찢어진 이불을 꿰매기 시작했다",
   "who": "곰인형", "kind": "시도",
   "evidence": ["s117", "s119"]}
]}
```

한 편에서 **최대 12개**. 못 만들겠으면 `{"events": []}`.
````

- [ ] **Step 2: extract 와 run 을 쓴다**

`events.py` 상단 임포트에 추가:
```python
import json
import re
import subprocess
```

`selftest()` 앞에 넣는다:

```python
SKILLS = ROOT / "skills"
TIMEOUT = 300
MAX_EVENTS = 12


def _first_json_object(text: str) -> dict:
    """LLM 이 앞뒤에 말을 붙여도 첫 JSON 객체만 꺼낸다."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise RuntimeError(f"JSON 을 못 찾았다: {text[:200]}")
    return json.loads(m.group(0))


def _claude(prompt: str) -> dict:
    """claude CLI 를 헤드리스로 1회 호출한다. generate.py 의 _claude 와 같은 규약."""
    sysmsg = (SKILLS / "events" / "SKILL.md").read_text()
    cmd = ["claude", "-p", prompt, "--append-system-prompt", sysmsg,
           "--allowed-tools", "Read", "--output-format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패(events): {r.stderr[-300:]}")
    return _first_json_object(storydot.claude_result(r.stdout))


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
    for i, ev in enumerate(raw.get("events", [])[:MAX_EVENTS]):
        ok, why, out = gate(ev, canon_by_id, names)
        if not ok:
            dropped.append((ev.get("what", "?"), why))
            continue
        out["id"] = f"e{len(kept):02d}"
        out["evidence_text"] = [canon_by_id[j]["text"] for j in out["evidence"]]
        kept.append(out)
    kept.sort(key=lambda e: e["t"])
    return kept, dropped
```

- [ ] **Step 3: 게이트 자체검사가 여전히 도는지 확인한다**

Run: `python3 events.py`
Expected: 전 항목 통과. `extract` 는 claude 가 필요해서 자체검사에 없다.

- [ ] **Step 4: 린트하고 커밋한다**

```bash
ruff check events.py
git add events.py skills/events/SKILL.md
git commit -m "feat(events): 사건 추출 계약과 claude 호출"
```

---

## Task 5: 사건 → 개입지점 배선

**Files:**
- Modify: `events.py`

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: `run(plan_path: Path) -> dict` — `<작품>_plan.json` 을 **읽기만** 하고 `<작품>_ev_plan.json` 을 새로 쓴다

- [ ] **Step 1: settle 을 쓴다**

`storydot.py` 에는 `settle` 이 **없다** (확인함: `grep -n "^def settle" storydot.py` → 없음).
`events.py` 가 직접 정의한다. `motion` 임포트를 추가하고 `run()` 앞에 넣는다.

```python
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
        scale = "closeup" if tv < storydot.CLOSEUP_REL * baseline_tv else (
            "wide" if tv > baseline_tv * 1.15 else "medium")
        if scale == "closeup":
            # 수치는 조용해도 익스트림 클로즈업은 동작 한복판이다.
            rejected.append((c["t"], f"클로즈업 (디테일 {tv:.1f} < 기준 {baseline_tv:.1f})"))
            continue
        t = pause["t"]
        nxt = min(min((s["t0"] for s in canon if s["t0"] >= t), default=end), end)
        gap = nxt - t
        if gap < P["speech_pad"]:
            rejected.append((c["t"], f"정착 {t:.2f}s 에서 발화 재개까지 {gap:.1f}s"))
            continue
        c.update(t=t, gap=round(gap, 2), pause_score=round(pause["score"], 2),
                 pause_kind=pause["kind"], shot=scale, why=pause["why"])
        out.append(c)
    return out
```

**주의:** `storydot.CLOSEUP_REL` 은 0.62 이고 원본 판정식은 `tv < baseline_tv * CLOSEUP_REL` 이다.
위 코드의 곱셈 순서가 같은지 확인하라.

- [ ] **Step 2: run 을 쓴다**

`settle()` 뒤에 넣는다.

```python
def run(plan_path: Path) -> dict:
    """plan.json 을 **읽기만** 하고 사건·개입지점을 채운 eplan.json 을 새로 쓴다.

    원본을 덮어쓰지 않는다. 기존 파이프라인(generate.py, seed-from-work.js)이
    계속 옛 결과로 돌 수 있어야 하고, 옛 결과와 새 결과를 나란히 비교해야 한다.
    """
    plan = json.loads(plan_path.read_text())
    video = Path(plan["video"])
    P, canon, end = plan["params"], plan["canonical"], plan["end"]

    evs, dropped = extract(plan)
    rejected = [(0.0, f"[사건폐기] {w}: {r}") for w, r in dropped]

    # 사건 → 후보. 사건이 끝난 뒤로만 민다.
    cands = []
    for e in evs:
        if e["t"] < P["min_start"]:
            rejected.append((e["t"], f"몰입 전 구간 (<{P['min_start']:.0f}s)"))
            continue
        t, gap = snap_forward(e["t"], canon, end, P["speech_pad"])
        if t is None:
            rejected.append((e["t"], f"사건 직후 {SNAP_LOOK:.0f}초 안에 멈출 자리 없음"))
            continue
        cands.append({"t": t, "gap": gap, "n_ev": len(e["evidence"]),
                      "event": e, "snapped": t > e["t"]})

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
        "n_ev": c["n_ev"],
        "event_id": c["event"]["id"], "kind": c["event"]["kind"],
        "asked_by": c["event"]["who"], "what": c["event"]["what"],
        "pause": {"score": c.get("pause_score"), "kind": c.get("pause_kind"),
                  "shot": c.get("shot"), "why": c.get("why")},
        "frames": c.get("frames", []), "colors": c.get("colors", {}),
        "snapped": c.get("snapped", False),
        "evidence": [{"id": i, "t0": by_id[i]["t0"], "t1": by_id[i]["t1"],
                      "text": by_id[i]["text"], "conf": by_id[i]["conf"]}
                     for i in c["event"]["evidence"]],
    } for k, c in enumerate(chosen)]
    plan["rejected"] = [{"t": t, "why": w} for t, w in rejected]
    out = plan_path.with_name(plan_path.name.replace("_plan.json", "_ev_plan.json"))
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=1))
    plan["_out"] = str(out)
    return plan


def report(plan: dict) -> None:
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
              f"  근거 {len(it['evidence'])}건")
    if plan["rejected"]:
        print("기각:")
        for x in plan["rejected"]:
            print(f"  ✗ {storydot.mmss(x['t'])}  {x['why']}")
```

`__main__` 을 바꾼다:
```python
if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        selftest()
        sys.exit(0)
    for p in args:
        r = run(Path(p).expanduser())
        report(r)
        print(f"  → {r['_out']}")
```

- [ ] **Step 3: 자체검사가 여전히 도는지 확인한다**

Run: `python3 events.py`
Expected: 전 항목 통과 (인자 없으면 selftest 로 빠진다)

- [ ] **Step 4: 실제 1편으로 손으로 확인한다**

기존 `work/타요1화_plan.json` 이 이미 있으므로 `storydot.py` 를 다시 돌릴 필요가 없다.

```bash
python3 events.py work/타요1화_plan.json
git diff --stat work/타요1화_plan.json     # 원본이 안 바뀌었는지 — 출력 없어야 한다
```
Expected: `work/타요1화_ev_plan.json` 이 새로 생기고, 사건 목록과 kind 분포가 찍히고, 개입지점마다 `[kind] 화자` 와 사건 문장이 나온다.
사건이 0건이거나 개입지점이 0이어도 **실패가 아니다** — 폐기 사유가 `기각:` 에 남는지 확인한다.

- [ ] **Step 5: 린트하고 커밋한다**

```bash
ruff check events.py
git add events.py
git commit -m "feat(events): 사건에서 개입지점 산출"
```

---

## Task 6: 사건을 쓰는 생성 경로 (신규)

**Files:**
- Create: `skills/quiz_ev/SKILL.md`
- Create: `generate_ev.py`

**Interfaces:**
- Consumes: Task 5 의 `_ev_plan.json` — `interrupts[].what` / `.kind` / `.asked_by`
- Produces: 활동 카드에 `level: 1 | 2 | 3` 필드

**`skills/quiz/SKILL.md` 와 `generate.py` 는 안 고친다.** 기존 생성 경로가 그대로 살아 있어야
옛 결과와 비교할 수 있다.

- [ ] **Step 1: quiz 스킬을 복사한다**

```bash
mkdir -p skills/quiz_ev && cp skills/quiz/SKILL.md skills/quiz_ev/SKILL.md
```

- [ ] **Step 2: 프런트매터 이름을 바꾼다**

`skills/quiz_ev/SKILL.md` 첫 줄들의 `name: quiz` 를 `name: quiz_ev` 로 바꾸고
`description` 끝에 ` 사건과 레벨 축을 함께 받는다.` 를 붙인다.

- [ ] **Step 3: 활동 유형 표에 레벨 열을 넣는다**

`## 활동 유형` 아래 다섯 개 표 전부에 `레벨` 열을 추가한다. 배정은 아래 그대로.

| 레벨 | 유형 |
| --- | --- |
| 1 | 개수 세기 · 색깔 퀴즈 · 모양 찾기 · 같은 것 찾기 · 크기 비교 · 순서 세기 · 분류하기 |
| 2 | 이야기 이해 · 낱말 알기 · 문장 배열 · 마음 읽기 · 도움 주고받기 · 장면 감상 |
| 3 | 원인과 결과 · 이어질 말 상상 · 내가 그 자리라면 · 안전 알기 · 그림으로 표현 |

예: `| \`개수 세기\` | **1** | 3세(1~5) 4세(1~10) | **프레임** | 화면의 사물 수 |`

- [ ] **Step 4: 사건 절과 레벨 규칙을 넣는다**

`## 좋은 활동의 조건` 절 끝에 두 줄을 추가한다.

```markdown
- **레벨 1 만 4개를 만들지 마라.** 화면에서 셀 수 있는 것만 묻는 활동이 전부이면
  아이는 보이는 것만 대답하게 된다. **레벨 2 이상을 최소 하나** 넣는다.
- **사건이 주어지면 그것을 물어라.** 개입지점에는 `what`(무슨 일이 있었나)과 `kind` 가
  붙어 온다. `결과`·`갈등` 은 "왜 그렇게 됐을까"(레벨 3), `감정` 은
  "어떤 마음이었을까"(레벨 2)가 자연스럽다.
```

`## 출력` 의 JSON 예시 세 개 모두에 `"level"` 을 넣는다. 예:
```
{"type": "이야기 이해", "domain": "의사소통", "level": 2, ...}
```

- [ ] **Step 5: generate_ev.py 를 쓴다**

`generate.py` 구조를 확인했다 (추측하지 마라, 아래가 실제다):
- 진입점은 `main(plan_path: Path)` 이고 `__main__` 블록이 그것을 부른다.
- `run_slot(plan, it, work)` 안에서 `b = bundle(it)` 로 증거 번들 문자열을 만든 뒤,
  `_claude("quiz", f"{b}\n\n위 증거만으로 활동을 만들어라.", extra_dirs=[work])` 를 부른다.
- 같은 `b` 가 검증자 프롬프트에도 들어간다.
- `it` 는 개입지점 dict 그대로다 — Task 5 가 넣은 `what`/`kind`/`asked_by` 가 여기 들어 있다.

따라서 `bundle` 을 감싸면 사건이 생성자와 검증자 양쪽 프롬프트에 한 번에 들어간다.
`_claude` 를 감싸는 것보다 낫다 — `_claude` 는 어느 슬롯인지 모른다.

```python
#!/usr/bin/env python3
"""사건을 프롬프트에 넣는 활동 생성.

generate.py 를 임포트해 두 가지만 갈아 끼운다.
  · bundle()  → 증거 번들 앞에 사건 머리말을 붙인다 (생성자·검증자 양쪽에 반영된다)
  · _claude() → skill "quiz" 를 "quiz_ev" 로 돌린다. "verify" 는 그대로 둔다.

원본은 안 고친다 — 옛 경로가 그대로 살아 있어야 나란히 비교가 된다.

    python3 generate_ev.py work/<작품>_ev_plan.json
"""
import sys
from pathlib import Path

import generate


def event_prefix(it: dict) -> str:
    """개입지점에 붙은 사건을 프롬프트 머리말로 만든다. 사건이 없으면 빈 문자열."""
    if not it.get("what"):
        return ""
    who = it.get("asked_by") or "누군가"
    return (f"## 이 지점에서 방금 일어난 일\n"
            f"  {it['what']}\n"
            f"  주체: {who}  ·  종류: {it['kind']}\n"
            f"이 일에 대해 묻는 활동을 **최소 하나** 만들어라.\n\n")


_orig_bundle = generate.bundle
_orig_claude = generate._claude


def bundle_ev(it: dict) -> str:
    return event_prefix(it) + _orig_bundle(it)


def claude_ev(skill: str, prompt: str, extra_dirs=()):
    return _orig_claude("quiz_ev" if skill == "quiz" else skill, prompt, extra_dirs)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        sys.exit("사용법: python3 generate_ev.py work/<작품>_ev_plan.json")
    generate.bundle = bundle_ev
    generate._claude = claude_ev
    generate.main(Path(args[0]).expanduser())
```

**주의:** `run_slot` 은 모듈 전역의 `bundle`/`_claude` 를 이름으로 찾으므로 위 대입이 먹는다.
`from generate import bundle` 처럼 이름을 당겨오면 안 된다 — 그러면 대입이 원본에 안 닿는다.

- [ ] **Step 6: 1편으로 확인한다**

```bash
python3 generate_ev.py work/타요1화_ev_plan.json
git diff --stat generate.py skills/quiz/SKILL.md    # 출력 없어야 한다
```
Expected: 카드에 `level` 이 붙고, 레벨 2 이상이 최소 하나 나온다.
안 나오면 `skills/quiz_ev/SKILL.md` 의 규칙 문구를 강하게 고친다 (자동 게이트는 이번 범위가 아니다).

- [ ] **Step 7: 커밋**

```bash
ruff check generate_ev.py
git add skills/quiz_ev/SKILL.md generate_ev.py
git commit -m "feat(quiz_ev): 레벨 축과 사건을 쓰는 생성 경로 (신규)"
```

---

## Task 7: 사건 트랙이 있는 스캔 (신규)

**Files:**
- Create: `scan_ev.py`

**Interfaces:**
- Consumes: `scan` 모듈, `_ev_plan.json` 의 `events` / `interrupts[].event_id`
- Produces: `work/<작품>_escan.svg`

**`scan.py` 는 안 고친다.**

- [ ] **Step 1: scan_ev.py 를 쓴다**

```python
#!/usr/bin/env python3
"""사건 트랙이 있는 전편 스캔.

scan.py 를 임포트해 깔때기와 서사 트랙만 사건 기준으로 덮어쓴다.

    python3 scan_ev.py ~/Downloads/test_videos/타요1화.mp4
"""
import json
import sys
import unicodedata as ud
from pathlib import Path

import motion
import scan


def scan_ev(video: Path) -> dict:
    """scan.scan 을 돌리고 eplan 의 사건을 얹는다."""
    r = scan.scan(video)
    key = ud.normalize("NFC", video.stem)
    ep = next((p for p in scan.WORK.glob("*_ev_plan.json")
               if ud.normalize("NFC", p.stem) == key + "_ev_plan"), None)
    if ep is None:
        sys.exit(f"work/{key}_ev_plan.json 이 없다. events.py 를 먼저 돌려라.")
    e = json.loads(ep.read_text())
    r["plan"]["events"] = e.get("events", [])
    r["plan"]["interrupts"] = e.get("interrupts", [])
    return r


def funnel(r: dict):
    """scan.funnel 의 네 번째 단계를 act 경계에서 사건으로 바꾼다."""
    rows = scan.funnel(r)
    rows[3] = ("+ 사건이 있음", len(r["plan"].get("events", [])),
               "LLM 추출 + 게이트 통과")
    return rows


def svg(r: dict) -> str:
    """scan.svg 를 그대로 쓰되 사건 눈금을 첫 트랙 위에 덧그린다."""
    base = scan.svg(r)
    dur = r["dur"]
    used = {it.get("event_id") for it in r["plan"].get("interrupts", [])}
    marks = []
    y = scan.TOP
    for ev in r["plan"].get("events", []):
        xx = scan._x(ev["t"], dur)
        on = ev["id"] in used
        marks.append(f'<line x1="{xx:.1f}" y1="{y}" x2="{xx:.1f}" '
                     f'y2="{y + scan.TRACK_H}" '
                     f'stroke="{"#0B6E77" if on else "#A9B4B6"}" '
                     f'stroke-width="{3 if on else 1.5}"/>')
        marks.append(f'<text x="{xx + 3:.1f}" y="{y + 11}" font-size="8.5" '
                     f'fill="#3D474A">{scan._esc(ev["kind"])}</text>')
    return base.replace("</svg>", "\n".join(marks) + "\n</svg>")


if __name__ == "__main__":
    for v in [a for a in sys.argv[1:] if not a.startswith("-")]:
        r = scan_ev(Path(v).expanduser())
        out = scan.WORK / f"{r['key']}_escan.svg"
        out.write_text(svg(r), encoding="utf-8")
        print(f"\n{'='*66}\n{r['key']}   {scan.mmss(r['dur'])}")
        prev = None
        for label, n, note in funnel(r):
            drop = "" if prev is None else f"  ({n/prev*100:>5.1f}%)"
            print(f"  {n:>5}  {label:<26}{drop:>10}   {note}")
            prev = n if n else prev
        print(f"  → {out}")
```

**구현자 주의:** `scan.py` 의 `funnel` 은 5행을 돌려준다. 인덱스 3 이 act 단계인지
먼저 확인하라 (`python3 -c "import scan, json; print([r[0] for r in scan.funnel(...)])"` 대신
`scan.py` 를 열어 `funnel` 정의를 읽으면 된다). 다르면 라벨로 찾아 바꾼다.
`motion` 임포트가 안 쓰이면 지운다.

- [ ] **Step 2: 확인한다**

```bash
python3 scan_ev.py ~/Downloads/test_videos/타요1화.mp4
git diff --stat scan.py     # 출력 없어야 한다
```
Expected: `work/타요1화_escan.svg` 가 생기고, 첫 트랙에 `결과`·`감정` 라벨 눈금이 보인다.
깔때기 네 번째 줄이 사건 개수다.

- [ ] **Step 3: 커밋**

```bash
ruff check scan_ev.py
git add scan_ev.py
git commit -m "feat(scan_ev): 사건 트랙이 있는 전편 스캔 (신규)"
```

---

## Task 8: 5편 회귀와 분포 측정

**Files:**
- Create: `docs/사건파이프라인.md`

**`README.md` 는 안 고친다.** 새 경로 설명은 새 문서에 쓴다.

- [ ] **Step 1: 5편을 돌린다**

`work/*_plan.json` 은 이미 있으므로 `storydot.py` 를 다시 안 돌린다.

```bash
for v in 타요1화 뽀로로1화 아기상어1화 티니핑1화 브레드1화; do
  python3 events.py work/${v}_plan.json
done
git status --porcelain work/    # _plan.json 이 M 으로 뜨면 안 된다
```

- [ ] **Step 2: 분포를 집계한다**

```bash
python3 - <<'PY'
import json, glob, unicodedata as ud
from collections import Counter
K, tot = Counter(), Counter()
for f in sorted(glob.glob("work/*_ev_plan.json")):
    n = ud.normalize("NFC", f.split("/")[-1].replace("_ev_plan.json",""))
    r = json.load(open(f))
    evs, its = r.get("events", []), r.get("interrupts", [])
    dropped = sum(1 for x in r["rejected"] if "사건폐기" in x["why"])
    print(f"{n:<11} 사건 {len(evs):>2} (폐기 {dropped:>2})  개입지점 {len(its)}  "
          f"화자있음 {sum(1 for i in its if i.get('asked_by'))}")
    for e in evs: K[e["kind"]] += 1
    tot["ev"] += len(evs); tot["it"] += len(its); tot["drop"] += dropped
print(f"\n합계 사건 {tot['ev']}  폐기 {tot['drop']}  개입지점 {tot['it']}")
print("kind 분포: " + " · ".join(f"{k}{v}" for k, v in K.most_common()))
PY
```

- [ ] **Step 3: 판정하고 기록한다**

`docs/사건파이프라인.md` 를 새로 만들고 실행법과 위 출력을 넣는다. 판정표:

| 확인 | 통과 기준 | 실패 시 |
| --- | --- | --- |
| 사건이 잡히는가 | 작품당 3건 이상 | `skills/events/SKILL.md` 의 "사건 vs 장면 표지" 표를 강화 |
| 게이트가 과폐기하는가 | 폐기율 50% 미만 | `EVENT_MIN_EVIDENCE` 를 2→1, 또는 `GROUNDED_RATIO` 조정 |
| **레벨 2·3 이 나오는가** | `결과`+`갈등`+`감정` 이 전체 사건의 40% 이상 | `skills/events/SKILL.md` 의 kind 예시를 보강 |
| 화자가 잡히는가 | 개입지점의 절반 이상에 `asked_by` | `series/<작품>.json` 이름 사전을 채운다 |
| 개입지점 | **개수는 판정 기준이 아니다.** 기준선 7건보다 줄어도 무방 | — |

기준선(기존 경로): 개입지점 7건, 활동 26건, 레벨 1 편중.

문서에 실행법도 넣는다:

```bash
python3 storydot.py 영상.mp4              # 기존 — 정본 + act (LLM 없음)
python3 events.py work/X_plan.json        # 신규 — 사건 + 개입지점 → X_ev_plan.json
python3 generate_ev.py work/X_ev_plan.json  # 신규 — 레벨 축 활동 생성
python3 scan_ev.py 영상.mp4               # 신규 — 사건 트랙 그림
```

기존 경로(`generate.py work/X_plan.json`)는 그대로 살아 있어 나란히 비교할 수 있다고 적는다.

- [ ] **Step 4: 커밋**

```bash
git add docs/사건파이프라인.md
git commit -m "docs: 사건 기반 경로 실행법과 회귀 결과"
```

---

## Task 9: 개입 평가 축 — 응답 지연을 기존 경로에 얹는다

**Files:**
- Modify: `backend/server/db.js` (마이그레이션 1블록 + INSERT 1컬럼)
- Modify: `backend/server/index.js` (검증·전달 1~2줄)
- Modify: `frontend/App.js` (`recordResult` 인자 1개)
- Modify: `frontend/screens/Break.js` (표시 시각 캡처 + 인자 1개)
- Create: `tools/latency-report.py`

**계획 정정.** 처음에는 새 텔레메트리 엔드포인트와 `work/telemetry.jsonl` 을 만들려 했다.
실제 코드를 보니 **이미 같은 경로가 있다** — 새로 만들 이유가 없다.

```
Break.js:38   onResult(activityId, result, template)
  → App.js:647  recordResult
  → App.js:219  POST /activity-results {session_id, activity_id, result}
  → index.js:121 → db.addActivityResult → activity_result 테이블
```

서버는 Express 가 아니라 순수 `node:http` 다. `app.post` 는 없다.
`db.js` 에는 이미 `migrate()` 관용구가 있다 (주석: *"CREATE TABLE IF NOT EXISTS 는 기존 테이블을
그냥 두므로 새 컬럼이 안 닿는다"*). 컬럼 추가는 거기 한 블록을 더한다.

**왜 필요한가.** 파이프라인 지표(게이트 통과율, 오답 0건)는 전부 **생성 품질**이다.
**개입이 좋았는지**의 지표가 없다 — 스펙 A-3 의 5단계 "평가"가 비어 있다.
동시에 심사 피드백 F("아이가 광고처럼 빨리 누르는 걸 학습한다")의 **유일한 반증 수단**이다.
회차가 갈수록 지연이 짧아지며 정답률이 떨어지면 그 학습이 실제로 일어난 것이다.

- [ ] **Step 1: 리포트를 먼저 쓴다 (실패하는 테스트)**

`tools/latency-report.py` 를 만든다. DB 없이 도는 자체검사부터.

```python
#!/usr/bin/env python3
"""응답 지연 분포 — 개입이 광고처럼 학습되고 있는지 본다.

    python3 tools/latency-report.py backend/server/data/stary.db

세션 안 몇 번째 문항이냐(회차)별로 지연 중앙값과 정답률을 낸다.
지연이 짧아지면서 정답률이 같이 떨어지면 아이가 "빨리 누르면 넘어간다"를
학습한 것이다 — 심사 피드백 F 의 가설을 이 표로 확인하거나 반증한다.
"""
import sqlite3
import sys
from pathlib import Path


def buckets(rows: list[dict]) -> list[tuple[int, int, float, float]]:
    """(회차, 건수, 지연 중앙값 ms, 정답률). 회차는 세션 안 문항 순서."""
    by_turn: dict[int, list[dict]] = {}
    seen: dict[object, int] = {}
    for r in sorted(rows, key=lambda x: x["created_at"]):
        s = r["session_id"]
        seen[s] = seen.get(s, 0) + 1
        by_turn.setdefault(seen[s], []).append(r)
    out = []
    for turn in sorted(by_turn):
        g = by_turn[turn]
        lat = sorted(x["latency_ms"] for x in g)
        med = lat[len(lat) // 2] if lat else 0.0
        acc = sum(1 for x in g if x["result"] == "correct") / len(g)
        out.append((turn, len(g), float(med), acc))
    return out


def load(db_path: Path) -> list[dict]:
    """latency_ms 가 기록된 행만 읽는다. 옛 행은 NULL 이라 건너뛴다."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT session_id, result, latency_ms, created_at FROM activity_result "
        "WHERE latency_ms IS NOT NULL"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def _selftest() -> None:
    rows = [
        # 세션 A: 1번째 느리고 맞음, 2번째 빠르고 틀림
        {"session_id": 1, "created_at": 100, "latency_ms": 8000, "result": "correct"},
        {"session_id": 1, "created_at": 200, "latency_ms": 900, "result": "wrong"},
        # 세션 B: 같은 패턴
        {"session_id": 2, "created_at": 150, "latency_ms": 6000, "result": "correct"},
        {"session_id": 2, "created_at": 250, "latency_ms": 700, "result": "wrong"},
    ]
    b = buckets(rows)
    assert [t for t, *_ in b] == [1, 2], b
    assert b[0][2] > b[1][2], "회차가 갈수록 지연이 줄어야 이 표본에서 맞다"
    assert b[0][3] == 1.0 and b[1][3] == 0.0, b
    # 세션이 섞여도 회차 배정이 세션별로 독립이어야 한다
    assert b[0][1] == 2 and b[1][1] == 2, b
    # 한 세션만 있어도 안 깨진다
    assert len(buckets(rows[:1])) == 1
    print("지연 리포트 자체검사 통과")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        _selftest()
        sys.exit(0)
    rows = load(Path(args[0]).expanduser())
    if not rows:
        print("latency_ms 가 기록된 응답이 아직 없다.")
        sys.exit(0)
    print(f"{'회차':>4}{'건수':>6}{'지연중앙값':>12}{'정답률':>8}")
    for turn, n, med, acc in buckets(rows):
        print(f"{turn:>4}{n:>6}{med/1000:>10.1f}s{acc*100:>7.0f}%")
```

- [ ] **Step 2: 자체검사를 돌린다**

Run: `python3 tools/latency-report.py`
Expected: `지연 리포트 자체검사 통과`

- [ ] **Step 3: DB 컬럼을 더한다**

`backend/server/db.js` 의 `migrate()` 에 블록 하나를 더한다. 기존 `crop_bottom` 블록과 같은 모양.

```javascript
  const rcols = db.prepare('PRAGMA table_info(activity_result)').all().map((c) => c.name);
  if (!rcols.includes('latency_ms')) {
    // 문항이 뜨고 아이가 처음 누르기까지 걸린 시간. 옛 행은 NULL 로 남는다.
    db.exec('ALTER TABLE activity_result ADD COLUMN latency_ms INTEGER');
  }
```

`CREATE TABLE IF NOT EXISTS activity_result` 에도 `latency_ms INTEGER` 를 더한다 (새 DB 용).

`addActivityResult` 를 고친다:
```javascript
export function addActivityResult(db, { session_id, activity_id, result, drawing_path, latency_ms }) {
  db.prepare(
    'INSERT INTO activity_result (session_id, activity_id, result, drawing_path, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(session_id, activity_id, result, drawing_path ?? null, latency_ms ?? null, Date.now());
}
```

- [ ] **Step 4: 서버가 값을 통과시키게 한다**

`backend/server/index.js` 의 `/activity-results` 핸들러는 `addActivityResult(db, b)` 로 본문을
통째로 넘긴다. 구조분해가 `latency_ms` 를 이제 받으므로 **코드 변경이 필요 없을 수 있다.**
먼저 읽어서 확인하라. 본문을 화이트리스트로 걸러 넘기고 있다면 거기 `latency_ms` 를 더한다.
음수나 비정상적으로 큰 값은 `null` 로 떨어뜨린다 (0 이상 600000 이하만 통과).

- [ ] **Step 5: 프론트가 지연을 재게 한다**

`frontend/screens/Break.js`:

`const [tries, setTries] = useState(0);` 아래에 문항이 바뀔 때마다 표시 시각을 새로 잡는다.
```javascript
  const shownAt = React.useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [at]);
```

`answer` 안의 `onResult` 호출에 지연을 더한다 (38행):
```javascript
    if (onResult) onResult(quiz.activityId, right ? 'correct' : 'wrong',
                           quiz.activity_template, Date.now() - shownAt.current);
```
스킵 경로(61행)도 같이 고친다.

`frontend/App.js` 의 `recordResult` 가 4번째 인자를 받아 본문에 실어 보내게 한다 (219행 근처):
```javascript
    api('/activity-results', { method: 'POST', body: { session_id: sessionId.current,
        activity_id: activityId, result, latency_ms: latencyMs ?? null } });
```

**주의:** `frontend/screens/Watch.js` 도 `onResult` 를 두 곳에서 부른다(189·263행).
이번 범위는 Break 만이다. Watch 는 인자를 안 넘기므로 `latencyMs` 가 `undefined` → `null` 이 되어
그냥 기록이 안 될 뿐 깨지지 않는다. **보고서에 Watch 미적용을 남겨라** — 영상 중간 개입이야말로
"광고처럼 학습" 위험이 큰 자리라 다음 작업감이다.

- [ ] **Step 6: 손으로 확인한다**

```bash
cd backend/server && node test.js
```
Expected: 기존 테스트가 그대로 통과한다 (`test.js` 는 `latency_ms` 없이 `addActivityResult` 를
부르므로 `null` 이 들어가야 한다). 실패하면 그게 회귀다.

그다음 마이그레이션이 기존 DB 에서 도는지 본다.
```bash
node -e "import('./db.js').then(m => { const d = m.openDb('./data/stary.db'); console.log(d.prepare('PRAGMA table_info(activity_result)').all().map(c => c.name).join(' ')); })"
```
Expected: 컬럼 목록에 `latency_ms` 가 보인다.

- [ ] **Step 7: 커밋**

```bash
ruff check tools/latency-report.py
git add backend/server/db.js backend/server/index.js frontend/App.js \
        frontend/screens/Break.js tools/latency-report.py
git commit -m "feat(telemetry): 응답 지연을 activity_result 에 기록하고 회차별 분포를 낸다"
```

---

## 미해결 (2026-08-30)

실측: 5편 개입지점 5개 · 회상 거리 중앙값 22.6초 · 최대 36.3초 · 20초 초과 3개.

1. **회상 문항이 전제를 문장에 넣는 것이 규칙이 아니다.** 지금은 사건 머리말을 준
   덕에 생성자가 알아서 "열차가 가던 길이 갑자기 바뀐 이유는?" 처럼 전제를 데리고
   온다. 36초 전 일을 물어도 아이가 기억해 낼 필요가 없는 것은 화면이 아니라 이
   문장 덕이다. 그런데 SKILL.md 에 그런 규칙이 없어 다음 실행에 "왜 그랬을까요?" 로
   나와도 아무것도 막지 않는다.

2. **회상 문항과 추론 문항을 구분하지 않는다.** "어떤 마음일까?"(전제에서 생각)는
   36초가 지나도 답할 수 있지만 "왜 길이 바뀌었나?"(답이 대사에만 있음)는 기억력
   시험이다. since 는 개입-사건 거리만 재고 개입-정답 거리는 재지 않는다.

3. **티니핑 개입지점 3개 중 카드가 1개만 생성됐다** (346.4 · 525.0 유실, 694.6 만 남음).
   편당 1~2회를 겨우 맞춰 놓고 실제 도달은 그보다 적다.

4. **asked_by 가 5개 중 1개.** series/<작품>.json 의 confirmed 이름이 작품당 1~2명뿐.
   화자 분리(diarization)는 필요 없다 — 사건의 주체는 대사에서 나오고, 자막에는
   화자 표기가 없으며, 외부 패키지 0개 원칙과 충돌한다. 사람이 이름을 확정하면 된다.

셋 다 "아이가 답할 수 있는가"를 검증하는 수단이 없다는 한 가지 문제의 다른 얼굴이다.
게이트는 "정답이 근거 안에 있는가"만 본다. 근거가 완벽해도 아이는 못 풀 수 있다.
임계값을 더 짐작해서 정하기 전에 태블릿에서 아이 반응을 한 번 봐야 한다.
