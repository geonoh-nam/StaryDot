#!/usr/bin/env python3
"""활동 카드의 인터랙션 레벨 분포.

    python3 tools/level-report.py                     # 옛 경로 + 새 경로 나란히
    python3 tools/level-report.py work/타요1화_cards.json

심사 피드백(참석자 1, 08:59): "그건 엄청 단순한 레벨이고, 레벨 2·3 갈수록
결국 컨텍스트를 얼마나 이해하고 답변하는 건가." 그 지적에 답하려면 만든 활동이
실제로 어느 레벨인지 셀 수 있어야 하는데, `level` 필드를 아무도 안 읽고 있었다.

새 경로 카드는 `level` 을 직접 갖는다. 옛 경로 카드는 없으므로 활동 유형에서
역산한다 — 같은 표(skills/quiz_ev/SKILL.md)를 쓰므로 두 경로를 비교할 수 있다.
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"

# skills/quiz_ev/SKILL.md 의 레벨 표와 같아야 한다. 여기만 고치면 어긋난다.
LEVEL_OF = {
    # 1 시각 — 화면에 보이는 것을 묻는다
    "개수 세기": 1, "색깔 퀴즈": 1, "모양 찾기": 1, "같은 것 찾기": 1,
    "크기 비교": 1, "순서 세기": 1, "분류하기": 1, "연관성 카드 퀴즈": 1,
    # 2 컨텍스트 — 방금 본 이야기를 이해했는지 묻는다
    "이야기 이해": 2, "낱말 알기": 2, "문장 배열": 2, "마음 읽기": 2,
    "도움 주고받기": 2, "장면 감상": 2,
    # 3 추론 — 왜 그렇게 됐는지, 내가 그 자리라면
    "원인과 결과": 3, "이어질 말 상상": 3, "내가 그 자리라면": 3,
    "안전 알기": 3, "그림으로 표현": 3, "그림 감상문": 3,
}


def level_of(card: dict) -> int | None:
    """카드의 레벨. 필드가 있으면 그것을, 없으면 유형에서 역산한다.

    표에 없는 유형은 None 을 돌려준다 — 조용히 1로 떨어뜨리면 새 유형이
    생겼을 때 레벨 분포가 실제보다 낮아 보인다.
    """
    lv = card.get("level")
    if isinstance(lv, int) and 1 <= lv <= 3:
        return lv
    return LEVEL_OF.get(card.get("type"))


def cards_of(path: Path) -> list[dict]:
    d = json.loads(path.read_text())
    return [c for s in d.get("slots", []) for c in s.get("activities", [])]


def tally(paths: list[Path]) -> tuple[Counter, Counter, int]:
    """(레벨 분포, 미매핑 유형, 카드 총수)."""
    levels, unmapped, total = Counter(), Counter(), 0
    for p in paths:
        for c in cards_of(p):
            total += 1
            lv = level_of(c)
            if lv is None:
                unmapped[c.get("type", "(유형 없음)")] += 1
            else:
                levels[lv] += 1
    return levels, unmapped, total


def show(label: str, paths: list[Path]) -> None:
    if not paths:
        print(f"\n{label}: 카드 파일 없음")
        return
    levels, unmapped, total = tally(paths)
    print(f"\n{label}  파일 {len(paths)}  카드 {total}")
    if not total:
        return
    hi = levels[2] + levels[3]
    for lv, name in ((1, "시각"), (2, "컨텍스트"), (3, "추론")):
        n = levels[lv]
        bar = "█" * round(n / total * 40)
        print(f"  레벨 {lv} {name:<5} {n:>3}  {n/total*100:>5.1f}%  {bar}")
    print(f"  레벨 2 이상          {hi:>3}  {hi/total*100:>5.1f}%")
    for t, n in unmapped.most_common():
        print(f"  ⚠ 표에 없는 유형: {t} ({n}건)")


def _selftest() -> None:
    # level 필드가 있으면 그것을 쓴다
    assert level_of({"type": "개수 세기", "level": 3}) == 3
    # 없으면 유형에서 역산한다
    assert level_of({"type": "개수 세기"}) == 1
    assert level_of({"type": "원인과 결과"}) == 3
    # 표에 없는 유형은 조용히 1이 되면 안 된다
    assert level_of({"type": "새로 생긴 유형"}) is None
    assert level_of({}) is None
    # 범위 밖 level 은 무시하고 유형으로 되돌아간다
    assert level_of({"type": "마음 읽기", "level": 9}) == 2
    assert level_of({"type": "마음 읽기", "level": "2"}) == 2

    # 미매핑은 레벨 분포를 오염시키지 않고 따로 센다
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "x_cards.json"
        p.write_text(json.dumps({"slots": [{"activities": [
            {"type": "개수 세기"}, {"type": "원인과 결과"}, {"type": "미지의 유형"},
        ]}]}, ensure_ascii=False))
        levels, unmapped, total = tally([p])
        assert total == 3 and sum(levels.values()) == 2, (levels, total)
        assert unmapped["미지의 유형"] == 1, unmapped
    print("레벨 리포트 자체검사 통과")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        show("지정 파일", [Path(a).expanduser() for a in args])
        sys.exit(0)
    if "--selftest" in sys.argv:
        _selftest()
        sys.exit(0)
    _selftest()
    show("옛 경로 (generate.py)", sorted(WORK.glob("*_cards.json")))
    show("새 경로 (generate_ev.py)", sorted((WORK / "ev").glob("*_cards.json")))
