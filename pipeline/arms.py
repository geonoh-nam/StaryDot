"""사다리 실험 — arm 을 **코드로 조립**해서 조건 고정을 보장한다. (신규)

generate.py 와 generate2.py 를 나란히 비교하려 했더니 변수가 8개 동시에 달랐다
(재료 제시·정지점·인용 방식·색 정답·유형 제시·검증자·배치·개수 상한). 파일이 둘이면
"다른 조건이 같음" 을 사람이 지켜야 하는데 그건 못 지킨다.

여기서는 프롬프트를 코드가 조립한다. arm 사이에 **의도한 것만** 달라진다.

    arm  근거 제시              인용 방식      유형 목록        격리되는 기여
    ───────────────────────────────────────────────────────────────────────
    A    세그먼트 원문          자유 생성      20종 전부        기준선
    B    재료 목록(종류 표시)   자유 생성      20종 전부        재료 제시   (A→B)
    C    재료 목록              fact_id 선택   20종 전부        구조적 제약 (B→C)
    D    재료 목록              fact_id 선택   재료가 있는 것만  유형 정합   (C→D)

**전 arm 고정**: 같은 영상 · 같은 정본 · 검증자 없음 · 같은 근거 건수 · 같은 활동
개수 상한 · 같은 모델 · arm 당 1회 호출. 반복은 LLM 비결정성 때문에 필수다.

판정은 이 파일이 하지 않는다. judge.py 가 arm 밖에서 한다.

    python3 arms.py 타요1화 --reps 3
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import storydot

ROOT = Path(__file__).parent
WORK = ROOT / "work"
OUT = WORK / "ladder"
TIMEOUT = 600     # 300 은 짧았다 — D#2 가 타임아웃으로 0개를 냈다

N_EVIDENCE = 30     # 전 arm 동일. 근거 건수가 다르면 그것도 변수가 된다
N_ACTIVITY = 12     # 전 arm 동일 상한
# **결정적으로 검사 가능한 유형만** 쓴다.
#
# 20종을 다 열어 놨더니 arm 마다 검사받기 쉬운 유형을 다르게 골랐다 — arm A 가
# 추론형 44% + 창작형 17% 로 61% 를 검사 면제 구역에 두고 0% 를 기록했다(실측).
# 게다가 rep 당 검사 가능 카드가 6개뿐이라 회차별 rate 가 17~50% 로 튀었고,
# 표준편차(14~37%p)가 arm 간 차이보다 커져 아무것도 판정할 수 없었다.
#
# 창작형(정답 없음)·추론형(정답이 글자로 안 나옴)·화면형(개수를 셀 방법 없음)을
# 빼면 rep 당 12개 전부가 판정 대상이 되어 분모가 2배가 된다. 전 arm 동일 적용이라
# 공정하고, 측정하려는 대상(검증 가능한 주장에서의 환각)에 정확히 집중한다.
# 창작형 활동은 제품에는 필요하지만 환각률 측정에는 잡음이다.
TYPES_20 = ["이야기 이해", "낱말 알기", "문장 배열", "색깔 퀴즈"]
CREATIVE = {"이어질 말 상상", "내가 그 자리라면", "장면 감상",
            "그림으로 표현", "그림 감상문"}

# ── 공통 계약 — 모든 arm 이 글자 그대로 공유한다 ────────────────────────────
COMMON = """너는 만 3~7세 아동 교육 활동 설계자다. 주어진 근거만으로 활동을 만든다.

## 교육과정
2019 개정 누리과정 5개 영역(의사소통·자연탐구·사회관계·예술경험·신체운동건강)에
매핑한다. `domain` 과 `curriculum` 을 반드시 적는다. 6·7세는 누리과정 밖이므로
`domain` 만 같은 5개 영역을 쓰고 `curriculum` 은 "초등 1~2학년 — …" 으로 적는다.

## 연령 (3~5세 누리과정 · 6·7세 초등 1~2학년)
| | 3세 | 4세 | 5세 | 6세 | 7세 |
| 수 | 1~5 | 1~10, 많다/적다 | 10 이상, 순서 | 모으기·가르기 | 한 자리 덧셈·뺄셈 |
| 언어 | 낱말, 한 문장 | 두세 문장 잇기 | 사건 순서, 이유 말하기 | 글자 읽기, 낱말 뜻 | 요약·다시 말하기 |
| 사회 | 기본 감정 | 왜 그런 감정인지 | 상대 입장 추론 | 규칙과 약속 | 다른 관점 비교 |

## 절대 규칙
1. 주어진 근거에 없는 것은 쓰지 않는다. 네 배경지식은 근거가 아니다.
2. 창작형(이어질 말 상상·내가 그 자리라면·장면 감상·그림으로 표현·그림 감상문)은
   `choices` 와 정답을 넣지 않는다. 정답이 없는 것이 정상이다.
3. 그 외 유형은 보기 3개를 만든다. 오답은 명백히 틀려야 한다.
4. 질문은 유아에게 말하듯 쓴다.
5. 자신 없으면 만들지 마라. 빈 배열이 정상 동작이다.

## 출력
설명 없이 JSON만. 코드블록으로 감싸지 마라. JSON 뒤에 아무 말도 붙이지 마라.
"""

QUOTE_FREE = """
## 근거 표기
활동마다 `source_id` 와 `quote` 를 적는다. `quote` 는 해당 세그먼트 원문에
**글자 그대로** 있어야 한다. 정답은 `answer` 에 문자열로 적는다.

{"activities":[{"type":"...","domain":"...","curriculum":"...","age":"3세",
 "prompt":"...","source_id":"s117","quote":"다른 실이 필요한데",
 "choices":["실","우산","신발"],"answer":"실"}]}
"""

QUOTE_ID = """
## 근거 표기
활동마다 `fact_id` 를 적는다. **인용문을 쓰지 마라** — 시스템이 원문에서 가져온다.
정답은 `answer_index` 로 `choices` 안의 자리를 가리킨다.
색깔 퀴즈는 `color_index` 로 그 재료의 '정답가능' 색 목록에서 고른다.

{"activities":[{"type":"...","domain":"...","curriculum":"...","age":"3세",
 "prompt":"...","fact_id":"ut042","choices":["실","우산","신발"],"answer_index":0}]}
"""


# ── 근거 블록 ───────────────────────────────────────────────────────────────
def spread(xs, n):
    if len(xs) <= n:
        return xs
    step = len(xs) / n
    return [xs[int(i * step)] for i in range(n)]


def evidence_raw(canon: list[dict], n: int) -> str:
    """arm A — 세그먼트 원문만. 재료 분류가 없다."""
    segs = spread([s for s in canon if s["conf"] in ("high", "medium")], n)
    lines = [f"## 이 영상의 대사 {len(segs)}건"]
    for s in segs:
        lines.append(f"  {s['id']}  {storydot.mmss(s['t0'])}  \"{s['text']}\"")
    return "\n".join(lines)


def evidence_facts(facts: list[dict], canon: dict, n: int) -> str:
    """arm B·C·D — 재료 목록. 종류와 만들 수 있는 유형이 붙어 있다."""
    fs = spread(facts, n)
    lines = [f"## 활동 재료 {len(fs)}건"]
    for f in fs:
        p = f["payload"]
        if f["kind"] == "color":
            body = "정답가능 색: " + ", ".join(
                f"{i}={c}" for i, c in enumerate(p["present"]))
        elif f["kind"] == "keyword":
            body = f"낱말 \"{p['word']}\""
        else:
            seg = canon.get(f["evidence"][0], {})
            cue = f" 단서'{p['cue']}'" if p.get("cue") else ""
            body = f"{cue} \"{seg.get('text','')}\""
        # 세그먼트 id 를 병기한다. 안 하면 arm B 가 재료 id 를 source_id 로 쓰게 되고,
        # A→B 가 '재료 제시' 가 아니라 'id 공간 변경' 을 격리해 버린다 — 실측으로 겪었다.
        sid = f["evidence"][0] if f["kind"] != "color" else "(화면)"
        lines.append(f"  {f['id']}  근거{sid}  {storydot.mmss(f['t0'])}  [{f['kind']}]"
                     f"{body}   → 가능: {', '.join(f['afford'])}")
    return "\n".join(lines)


def build(arm: str, facts: list[dict], canon_list: list[dict],
          canon: dict) -> tuple[str, str]:
    """(system_prompt, user_prompt). arm 사이 차이는 여기서만 생긴다."""
    if arm == "A":
        ev, quote = evidence_raw(canon_list, N_EVIDENCE), QUOTE_FREE
        types = TYPES_20
    elif arm == "B":
        ev, quote = evidence_facts(facts, canon, N_EVIDENCE), QUOTE_FREE
        types = TYPES_20
    elif arm == "C":
        ev, quote = evidence_facts(facts, canon, N_EVIDENCE), QUOTE_ID
        types = TYPES_20
    elif arm == "D":
        ev, quote = evidence_facts(facts, canon, N_EVIDENCE), QUOTE_ID
        # 재료가 뒷받침하는 유형 ∩ 검사 가능한 유형. 교집합을 안 하면 D 만
        # 검사 불가 유형까지 열려서 다른 arm 과 과제가 달라진다.
        types = sorted({t for f in facts for t in f["afford"]} & set(TYPES_20))
    else:
        raise ValueError(f"모르는 arm: {arm}")

    sysmsg = COMMON + quote + "\n## 활동 유형\n" + " · ".join(types) + "\n"
    user = f"{ev}\n\n위 근거로 활동을 최대 {N_ACTIVITY}개 만들어라."
    return sysmsg, user


# ── 실행 ────────────────────────────────────────────────────────────────────
def _claude(sysmsg: str, prompt: str) -> dict:
    r = subprocess.run(
        ["claude", "-p", prompt, "--append-system-prompt", sysmsg,
         "--allowed-tools", "Read", "--output-format", "json"],
        capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT,
        stdin=subprocess.DEVNULL)   # 없으면 CLI 가 stdin 을 3초 기다리다 실패한다
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패(rc={r.returncode}): {r.stderr[-300:]}")
    env = {"result": storydot.claude_result(r.stdout)}
    text = env.get("result") or env.get("text") or ""
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


def run(name: str, arms: list[str], reps: int) -> None:
    fx = json.loads((WORK / f"{name}_facts.json").read_text())
    plan = json.loads((WORK / f"{name}_plan.json").read_text())
    canon_list = plan["canonical"]
    canon = {s["id"]: s for s in canon_list}
    OUT.mkdir(parents=True, exist_ok=True)

    for arm in arms:
        sysmsg, user = build(arm, fx["facts"], canon_list, canon)
        for rep in range(1, reps + 1):
            out = OUT / f"{name}_{arm}_{rep}.json"
            if out.exists():
                print(f"  [{arm}#{rep}] 이미 있음, 건너뜀")
                continue
            print(f"  [{arm}#{rep}] 생성 중 … (근거 {N_EVIDENCE}건 · 최대 {N_ACTIVITY}개)",
                  flush=True)
            try:
                got = _claude(sysmsg, user)
                cards = got.get("activities", [])
            except Exception as exc:
                print(f"     실패: {type(exc).__name__}: {exc}")
                cards = []
            out.write_text(json.dumps(
                {"arm": arm, "rep": rep, "name": name,
                 "n_evidence": N_EVIDENCE, "max_activity": N_ACTIVITY,
                 "raw": cards}, ensure_ascii=False, indent=1))
            print(f"     → {len(cards)}개  {out.name}")


def main(argv: list[str]) -> int:
    reps = 5
    if "--reps" in argv:
        reps = int(argv[argv.index("--reps") + 1])
    arms = ["A", "B", "C", "D"]
    if "--arms" in argv:
        arms = list(argv[argv.index("--arms") + 1])
    names = [storydot.nfc(a) for a in argv[:]
             if not a.startswith("-") and not a.isdigit() and a not in ("ABCD",)]
    names = [n for n in names if (WORK / f"{n}_facts.json").exists()]
    if not names:
        return print("사용법: python3 arms.py <작품명> [--arms ABCD] [--reps 3]") or 1
    for n in names:
        print(f"\n{n}  arms={''.join(arms)}  reps={reps}")
        run(n, arms, reps)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
