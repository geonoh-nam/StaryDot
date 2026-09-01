#!/usr/bin/env python3
"""영상에서 국어(의사소통) 문항을 만든다.

    python3 korean.py 타요마법버스3화        한 편
    python3 korean.py --all                 work/ 의 관찰된 편 전부

generate3.py 가 색·수·모양을 맡는 동안 이쪽은 말을 맡는다. 모델을 부르지 않는다 —
재료(관찰된 사물 이름, 꾸민 이름, 대사)에서 규칙으로 뽑는다. 답과 오답을 코드가 채우는
원칙은 generate3 와 같다. 오답은 **같은 영상의 다른 재료**에서 가져온다. 바깥에서 끌어오면
아이가 화면에서 본 적 없는 낱말로 헷갈리게 된다.

산출: work/<작품>_korean.json — generate3 의 _final.json 과 같은 항목 형식이라
시딩 쪽에서 둘을 구분하지 않아도 된다.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WORK = Path(__file__).resolve().parent / "work"

# 이름을 그대로 물으면 세 살도 답한다. 꾸민 이름을 붙여 묻는 순간 낱말 두 개를 함께
# 다뤄야 하므로 한 살 위로 본다.
AGE_NAME = 3
AGE_LABEL = 4
AGE_FIRST = 5
AGE_MIMETIC = 3

# 보기는 셋. 네 살이 한눈에 훑을 수 있는 한계다.
CHOICES = 3

# 소리를 흉내 낸 말. 첩어(빵빵·부릉부릉·반짝반짝)만 잡는다 — 이 형태 밖으로 나가면
# 규칙이 일반 낱말까지 긁어 온다.
MIMETIC = re.compile(r"\b(\w{1,3})\1\b")

# 첩어 모양이지만 흉내 말이 아닌 것들.
MIMETIC_STOP = {"자자", "그래그래", "빨리빨리", "하나하나", "저기저기"}


def load(name: str) -> tuple[list[dict], list[dict]]:
    """화면 재료와 대사를 읽는다. 관찰 전이면 빈 목록."""
    def facts_of(path: Path) -> list[dict]:
        if not path.exists():
            return []
        blob = json.loads(path.read_text(encoding="utf-8"))
        return blob.get("facts", blob if isinstance(blob, list) else [])

    return facts_of(WORK / f"{name}_screen.json"), facts_of(WORK / f"{name}_facts.json")


def others(pool: list[str], answer: str, n: int = CHOICES - 1) -> list[str]:
    """같은 영상에서 온 오답. 정답과 겹치는 것은 뺀다."""
    out: list[str] = []
    for x in pool:
        if x == answer or x in out:
            continue
        out.append(x)
        if len(out) == n:
            break
    return out


def card(kind: str, age: int, prompt: str, answer: str, wrong: list[str], fact: dict,
         curriculum: str) -> dict | None:
    """문항 한 장. 오답이 모자라면 만들지 않는다 — 보기 둘짜리는 찍으면 맞는다."""
    if len(wrong) < CHOICES - 1:
        return None
    return {
        "type": kind,
        "domain": "의사소통",
        "curriculum": curriculum,
        "age": f"{age}세",
        "prompt": prompt,
        "fact_id": fact["id"],
        "t": fact["t0"],
        "frame": fact.get("frame"),
        "answer": answer,
        "choices": [answer, *wrong],
    }


def build(name: str) -> list[dict]:
    screen, facts = load(name)
    if not screen:
        return []

    # 화면에 나온 사물 이름과 꾸민 이름. 순서를 지켜야 오답이 매번 같은 자리에서 온다.
    names = [f["payload"]["name"] for f in screen
             if f["kind"] == "objcolor" and f["payload"].get("name")]

    cards: list[dict] = []

    # 사물 이름 대기 — 화면의 것을 가리키며 이름을 묻는다.
    for f in screen:
        if f["kind"] != "objcolor":
            continue
        n = f["payload"].get("name")
        if not n:
            continue
        c = card("사물 이름 대기", max(AGE_NAME, int(f["age_min"])),
                 "이 그림에 있는 것은 무엇인가요?", n, others(names, n), f,
                 "듣기와 말하기 — 상황에 적절한 단어를 사용하여 말한다")
        if c:
            cards.append(c)

    # 꾸미는 말 붙이기 — "파란 ___" 의 빈칸을 채운다. 색은 화면이 이미 증명했다.
    for f in screen:
        if f["kind"] != "presence":
            continue
        full = f["payload"].get("name", "")
        if " " not in full:
            continue
        adj, noun = full.split(" ", 1)
        c = card("꾸미는 말 붙이기", max(AGE_LABEL, int(f["age_min"])),
                 f"{adj} 무엇일까요?", noun, others(names, noun), f,
                 "읽기와 쓰기에 관심 가지기 — 말과 글의 관계에 관심을 가진다")
        if c:
            cards.append(c)

    # 첫소리 찾기 — 이름의 첫 글자를 고른다. 다른 이름의 첫 글자가 오답이 된다.
    for f in screen:
        if f["kind"] != "objcolor":
            continue
        n = f["payload"].get("name") or ""
        if len(n) < 2:
            continue
        head = n[0]
        pool = [m[0] for m in names if m and m[0] != head]
        c = card("첫소리 찾기", max(AGE_FIRST, int(f["age_min"])),
                 f"'{n}'은 어떤 글자로 시작할까요?", head, others(pool, head), f,
                 "읽기와 쓰기에 관심 가지기 — 주변의 상징, 글자 등의 읽기에 관심을 가진다")
        if c:
            cards.append(c)

    # 흉내 내는 말 — 대사에 실제로 나온 첩어만. 없으면 이 유형은 통째로 건너뛴다.
    heard: list[str] = []
    for f in facts:
        if f["kind"] != "utterance":
            continue
        for m in MIMETIC.finditer(f["payload"].get("text", "")):
            word = m.group(0)
            if word not in MIMETIC_STOP and word not in heard:
                heard.append(word)
    if len(heard) >= CHOICES and screen:
        c = card("흉내 내는 말", AGE_MIMETIC,
                 "영상에서 들은 말은 무엇인가요?", heard[0], heard[1:CHOICES], screen[0],
                 "책과 이야기 즐기기 — 동화, 동시에서 말의 재미를 느낀다")
        if c:
            cards.append(c)

    return cards


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    names = (sorted(p.stem[: -len("_screen")] for p in WORK.glob("*_screen.json"))
             if argv[0] == "--all" else argv)

    total = 0
    for name in names:
        cards = build(name)
        if not cards:
            print(f"{name:22s} 재료 없음 — 관찰부터 돌려라")
            continue
        (WORK / f"{name}_korean.json").write_text(
            json.dumps({"activities": cards}, ensure_ascii=False, indent=1), encoding="utf-8")
        kinds: dict[str, int] = {}
        for c in cards:
            kinds[c["type"]] = kinds.get(c["type"], 0) + 1
        total += len(cards)
        print(f"{name:22s} {len(cards):3d}문항  " + " · ".join(f"{k} {v}" for k, v in kinds.items()))
    print(f"\n합계 {total}문항")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
