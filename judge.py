"""고정 판정기 — **어떤 생성기의 게이트도 아니다.** (신규 · 기존 파일 무수정)

사다리 실험이 성립하려면 자가 모듈 밖에 고정돼 있어야 한다. STT 층에서 그게 됐던
이유는 환각 판별식(반복 루프·타임스탬프 붕괴·불가능한 발화속도)이 어느 설정에서든
동일했기 때문이다. 활동 층에는 그게 없었다 — 각 arm 이 **자기 게이트로 자기를
채점**하고 있었고, 자를 바꾸면 눈금이 바뀌었다.

    generate.py  →  자기 게이트로 폐기율 8.3%
    generate2.py →  자기 게이트로 폐기율 3.8%     ← 자가 다르다. 비교 불가

여기서는 모든 arm 의 출력을 **공통 형식으로 정규화**한 뒤 같은 자로 잰다.

    J0  참조 실재성   source_id / fact_id 가 실재하는가            결정적
    J1  인용 실재성   quote 가 전사본 어딘가에 글자 그대로 있는가   결정적
    J2  근거 정합성   quote 가 그 세그먼트에 있고 신뢰도가 충분한가 결정적
    J3  정답 근거성   정답이 증거에서 도출되는가                   근사 (전 arm 동일 함수)
    J4  색 정확성     정답 색이 그 시각 화면에 실재하는가           결정적 (픽셀 산술)

하나라도 위반하면 그 카드는 환각으로 센다.

**arm 이 인용을 어떻게 만들었는지는 판정에 영향을 주지 않는다.** generate2 는 인용을
시스템이 원문에서 슬라이스하므로 J1·J2 를 당연히 통과한다 — 그 당연함이 측정으로
확인되는 것이 요점이다(구조적 보장의 sanity check).

색 기준은 facts.json 의 color 재료를 쓴다. 이건 영상에서 12초 간격으로 결정적으로
계산된 값이라 **어느 arm 에도 속하지 않는다.**

    python3 judge.py                 자체검사 + 5편 arm 비교
    python3 judge.py 타요1화          한 편 상세
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import grounding
import storydot

ROOT = Path(__file__).parent
WORK = ROOT / "work"

# 유형별 정답 판정 규칙 — **모든 arm 에 동일하게 적용한다.**
# arm 마다 다르게 적용하면 그 순간 자가 흔들린다.
CREATIVE = {"이어질 말 상상", "내가 그 자리라면", "장면 감상",
            "그림으로 표현", "그림 감상문"}
# 정답이 증거에서 따라 나오지만 글자로는 안 나오는 유형. 문자열 대조를 걸면
# 사회관계 영역이 전멸한다(generate.py 가 실측으로 배운 교훈).
INFERENTIAL = {"마음 읽기", "원인과 결과", "도움 주고받기", "안전 알기"}
COLOR_TYPES = {"색깔 퀴즈"}
# 프레임을 직접 봐야만 검증되는 유형. 결정적 판정이 불가능하므로 J3 를 면제하고
# **판정 불가**로 따로 집계한다. 통과로 세면 그 arm 에 유리한 자가 된다.
FRAME_ONLY = {"개수 세기", "크기 비교", "모양 찾기", "같은 것 찾기",
              "분류하기", "순서 세기"}


# ── 판정 문맥 ───────────────────────────────────────────────────────────────
def context(name: str) -> dict:
    plan = json.loads((WORK / f"{name}_plan.json").read_text())
    canon = {s["id"]: s for s in plan["canonical"]}
    fp = WORK / f"{name}_facts.json"
    colors = []
    facts = {}
    if fp.exists():
        fx = json.loads(fp.read_text())
        facts = {f["id"]: f for f in fx["facts"]}
        colors = [(f["t0"], f["payload"]) for f in fx["facts"] if f["kind"] == "color"]
    return {"canon": canon, "facts": facts, "colors": sorted(colors),
            "texts": [s["text"] for s in plan["canonical"]]}


def palette_at(ctx: dict, t: float) -> dict | None:
    """그 시각에 가장 가까운 결정적 팔레트. arm 과 무관한 화면 사실."""
    if not ctx["colors"] or t is None:
        return None
    return min(ctx["colors"], key=lambda c: abs(c[0] - t))[1]


# ── 어댑터 — arm 출력을 공통 형식으로 ───────────────────────────────────────
def _as_v1(c: dict, t) -> dict:
    return {"arm": "v1", "type": c.get("type"), "answer": c.get("answer"),
            "quote": c.get("quote"), "source_id": c.get("source_id"),
            "ref": c.get("source_id") or c.get("frame_id"),
            "choices": c.get("choices") or [], "t": t}


def norm_v1(name: str, ctx: dict) -> list[dict]:
    """generate.py 출력을 공통 형식으로. quote 를 모델이 직접 썼다.

    `_raw.json` 이 있으면 **게이트 이전 생성자 출력 전량**을 쓴다. 없으면
    activities + dropped 로 근사하는데, 그건 dropped 에 검증자 거부가 섞여 있고
    검증자 이전에 사라진 것은 못 잡아 **분모가 가짜다.** 근사로 잰 값은
    비교에 쓰면 안 된다.
    """
    raw = WORK / f"{name}_raw.json"
    if raw.exists():
        return [_as_v1(c, c.get("_slot_t")) for c in json.loads(raw.read_text())["raw"]]
    p = WORK / f"{name}_cards.json"
    if not p.exists():
        return []
    out = []
    for s in json.loads(p.read_text())["slots"]:
        for c in list(s.get("activities", [])) + list(s.get("dropped", [])):
            out.append(_as_v1(c, s.get("t")))
    return out


def norm_v2(name: str, ctx: dict) -> list[dict]:
    """generate2.py raw. 모델은 fact_id 만 냈으므로 인용을 여기서 복원한다."""
    p = WORK / f"{name}_raw_v2.json"
    if not p.exists():
        return []
    out = []
    for c in json.loads(p.read_text())["raw"]:
        f = ctx["facts"].get(c.get("fact_id"))
        quote = src = None
        t = None
        if f is not None:
            t = f["t0"]
            if f["kind"] != "color":
                src = f["evidence"][0]
                seg = ctx["canon"].get(src)
                quote = seg["text"] if seg else None
        ans = c.get("answer")
        if ans is None and f is not None and f["kind"] == "color":
            pres = f["payload"]["present"]
            ci = c.get("color_index")
            ans = pres[ci] if isinstance(ci, int) and 0 <= ci < len(pres) else None
        if ans is None:
            ch = c.get("choices") or []
            ai = c.get("answer_index")
            ans = ch[ai] if isinstance(ai, int) and 0 <= ai < len(ch) else None
        out.append({"arm": "v2", "type": c.get("type"), "answer": ans,
                    "quote": quote, "source_id": src, "ref": c.get("fact_id"),
                    "choices": c.get("choices") or [], "t": t})
    return out


def norm_ladder(path: Path, ctx: dict) -> list[dict]:
    """arms.py 사다리 출력을 공통 형식으로.

    arm A·B 는 모델이 quote 를 직접 쓰고, C·D 는 fact_id 만 낸다. **어느 쪽이든
    같은 자로 잰다** — C·D 는 인용을 시스템이 복원하므로 J1·J2 를 당연히 통과하고,
    그 당연함이 측정으로 확인되는 것이 구조적 보장의 sanity check 다.
    """
    d = json.loads(path.read_text())
    out = []
    for c in d["raw"]:
        fid = c.get("fact_id")
        quote, src, t = c.get("quote"), c.get("source_id"), None
        ans = c.get("answer")
        if fid:                                    # arm C·D
            f = ctx["facts"].get(fid)
            if f is not None:
                t = f["t0"]
                if f["kind"] != "color":
                    src = f["evidence"][0]
                    seg = ctx["canon"].get(src)
                    quote = seg["text"] if seg else None
                elif ans is None:
                    pres = f["payload"]["present"]
                    ci = c.get("color_index")
                    ans = pres[ci] if isinstance(ci, int) and 0 <= ci < len(pres) else None
        else:                                      # arm A·B
            # arm 마다 id 공간이 다르다(A 는 세그먼트 id, B 는 재료 id 를 받는다).
            # 판정기가 한쪽 공간만 알면 다른 arm 이 통째로 위반 처리된다 — 실제로
            # arm B 가 36/36 위반으로 나왔고 그건 모델이 아니라 이 하네스의 결함이었다.
            f = ctx["facts"].get(src)
            if f is not None and f["kind"] != "color":
                src = f["evidence"][0]
            elif f is not None:
                t = f["t0"]
            seg = ctx["canon"].get(src)
            if seg is not None:
                t = seg["t0"]
        if ans is None:
            ch = c.get("choices") or []
            ai = c.get("answer_index")
            ans = ch[ai] if isinstance(ai, int) and 0 <= ai < len(ch) else None
        out.append({"arm": d["arm"], "rep": d["rep"], "type": c.get("type"),
                    "answer": ans, "quote": quote, "source_id": src,
                    "ref": fid or src, "choices": c.get("choices") or [], "t": t})
    return out


def ladder(name: str) -> None:
    """arm 별 환각률을 반복 평균과 함께 낸다."""
    ctx = context(name)
    files = sorted((WORK / "ladder").glob(f"{name}_*.json"))
    if not files:
        print("  사다리 출력이 없다. python3 arms.py <작품명>")
        return
    by_arm: dict = {}
    for f in files:
        cards = norm_ladder(f, ctx)
        judged = [judge_card(c, ctx) for c in cards]
        bad = [j for j in judged if not j["ok"]]
        rec = by_arm.setdefault(cards[0]["arm"] if cards else f.stem.split("_")[1],
                                {"reps": [], "codes": Counter(), "und": 0, "all": 0})
        chk = [j for j in judged if j["checkable"]]
        rec["reps"].append((len(chk), len([j for j in chk if not j["ok"]])))
        rec["all"] = rec.get("all", 0) + len(judged)
        rec["und"] += sum(1 for j in judged if j["undecidable"])
        rec["codes"].update(x.split()[0] for j in judged for x in j["violations"])

    print(f"\n{'arm':>4}{'전체':>6}{'검사가능':>9}{'환각':>6}{'환각률':>9}"
          f"{'표준편차':>9}{'검사가능률':>11}   위반 내역")
    print("─" * 88)
    for arm in sorted(by_arm):
        r = by_arm[arm]
        rates = [100 * b / n if n else 0.0 for n, b in r["reps"]]
        mean = sum(rates) / len(rates)
        var = sum((x - mean) ** 2 for x in rates) / len(rates)
        tot_n = sum(n for n, _ in r["reps"])
        tot_b = sum(b for _, b in r["reps"])
        codes = " ".join(f"{k}:{v}" for k, v in sorted(r["codes"].items()))
        cov = 100 * tot_n / r["all"] if r["all"] else 0.0
        print(f"{arm:>4}{r['all']:>6}{tot_n:>9}{tot_b:>6}{mean:>8.1f}%"
              f"{var ** 0.5:>8.1f}p{cov:>10.0f}%   {codes}")
    print(f"\n반복 {len(by_arm[sorted(by_arm)[0]]['reps'])}회 · rate 는 회차별 평균과 표준편차"
          f"\n검사가능률 = 결정적으로 검증 가능한 유형의 비율. 낮으면 검사를 회피한 것이다.")


# ── 판정 ────────────────────────────────────────────────────────────────────
def judge_card(card: dict, ctx: dict) -> dict:
    """위반 목록을 돌려준다. 빈 리스트면 통과."""
    v = []
    ctype = card.get("type") or ""
    ref, quote, ans = card.get("ref"), card.get("quote"), card.get("answer")

    # J0 참조 실재성 — 근거를 지어냈는가
    known = ref in ctx["canon"] or ref in ctx["facts"] or (
        isinstance(ref, str) and ref.startswith("f"))     # v1 의 frame_id
    if not ref or not known:
        v.append(f"J0 참조 없음({ref})")

    # J1·J2 인용 — 대사 근거형에만 적용
    if quote:
        if not any(quote in t for t in ctx["texts"]):
            v.append("J1 인용이 전사본에 없음")
        seg = ctx["canon"].get(card.get("source_id"))
        if seg is None:
            v.append("J2 근거 세그먼트 없음")
        else:
            if quote not in seg["text"]:
                v.append("J2 인용이 그 세그먼트에 없음")
            if seg["conf"] not in ("high", "medium"):
                v.append(f"J2 신뢰도 미달({seg['conf']})")

    # J3 정답 근거성
    if ctype in CREATIVE:
        if ans:
            v.append("J3 창작형인데 정답이 있음")
    elif ctype in FRAME_ONLY:
        # 프레임 근거가 **아예 없으면** 판정불가가 아니라 환각이다. 근거 없이 개수를
        # 주장한 것이기 때문이다. 판정불가로 세면 프레임 없이 개수 문제를 남발한
        # arm 에 유리한 자가 된다.
        has_frame = (isinstance(ref, str) and (ref.startswith("f") or ref.startswith("co"))) \
            or palette_at(ctx, card.get("t")) is not None and card.get("t") is not None
        if not has_frame:
            v.append("J3 화면 근거 없이 화면 문제")
    elif ctype in COLOR_TYPES:
        pass                                   # J4 가 담당
    elif ctype in INFERENTIAL:
        if not ans:
            v.append("J3 정답 없음")
    else:
        if not ans:
            v.append("J3 정답 없음")
        elif quote:
            g, why = grounding.check_answer({"type": ctype, "answer": ans}, [quote])
            if g == "ungrounded":
                v.append(f"J3 정답 무근거({why[:40]})")

    # J4 색 정확성 — 픽셀 산술이 반증한다
    if ctype in COLOR_TYPES and ans:
        pal = palette_at(ctx, card.get("t"))
        if pal is None:
            v.append("J4 팔레트 없음(판정 불가)")
        elif ans in pal.get("absent", []):
            v.append(f"J4 화면에 없는 색을 정답으로({ans})")
    # 결정적으로 검사 가능한 카드인가.
    #
    # 창작형·추론형은 J3 문자열 대조를 면제받는다(정답이 글자로 안 나오므로).
    # 그런데 환각률 분모에 그대로 넣으면 **검사받기 어려운 유형을 고른 arm 이
    # 유리해진다** — 실측에서 arm A 가 추론형 44% + 창작형 17% 를 만들어 0% 를
    # 기록했다. 실력이 아니라 회피였다. 분모를 검사 가능한 카드로 좁힌다.
    # FRAME_ONLY 도 뺀다. 프레임 근거만 있으면 통과시켜 버리는데(개수를 셀 방법이
    # 없다) 그건 검사가 아니라 무동작이다. 통과로 세면 그 유형을 남발한 arm 이 유리해진다.
    checkable = (ctype not in CREATIVE and ctype not in INFERENTIAL
                 and ctype not in FRAME_ONLY)
    return {"violations": v, "ok": not v, "checkable": checkable,
            "undecidable": ctype in FRAME_ONLY and not v}


def run(name: str) -> dict:
    ctx = context(name)
    res = {}
    for arm, cards in (("v1", norm_v1(name, ctx)), ("v2", norm_v2(name, ctx))):
        if not cards:
            continue
        judged = [(c, judge_card(c, ctx)) for c in cards]
        bad = [(c, j) for c, j in judged if not j["ok"]]
        und = sum(1 for _, j in judged if j["undecidable"])
        codes = Counter(x.split()[0] for _, j in judged for x in j["violations"])
        res[arm] = {"n": len(judged), "bad": len(bad), "undecidable": und,
                    "codes": dict(codes), "cases": bad}
    return res


# ── 자체검사 ────────────────────────────────────────────────────────────────
def selftest() -> None:
    """판정기가 무동작이 아님을 증명한다. 위반마다 실제로 걸려야 한다."""
    ctx = {"canon": {"s001": {"id": "s001", "text": "다른 실이 필요한데",
                              "conf": "medium"},
                     "s002": {"id": "s002", "text": "흐릿한 말", "conf": "low"}},
           "facts": {"co001": {"id": "co001", "kind": "color", "t0": 10.0,
                               "payload": {"present": ["파랑"], "absent": ["보라"]}}},
           "colors": [(10.0, {"present": ["파랑"], "absent": ["보라"]})],
           "texts": ["다른 실이 필요한데", "흐릿한 말"]}
    J = lambda c: judge_card(c, ctx)["violations"]
    base = {"type": "이야기 이해", "ref": "s001", "source_id": "s001",
            "quote": "다른 실이 필요한데", "answer": "실", "t": 1.0}

    assert J(base) == [], f"정상 카드가 걸렸다: {J(base)}"
    assert any("J0" in x for x in J({**base, "ref": "s999", "source_id": "s999",
                                    "quote": None})), "없는 참조를 통과시켰다"
    assert any("J1" in x for x in J({**base, "quote": "친구들이 모여 있어요"})), \
        "위조 인용을 통과시켰다"
    assert any("J2" in x and "신뢰도" in x
               for x in J({**base, "ref": "s002", "source_id": "s002",
                           "quote": "흐릿한 말"})), "저신뢰 근거를 통과시켰다"
    assert any("J3" in x for x in J({**base, "answer": "자동차"})), \
        "무관한 정답을 통과시켰다"
    assert any("J3" in x for x in J({**base, "type": "장면 감상",
                                     "answer": "무언가"})), "창작형 정답을 통과시켰다"
    assert J({**base, "type": "장면 감상", "answer": None}) == [], "창작형을 폐기했다"
    assert any("J4" in x for x in J({**base, "type": "색깔 퀴즈", "ref": "co001",
                                     "source_id": None, "quote": None,
                                     "answer": "보라", "t": 10.0})), \
        "화면에 없는 색을 통과시켰다"
    assert J({**base, "type": "색깔 퀴즈", "ref": "co001", "source_id": None,
              "quote": None, "answer": "파랑", "t": 10.0}) == [], "있는 색을 폐기했다"
    # 추론형은 문자열 대조를 면제한다 (전 arm 동일 규칙)
    assert J({**base, "type": "마음 읽기", "answer": "기뻐요"}) == [], \
        "추론형에 문자열 대조를 걸었다"
    print("자체검사 10/10 통과")


def main(argv: list[str]) -> int:
    selftest()
    if "--ladder" in argv:
        for n in [storydot.nfc(a) for a in argv if not a.startswith("-")]:
            print(f"\n{'='*74}\n{n}  사다리\n{'='*74}")
            ladder(n)
        return 0
    want = [storydot.nfc(a) for a in argv if not a.startswith("-")]
    plans = sorted(WORK.glob("*_plan.json"))
    if want:
        plans = [p for p in plans
                 if any(w in storydot.nfc(p.stem) for w in want)]

    print(f"\n{'작품':11s}{'arm':>5}{'카드':>5}{'환각':>5}{'환각률':>8}"
          f"{'판정불가':>8}   위반 내역")
    print("─" * 84)
    tot: dict = {}
    for pp in plans:
        name = storydot.nfc(pp.stem.replace("_plan", ""))
        for arm, r in run(name).items():
            rate = 100 * r["bad"] / r["n"] if r["n"] else 0.0
            codes = " ".join(f"{k}:{v}" for k, v in sorted(r["codes"].items()))
            print(f"{name:11s}{arm:>5}{r['n']:>5}{r['bad']:>5}{rate:>7.1f}%"
                  f"{r['undecidable']:>8}   {codes}")
            a = tot.setdefault(arm, {"n": 0, "bad": 0, "und": 0, "codes": Counter()})
            a["n"] += r["n"]; a["bad"] += r["bad"]; a["und"] += r["undecidable"]
            a["codes"].update(r["codes"])
            if want:
                for c, j in r["cases"][:6]:
                    print(f"      ✗ {c['type']}  {' · '.join(j['violations'])[:70]}")
    print("─" * 84)
    for arm, a in sorted(tot.items()):
        rate = 100 * a["bad"] / a["n"] if a["n"] else 0.0
        print(f"{'합계':11s}{arm:>5}{a['n']:>5}{a['bad']:>5}{rate:>7.1f}%"
              f"{a['und']:>8}   " + " ".join(f"{k}:{v}" for k, v in sorted(a["codes"].items())))
    approx = [p.stem.replace("_plan", "") for p in plans
              if not (WORK / f"{storydot.nfc(p.stem.replace('_plan',''))}_raw.json").exists()]
    if approx:
        print(f"\n※ v1 분모가 **근사**인 작품: {', '.join(approx)}"
              f"\n   (generate.py 를 다시 돌려 _raw.json 을 만들어야 실측이 된다)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
