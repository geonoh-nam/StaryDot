"""마무리 활동 생성기 — 영상이 끝난 뒤 화면과 함께 내는 문항. (신규 · 기존 파일 무수정)

중간 개입을 포기하면 정지점 문제가 통째로 사라진다(발화 밟기·위기 절정·샷 크기
오판·빈 화면·브레드 0개). 대신 회상 부담이 커진다 — 12분 전 내용을 스스로 떠올려야
하는데 어린아이일수록 자유 회상이 약하다.

그래서 **문제에 화면을 붙인다.** 회상이 재인(알아보기)으로 바뀌면서 난도가 급락한다.

    "버스가 몇 대였나요?"              12분 전을 기억해야 함
    "이 그림에 버스가 몇 대 있나요?"    눈앞에서 세면 됨 — 3세도 가능

정답은 **모델이 쓰지 않는다.** 재료에 이미 들어 있는 값을 시스템이 채운다.

    개수 세기   정답 = 관찰 재료의 count
    크기 비교   정답 = 관찰 재료의 big/small
    누가 나왔나 정답 = 관찰 재료의 name
    색깔 퀴즈   정답 = 관찰 재료의 colors[color_index]

모델이 하는 일은 **어느 재료로 어떤 질문을 쓸지 고르는 것**뿐이다. 정답을 지어낼
표면이 없다. 대사 기반 문항에서 나오던 J3(정답 근거성) 환각이 원리적으로 줄어든다.

    python3 generate3.py 타요1화 --dry    재료 구성만 확인 (LLM 호출 없음)
    python3 generate3.py 타요1화
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
SKILL = ROOT / "skills" / "quiz3" / "SKILL.md"
TIMEOUT = 600

MAX_ACTIVITY = 5     # **연령 한 칸당** 상한. 아이가 한 번에 보는 수는 편성기가 정한다
                     # (QUIZ_ITEMS_PER_BREAK). 여기서는 고를 수 있는 폭을 만든다.
# 만 나이. 재료의 age_min 과 같은 척도다. 3~5세는 누리과정, 6·7세는 초등 1~2학년이다.
# 칸마다 재료가 있어야 그 나이 문항이 나온다 — 없으면 조용히 건너뛴다(run 참고).
# 6·7세 재료는 어휘가 유일한 출처다(observe.py 의 WORD_AGE 6·7세 대역).
AGES = tuple(range(3, 8))
MAX_FACTS = 24       # 프롬프트에 실을 재료 상한

# 마무리 포맷에서 낼 유형. skills/quiz3 과 같아야 한다.
CREATIVE = {"장면 감상", "가장 좋았던 장면", "그림으로 표현"}
# 정답이 재료에 이미 확정돼 있는 유형 — 시스템이 채운다
FROM_FACT = {"개수 세기": "count", "크기 비교": "size",
             "누가 나왔나": "presence", "색깔 퀴즈": "objcolor",
             "같은 것 찾기": "count", "모양 찾기": "shape",
             "모두 세기": "sum", "수 가르기": "diff"}


def load(name: str) -> tuple[list[dict], dict]:
    """대사 재료 + 화면 관찰 재료를 합친다. 마무리는 화면이 중심이다."""
    fx = json.loads((WORK / f"{name}_facts.json").read_text())
    screen = []
    sp = WORK / f"{name}_screen.json"
    if sp.exists():
        screen = json.loads(sp.read_text())["facts"]
    # 팔레트 재료(facts.py 의 kind="color")는 **프레임 파일이 없다.** 마무리 문항은
    # 그림과 함께 내는 게 전제라 화면 없는 재료는 어차피 게이트에서 폐기된다.
    # 목록에 남겨 두면 모델이 그걸 골라 통째로 버려진다 — 실측으로 겪었다.
    return screen, fx


def spread(xs: list, n: int) -> list:
    if len(xs) <= n:
        return xs
    step = len(xs) / n
    return [xs[int(i * step)] for i in range(n)]


def render(facts: list[dict], age: int) -> str:
    lines = [f"## 만 {age}세 문항을 만든다", "",
             f"아래 재료는 **전부 만 {age}세용으로 고른 것**이다. `age` 는 모두 \"{age}세\" 로 쓴다.",
             "다른 나이로 쓰면 버려진다 — 이 재료는 그 나이에 맞춰 고른 것이기 때문이다.",
             "",
             "## 쓸 수 있는 재료 — 이 목록에 없는 것은 존재하지 않는다", ""]
    for f in facts:
        p = f["payload"]
        t = storydot.mmss(f["t0"])
        if f["kind"] == "count":
            body = f"{p['name']} {p['n']}개"
        elif f["kind"] == "objcolor":
            body = f"{p['name']} 색: " + ", ".join(
                f"{i}={c}" for i, c in enumerate(p["colors"]))
        elif f["kind"] == "size":
            body = f"큰 것 {p['big']} · 작은 것 {p['small']}"
        elif f["kind"] == "presence":
            body = f"{p['name']} 이(가) 보인다"
        elif f["kind"] == "sum":
            # 합은 적지 않는다. 알려 주면 모델이 문항에 답을 흘린다("모두 세 개지요?").
            body = "모으기: " + " + ".join(
                f"{x['name']} {x['n']}개" for x in p["parts"])
        elif f["kind"] == "diff":
            # 차도 적지 않는다. 합과 같은 이유 — 알려 주면 문항에 답이 새어 나간다.
            body = (f"가르기: {p['more']['name']} {p['more']['n']}개 · "
                    f"{p['less']['name']} {p['less']['n']}개")
        elif f["kind"] == "shape":
            body = "도형: " + ", ".join(p["shapes"])
        else:                                     # 팔레트 색
            body = "화면 색: " + ", ".join(
                f"{i}={c}" for i, c in enumerate(p.get("present", [])))
        lines.append(f"  {f['id']}  {t}  [{f['kind']}]  {f['age_min']}세+  {body}")
    lines += ["", f"위 재료로 만 {age}세 마무리 활동을 최대 {MAX_ACTIVITY}개 만들어라.",
              "아이가 그림을 보며 푼다. 화면으로 풀 수 없는 문제는 만들지 마라.",
              "재료 옆의 `N세+` 는 그 말을 아는 나이다. `age` 를 그보다 어리게 쓰면 버려진다."]
    return "\n".join(lines)


def _claude(prompt: str) -> dict:
    r = subprocess.run(
        ["claude", "-p", prompt, "--append-system-prompt", SKILL.read_text(),
         "--allowed-tools", "Read", "--add-dir", str(WORK),
         "--output-format", "json"],
        capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT,
        stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패(rc={r.returncode}): {r.stderr[-200:]}")
    text = storydot.claude_result(r.stdout)
    start = text.find("{")
    if start < 0:
        raise ValueError(f"JSON 없음: {text[:150]}")
    depth = 0
    in_str = esc = False
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("JSON 이 안 닫혔다")


SHAPES_ALL = ["동그라미", "네모", "세모", "별", "하트"]


def _norm(x: str) -> str:
    return "".join(str(x).split()).replace("색", "")


def _choices(answer: str, distractors: list[str], fid: str) -> list[str] | None:
    """정답 + 오답 2개로 보기를 만든다. **정답은 시스템이 넣는다.**

    정답을 재료에서 채우면서 보기는 모델에 맡겼더니 어긋났다 — 정답 '2' 인데
    보기가 ['둘','셋'], 정답 '초록색 버스' 인데 보기가 ['초록 버스'] 였다(실측).
    보기까지 시스템이 만들면 그 어긋남이 원천적으로 없다.

    정답 위치는 재료 id 로 정한다. 무작위를 쓰면 재실행 결과가 달라진다.
    """
    d, seen = [], {_norm(answer)}
    for x in distractors:                # 정답과 같은 말, 서로 같은 말은 보기가 못 된다
        if _norm(x) in seen:
            continue
        seen.add(_norm(x))
        d.append(x)
        if len(d) == 2:
            break
    if len(d) < 2:
        return None
    opts = [answer] + d
    k = sum(ord(c) for c in fid) % 3
    opts.insert(k, opts.pop(0))
    return opts


def _count_distractors(n: int) -> list[str]:
    """개수 오답 — 이웃한 수. 유아가 세어 보면 구별된다."""
    cand = [n - 1, n + 1, n + 2] if n > 1 else [n + 1, n + 2, n + 3]
    return [str(x) for x in cand if x >= 1][:2]


# ── 결정적 게이트 ───────────────────────────────────────────────────────────
def gate(card: dict, by_id: dict, tier: int | None = None) -> tuple[dict | None, str]:
    """정답을 재료에서 채우고 검사한다. 모델이 정답을 쓰지 않으므로 지어낼 수 없다."""
    fid = card.get("fact_id")
    f = by_id.get(fid)
    if f is None:
        return None, f"재료 없음 — {fid!r}"
    ctype = card.get("type", "")
    if ctype not in f["afford"]:
        return None, f"재료가 '{ctype}' 를 뒷받침하지 않음 (가능: {f['afford']})"

    # 유형이 아니라 어휘가 난이도를 정한다. 같은 '개수 세기' 라도 '빨간 차 3개' 는 3세가
    # 풀고 '갈색 액자 3개' 는 액자를 아는 나이여야 푼다.
    age = re.match(r"\d+", str(card.get("age", "")))
    if not age:
        return None, f"연령이 없다 — {card.get('age')!r}"
    if int(age.group()) < f["age_min"]:
        return None, (f"어휘가 {f['age_min']}세 말인데 {card['age']} 문항으로 냈다 "
                      f"— {f['payload'].get('name') or f['payload']}")
    # 칸 밖으로 새는 것을 두 방향에서 막는다. 나이 폭이 넓어질수록 둘 다 커진다.
    #   재료 쪽: by_id 에는 다른 칸 재료도 들어 있다. 세 살 재료를 골라 "7세" 를 달면
    #            하한 검사(7 >= 3)를 통과한다 — 말만 어려운 문항이 그렇게 난다.
    #   라벨 쪽: 반대로 라벨이 칸과 어긋나면 그 문항은 조용히 사라진다. 3세 재료에
    #            "7세" 가 붙으면 세 살 아이에게서 빠진다(backend/server/db.js 의 childAge).
    if tier is not None and (int(age.group()) != tier or f["age_min"] != tier):
        return None, (f"{tier}세 칸에서 벗어났다 — 재료 {f['age_min']}세+ · "
                      f"문항 {card.get('age')}")

    out = dict(card)
    out["t"] = f["t0"]
    out["frame"] = f.get("frame")               # 아이에게 보여줄 화면
    p = f["payload"]
    choices = card.get("choices") or []

    if ctype in CREATIVE:
        if card.get("answer_index") is not None or choices:
            return None, "창작형인데 정답이 있다"
        out["answer"], out["choices"] = None, None
    elif ctype == "색깔 퀴즈":
        pool = p.get("colors") or p.get("present") or []
        ci = card.get("color_index")
        if not isinstance(ci, int) or not 0 <= ci < len(pool):
            return None, f"color_index 범위 밖 — {ci} (후보 {len(pool)}개)"
        out["answer"] = pool[ci]
        # 오답 조건은 화면 부재가 아니라 **그 사물의 색이 아닐 것**이다. 문항이 묻는
        # 것이 화면이 아니라 사물의 색이기 때문이다 — 화면 구석에 초록 나무가 있어도
        # "이 버스는 무슨 색?" 의 오답으로 초록은 멀쩡하다. absent(확정 부재)를 앞에
        # 두는 건 관찰이 그 사물의 색 하나를 놓쳤을 때를 위한 안전판이다.
        # 부재 대역만 쓰던 때는 색이 다양한 프레임에서 통째로 폐기됐다(실측 11건).
        opts = _choices(out["answer"],
                        (p.get("absent") or [])
                        + [c for c in visual.COLOR_NAMES if c not in pool], fid)
        if opts is None:
            return None, "안전한 오답 색이 모자란다"
        out["choices"] = opts
    elif ctype == "개수 세기":
        if f["kind"] != "count":
            return None, f"개수 재료가 아니다 — {f['kind']}"
        # 관찰은 색으로 나눠 세었다. '빨간 차 3' 을 받아 놓고 "차가 몇 대"라고 물으면
        # 화면의 파란 차까지 답에 들어온다 — 재료가 센 그것을 그대로 물어야 정답이 맞다.
        miss = [w for w in str(p["name"]).split() if w not in (card.get("prompt") or "")]
        if miss:
            return None, f"세는 대상을 흘렸다 — 문항에 {', '.join(miss)} 가 없다 ({p['name']})"
        out["answer"] = str(p["n"])
        out["choices"] = _choices(out["answer"], _count_distractors(p["n"]), fid)
    elif ctype == "모두 세기":
        if f["kind"] != "sum":
            return None, f"모으기 재료가 아니다 — {f['kind']}"
        # 합칠 묶음을 다 부르지 않으면 아이가 무엇과 무엇을 합칠지 모른다. 개수 세기와
        # 같은 이유로 이름을 줄이거나 색을 빼면 답이 달라진다.
        miss = [w for x in p["parts"] for w in str(x["name"]).split()
                if w not in (card.get("prompt") or "")]
        if miss:
            return None, f"합칠 묶음을 흘렸다 — 문항에 {', '.join(dict.fromkeys(miss))} 가 없다"
        out["answer"] = str(p["total"])
        out["choices"] = _choices(out["answer"], _count_distractors(p["total"]), fid)
    elif ctype == "수 가르기":
        if f["kind"] != "diff":
            return None, f"가르기 재료가 아니다 — {f['kind']}"
        # 견줄 두 묶음을 다 불러야 아이가 무엇에서 무엇을 빼는지 안다.
        miss = [w for x in (p["more"], p["less"]) for w in str(x["name"]).split()
                if w not in (card.get("prompt") or "")]
        if miss:
            return None, f"견줄 묶음을 흘렸다 — 문항에 {', '.join(dict.fromkeys(miss))} 가 없다"
        out["answer"] = str(p["diff"])
        out["choices"] = _choices(out["answer"], _count_distractors(p["diff"]), fid)
    elif ctype == "크기 비교":
        if f["kind"] != "size":
            return None, f"크기 재료가 아니다 — {f['kind']}"
        # "더 큰 물건은?" 만으로는 아이가 화면의 무엇과 무엇을 견주라는지 모른다.
        miss = [w for w in (p["big"], p["small"])
                if w not in (card.get("prompt") or "")]
        if miss:
            return None, f"견줄 것을 말하지 않았다 — 문항에 {', '.join(miss)} 가 없다"
        out["answer"] = p["big"]
        out["choices"] = [p["big"], p["small"]]      # 둘 중 고르는 문제다
    elif ctype == "누가 나왔나":
        out["answer"] = p.get("name")
        if not out["answer"]:
            return None, "이름 재료가 아니다"
        # 오답도 재료에서 만든다. 모델은 보기를 쓰지 않으므로(skills/quiz3 규칙 3)
        # 모델의 choices 에서 가져오던 때는 이 유형이 100% 폐기됐다 — 지시를 어겨야만
        # 통과하는 유형이었다(실측 20건).
        #
        # 이 프레임에 있는 이름은 전부 뺀다. 화면 구석에 있는 것을 오답으로 내면
        # 그것을 고른 아이가 틀린다.
        here = {x["payload"].get("name") for x in by_id.values()
                if x.get("frame") == f.get("frame")}
        cand = sorted({x["payload"]["name"] for x in by_id.values()
                       if x["kind"] == "presence"} - here)
        if cand:                          # 문항마다 다른 오답이 나오게 재료 id 로 돌린다
            k = sum(ord(c) for c in fid) % len(cand)
            cand = cand[k:] + cand[:k]
        opts = _choices(out["answer"], cand, fid)
        if opts is None:
            return None, f"오답이 모자란다 — 다른 장면 이름 {len(cand)}개"
        out["choices"] = opts
    elif ctype == "모양 찾기":
        sh = p.get("shapes") or []
        if not sh:
            return None, "도형 재료가 아니다"
        # 한 프레임에 도형이 여럿이면 첫 번째가 정답이라는 보장이 없다. 문항이 "동그라미를
        # 찾아보세요" 라고 물었는데 정답에 세모를 박으면 맞은 아이가 틀린다 — 실제로 났다.
        asked = [x for x in sh if x in (card.get("prompt") or "")]
        if len(asked) != 1:
            return None, (f"문항이 가리키는 도형이 하나가 아니다 — 재료 {sh}, "
                          f"문항이 부른 것 {asked or '없음'}")
        out["answer"] = asked[0]
        out["choices"] = _choices(out["answer"],
                                  [x for x in SHAPES_ALL if x not in sh], fid)
    else:
        return None, f"마무리 포맷에 없는 유형 — {ctype}"

    if out["answer"] is not None and not out.get("choices"):
        return None, "보기를 만들지 못했다"
    if out["frame"] is None:
        return None, "화면이 없다 — 마무리 문항은 그림과 함께 낸다"
    return out, "통과"


def run(name: str, dry: bool = False) -> dict:
    """연령 한 칸씩 따로 뽑는다.

    한 번에 다 뽑게 두면 모델이 쉬운 재료부터 집어서 3세 문항만 쌓인다 — 실측으로
    41문항 중 5세가 2개였다. 재료를 age_min 으로 갈라 칸마다 따로 부르면, 그 칸에
    쓸 재료가 있는 만큼은 그 나이 문항이 나온다. 재료가 없는 칸은 건너뛴다 —
    아동 애니 화면에는 7세 어휘가 드물어서 위쪽 칸은 자주 비는 게 정상이다.

    칸을 나누는 기준이 `<=` 가 아니라 `==` 인 이유: age_min 은 이미 "어휘와 수 중 더
    어려운 쪽"이다(observe.py). 다섯 살에게 어려운 문항을 내려면 다섯 살 재료를 써야지,
    세 살 재료를 주고 어렵게 물으라고 하면 모델이 말만 어렵게 꾸민다.
    """
    facts, fx = load(name)
    if not facts:
        raise RuntimeError(f"{name}: 재료가 없다. observe.py 를 먼저 돌려라")
    by_id = {f["id"]: f for f in facts}
    tiers = {a: [f for f in facts if f.get("age_min") == a] for a in AGES}

    if dry:
        print(f"{name}  재료 {len(facts)}건")
        for a in AGES:
            pool = tiers[a]
            if not pool:
                print(f"  {a}세  재료 없음 — 이 나이 문항은 안 만든다")
                continue
            print(f"  {a}세  {len(pool):>3}건  종류 {dict(Counter(f['kind'] for f in pool))}")
        return {}

    kept, dropped, raw = [], [], []
    for a in AGES:
        pool = tiers[a]
        if not pool:
            print(f"  · {a}세 재료 없음 — 건너뜀", flush=True)
            continue
        picked = spread(pool, MAX_FACTS)
        print(f"  · {a}세 문항 생성 중 … (재료 {len(picked)}건)", flush=True)
        got = _claude(render(picked, a))
        cards = (got.get("activities") or [])[:MAX_ACTIVITY]
        raw += cards
        for c in cards:
            ok, why = gate(c, by_id, a)
            (kept.append(ok) if ok else dropped.append({**c, "drop": why}))
    return {"name": name, "activities": kept, "dropped": dropped, "raw": raw}


def report(r: dict) -> None:
    n, d, tot = len(r["activities"]), len(r["dropped"]), len(r["raw"])
    print(f"\n{'='*72}\n{r['name']}  마무리 활동  생성 {tot} · 채택 {n} · 폐기 {d}\n{'='*72}")
    for c in r["activities"]:
        print(f"\n[{storydot.mmss(c['t'])}] {c['type']} ({c.get('age')}) — {c.get('domain')}")
        print(f"  Q. {c['prompt']}")
        if c.get("choices"):
            for ch in c["choices"]:
                print(f"     {'✓' if ch == c.get('answer') else '·'} {ch}")
        print(f"  화면: {Path(c['frame']).name if c.get('frame') else '(없음)'}")
    for c in r["dropped"]:
        print(f"\n[폐기] {c.get('type')}  {c['drop'][:70]}")


def main(argv: list[str]) -> int:
    dry = "--dry" in argv
    names = [storydot.nfc(a) for a in argv if not a.startswith("-")]
    if not names:
        return print("사용법: python3 generate3.py <작품명> [--dry]") or 1
    for n in names:
        r = run(n, dry)
        if dry:
            continue
        report(r)
        (WORK / f"{n}_final.json").write_text(
            json.dumps({"activities": r["activities"], "dropped": r["dropped"]},
                       ensure_ascii=False, indent=1))
        print(f"\n→ {n}_final.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
