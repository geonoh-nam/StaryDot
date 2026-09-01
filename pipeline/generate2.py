"""재료 인덱스에서 활동을 만든다 — 지어낼 수 없는 스키마. (신규 · 기존 파일 무수정)

generate.py 는 한 번의 호출에서 **재료 탐색과 문항 작성을 동시에** 시킨다. 재료가
얇은데 "활동 4개를 만들어라" 고 하면 지어내기는 요구가 만든 압력이다. 실제로 폐기된
두 건(인용 위조 · 정답 조작)이 정확히 그 형태였다.

여기서는 둘을 나눈다. 재료는 facts.py 가 이미 뽑아 놨고, 이 단계는 **고르기만** 한다.

    재료 인덱스 ──► 유형별 배치 ──► claude -p (skills/quiz2)
                                          │  fact_id 만 고름
                                          ▼
                            시스템이 인용을 원문에서 가져온다  ← 위조 불가능
                                          ▼
                                   결정적 게이트
                                          ▼
                                 <작품>_cards_v2.json
                                 <작품>_raw_v2.json   ← 환각률 분모

**모델은 인용문을 쓰지 않는다.** `fact_id` 만 고르고 인용은 시스템이 그 재료의 원문
세그먼트에서 그대로 가져온다. span(문자 범위)을 시키는 방법도 있지만 모델이 문자를
정확히 세지 못해 오류가 잦다. id 선택은 세는 일이 없어 그 오류가 원천적으로 없다.

색도 같다. 정답 색은 `color_index` 로 **팔레트가 계산한 '정답가능' 목록에서만** 고른다.
화면에 없는 색을 정답이라 하는 것이 표현 불가능해진다.

기존 generate.py 를 건드리지 않으므로 같은 작품에 대해 두 방식의 환각률을 직접 비교할
수 있다. 결과가 나쁘면 이 파일과 skills/quiz2 만 지우면 된다.

    python3 generate2.py 타요1화          한 편 생성
    python3 generate2.py --dry 타요1화     LLM 호출 없이 배치 구성만 확인
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import activities
import grounding
import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
SKILL = ROOT / "skills" / "quiz2" / "SKILL.md"
TIMEOUT = 300

# 한 배치에 넣을 재료 수. 많이 넣으면 모델이 훑고 지나가고, 적으면 호출이 늘어난다.
BATCH = 10
# 유형별로 만들 활동 상한. 재료가 많아도 같은 유형만 쏟아지면 안 된다.
PER_TYPE = 3

# 정답이 없는 것이 정상인 유형
CREATIVE = {"이어질 말 상상", "내가 그 자리라면", "장면 감상"}
# 정답이 재료에 이미 확정돼 있는 유형 — 시스템이 채운다
FIXED_ANSWER = {"낱말 알기", "색깔 퀴즈"}
# 정답이 증거에서 **따라 나오지만 글자로는 안 나오는** 유형.
#
# 여기에 문자열 grounding 을 걸면 안 된다. generate.py 가 이미 실측으로 배운
# 교훈인데 그대로 재현했다 — "미안한 마음"·"고마운 마음"·"신나고 좋은 마음" 이
# 전사본에 그 글자가 없다는 이유로 마음 읽기 3건이 전멸했다.
# 이 유형들의 관문은 **재료 종류가 그 유형을 뒷받침하는가**(emotion 재료여야
# 마음 읽기가 됨)와 근거 스팬 실재다. 그건 gate 앞부분이 이미 검사한다.
INFERENTIAL = {"마음 읽기", "원인과 결과", "도움 주고받기"}


# ── claude 호출 ─────────────────────────────────────────────────────────────
def _claude(prompt: str, extra_dirs=()) -> dict:
    cmd = ["claude", "-p", prompt, "--append-system-prompt", SKILL.read_text(),
           "--allowed-tools", "Read", "--output-format", "json"]
    for d in extra_dirs:
        cmd += ["--add-dir", str(d)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패: {r.stderr[-300:]}")
    env = {"result": storydot.claude_result(r.stdout)}
    return _first_json(env.get("result") or env.get("text") or "")


def _first_json(text: str) -> dict:
    """첫 번째 완결 JSON 객체. generate._first_json_object 와 같은 이유로 깊이를 센다."""
    start = text.find("{")
    if start < 0:
        raise ValueError(f"JSON 을 못 찾았다: {text[:200]}")
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
    raise ValueError(f"JSON 이 안 닫혔다: {text[:200]}")


# ── 배치 구성 ───────────────────────────────────────────────────────────────
def spread(items: list, n: int) -> list:
    """시간축에 고르게 n 개를 고른다. 앞에서 n 개를 자르면 도입부만 문제가 된다."""
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def batches(facts: list[dict]) -> list[tuple[str, list[dict]]]:
    """(활동유형, 그 유형을 뒷받침하는 재료들) 목록. 재료가 없는 유형은 아예 안 나온다."""
    by_type: dict[str, list] = {}
    for f in facts:
        for t in f["afford"]:
            by_type.setdefault(t, []).append(f)
    return [(t, spread(fs, BATCH)) for t, fs in sorted(by_type.items())]


def render(kind_type: str, facts: list[dict], canon: dict,
           frames: dict) -> str:
    """재료를 사람이 읽는 목록으로. 모델은 여기 있는 id 만 고를 수 있다."""
    lines = [f"# 만들 유형: {kind_type}", "",
             f"## 쓸 수 있는 재료 {len(facts)}건 — 이 목록에 없는 것은 존재하지 않는다", ""]
    for f in facts:
        t = storydot.mmss(f["t0"])
        p = f["payload"]
        if f["kind"] == "color":
            lines.append(f"  {f['id']}  {t}  [화면]  정답가능 색: "
                         + ", ".join(f"{i}={c}" for i, c in enumerate(p["present"])))
            if f["id"] in frames:
                lines.append(f"        프레임: {frames[f['id']]}  ← Read 로 열어 봐라")
        elif f["kind"] == "keyword":
            seg = canon.get(f["evidence"][0], {})
            lines.append(f"  {f['id']}  {t}  [낱말]  \"{p['word']}\" "
                         f"(대사: {seg.get('text','')[:40]})")
        else:
            seg = canon.get(f["evidence"][0], {})
            cue = f"  단서 '{p['cue']}'" if p.get("cue") else ""
            lines.append(f"  {f['id']}  {t}  [{f['kind']}]{cue}  "
                         f"\"{seg.get('text','')}\"")
    lines += ["", f"위 재료로 '{kind_type}' 활동을 만들어라. fact_id 는 위 목록에서만 고른다.",
              f"최대 {PER_TYPE}개. 만들 게 없으면 빈 배열."]
    return "\n".join(lines)


# ── 결정적 게이트 ───────────────────────────────────────────────────────────
def gate(card: dict, want_type: str, by_id: dict, canon: dict) -> tuple[dict | None, str]:
    """통과하면 인용이 채워진 카드, 아니면 (None, 사유). 재시도가 아니라 폐기다."""
    fid = card.get("fact_id")
    f = by_id.get(fid)
    if f is None:
        return None, f"재료 없음 — {fid!r}"          # 재료를 지어냈다
    ctype = card.get("type", want_type)
    if ctype not in f["afford"]:
        return None, f"재료가 '{ctype}' 를 뒷받침하지 않음 (가능: {f['afford']})"

    out = dict(card)
    out["t"] = f["t0"]
    out["fact_kind"] = f["kind"]
    choices = card.get("choices") or []

    if ctype in CREATIVE:
        if card.get("answer_index") is not None or choices:
            return None, "창작형인데 정답이 있다"
        out["answer"] = None
    elif ctype == "색깔 퀴즈":
        present = f["payload"]["present"]
        ci = card.get("color_index")
        if not isinstance(ci, int) or not 0 <= ci < len(present):
            return None, f"color_index 범위 밖 — {ci} (정답가능 {len(present)}개)"
        out["answer"] = present[ci]                  # 화면에 없는 색은 표현 불가능
        if out["answer"] not in choices:
            return None, f"정답 색 '{out['answer']}' 가 보기에 없다"
    elif ctype == "낱말 알기":
        out["answer"] = f["payload"]["word"]         # 정답은 재료가 확정한다
        if out["answer"] not in choices:
            return None, f"정답 낱말 '{out['answer']}' 가 보기에 없다"
    else:
        ai = card.get("answer_index")
        if not isinstance(ai, int) or not 0 <= ai < len(choices):
            return None, f"answer_index 범위 밖 — {ai} (보기 {len(choices)}개)"
        out["answer"] = choices[ai]

    # 인용은 **모델이 쓰지 않는다.** 재료의 원문 세그먼트를 시스템이 가져온다.
    if f["kind"] != "color":
        seg = canon.get(f["evidence"][0])
        if seg is None:
            return None, f"근거 세그먼트 없음 — {f['evidence']}"
        if seg["conf"] not in ("high", "medium"):
            return None, f"신뢰도 미달 — {seg['conf']}"
        out["source_id"] = seg["id"]
        out["quote"] = seg["text"]                   # 위조가 불가능한 경로
        # 정답이 증거에서 나오는가 (창작형·확정형은 이미 보장됨)
        if ctype not in CREATIVE and ctype not in FIXED_ANSWER \
                and ctype not in INFERENTIAL:
            v, why = grounding.check_answer({"type": ctype, "answer": out["answer"]},
                                            [seg["text"]])
            if v == "ungrounded":
                return None, f"정답 근거 없음 — {why}"
    else:
        out["source_id"] = None
        out["quote"] = None
        out["frame_ref"] = f["evidence"][0]
    return out, "통과"


# ── 실행 ────────────────────────────────────────────────────────────────────
def run(name: str, dry: bool = False) -> dict:
    fpath = WORK / f"{name}_facts.json"
    ppath = WORK / f"{name}_plan.json"
    if not fpath.exists():
        raise FileNotFoundError(f"{fpath.name} 이 없다. 먼저 python3 facts.py --write")
    fx = json.loads(fpath.read_text())
    facts = fx["facts"]
    canon = {s["id"]: s for s in json.loads(ppath.read_text())["canonical"]}
    by_id = {f["id"]: f for f in facts}
    video = Path(fx["video"]) if fx.get("video") else None

    # 색 재료는 프레임을 뽑아 줘야 모델이 화면을 볼 수 있다.
    frames: dict[str, str] = {}
    color_facts = spread([f for f in facts if f["kind"] == "color"], BATCH)
    if video and video.exists() and not dry:
        for f in color_facts:
            try:
                fr = visual.extract_evidence_frames(video, f["t0"], span=0.0, n=1,
                                                    out_dir=WORK / "shots")
                frames[f["id"]] = fr[0]["path"]
            except Exception:
                pass

    kept, dropped, raw = [], [], []
    for ctype, fs in batches(facts):
        prompt = render(ctype, fs, canon, frames)
        if dry:
            print(f"  [{ctype}] 재료 {len(fs)}건 · 프롬프트 {len(prompt)}자")
            continue
        print(f"  · {ctype} ({len(fs)}건) 생성 중 …", flush=True)
        try:
            got = _claude(prompt, extra_dirs=[WORK])
        except Exception as exc:
            print(f"    실패: {type(exc).__name__}: {exc}")
            continue
        cards = (got.get("activities") or [])[:PER_TYPE]
        raw += [{**c, "_want_type": ctype} for c in cards]
        for c in cards:
            ok, why = gate(c, ctype, by_id, canon)
            (kept.append(ok) if ok else dropped.append({**c, "drop": why}))

    return {"name": name, "activities": kept, "dropped": dropped, "raw": raw}


def report(r: dict) -> None:
    n, d = len(r["activities"]), len(r["dropped"])
    tot = len(r["raw"])
    rate = 100 * d / tot if tot else 0.0
    print(f"\n{'='*76}\n{r['name']}   생성 {tot}  채택 {n}  폐기 {d}  "
          f"(생성 단계 환각률 {rate:.1f}%)\n{'='*76}")
    for c in sorted(r["activities"], key=lambda x: x["t"]):
        print(f"\n[{storydot.mmss(c['t'])}] {c['type']} ({c.get('age')})  ← {c['fact_id']}")
        print(f"  Q. {c['prompt']}")
        if c.get("choices"):
            for ch in c["choices"]:
                print(f"     {'✓' if ch == c.get('answer') else '·'} {ch}")
        print(f"  근거 {c.get('source_id') or c.get('frame_ref')}: "
              f"{(c.get('quote') or '(화면)')[:60]}")
    for c in r["dropped"]:
        print(f"\n[폐기] {c.get('type')}  {c['drop'][:88]}")
    dom = Counter(c.get("domain") for c in r["activities"])
    if dom:
        print(f"\n영역 분포: " + " · ".join(f"{k} {v}" for k, v in dom.items()))


def main(argv: list[str]) -> int:
    dry = "--dry" in argv
    want = [a for a in argv if not a.startswith("-")]
    if not want:
        return print("사용법: python3 generate2.py [--dry] <작품명> …") or 1
    for name in want:
        name = storydot.nfc(name)
        r = run(name, dry)
        if dry:
            continue
        report(r)
        (WORK / f"{name}_cards_v2.json").write_text(
            json.dumps({"activities": r["activities"], "dropped": r["dropped"]},
                       ensure_ascii=False, indent=1))
        (WORK / f"{name}_raw_v2.json").write_text(
            json.dumps({"raw": r["raw"]}, ensure_ascii=False, indent=1))
        print(f"\n→ {name}_cards_v2.json · {name}_raw_v2.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
