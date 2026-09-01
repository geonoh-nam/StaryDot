"""활동 생성 결과에 결정적 게이트를 적용한다.

두 에이전트가 합의해도 이 관문을 못 넘으면 카드는 폐기된다. 재시도가 아니라 폐기다.
LLM 검증은 품질을 올리고, 이 대조는 최악을 막는다. 역할이 다르다.

    카드 ──► ① quote 가 해당 세그먼트 원문에 그대로 있는가
             ② 그 세그먼트 신뢰도가 high/medium 인가
             ③ 스팬이 act 안에 있는가
             ④ 격리 스팬과 겹치지 않는가
                      │
              전부 통과 ─► 채택      하나라도 실패 ─► 폐기
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def gate(card: dict, canon_by_id: dict, act: dict, quarantine: list) -> tuple[bool, str]:
    seg = canon_by_id.get(card["source_id"])
    if seg is None:
        return False, f"세그먼트 {card['source_id']} 없음"
    if card["quote"] not in seg["text"]:
        return False, f"인용 불일치: {card['quote']!r} ∉ {seg['text']!r}"
    if seg["conf"] not in ("high", "medium"):
        return False, f"신뢰도 미달: {seg['conf']}"
    if not (act["t0"] <= seg["t0"] and seg["t1"] <= act["t1"] + 1.0):
        return False, f"act 범위 밖: {seg['t0']:.1f}-{seg['t1']:.1f}"
    for q in quarantine:
        if seg["t0"] < q["t1"] and q["t0"] < seg["t1"]:
            return False, "격리 스팬과 겹침"
    return True, "통과"


def _find_act(plan: dict, slot: dict) -> dict:
    """슬롯이 가리키는 act 를 찾는다.

    개입 시각 `t` 로 매칭하면 안 된다. 시각 정착 단계가 화면이 잠잠한 순간을 찾아
    `t` 를 최대 몇 초까지 옮기기 때문에, 카드 생성 시점의 `t` 와 최종 계획의 `t` 가
    어긋난다 (실측 455.88 vs 453.38, 2.5초 차로 StopIteration).
    `slot_id` 가 있으면 그것을, 없으면 act 경계(t1)를, 마지막으로 최근접을 쓴다.
    """
    ints = plan["interrupts"]
    if slot.get("slot_id"):
        for i in ints:
            if i.get("id") == slot["slot_id"]:
                return i["act"]
    for i in ints:
        if abs(i["act"]["t1"] - slot["t"]) < 0.5:
            return i["act"]
    return min(ints, key=lambda i: abs(i["t"] - slot["t"]))["act"]


def run(plan_path: Path, cards_path: Path):
    plan = json.loads(plan_path.read_text())
    cards = json.loads(cards_path.read_text())
    by_id = {s["id"]: s for s in plan["canonical"]}
    quarantine = [s for s in plan["canonical"] if s["conf"] == "quarantine"]

    passed, failed = [], []
    for slot in cards["slots"]:
        act = _find_act(plan, slot)
        for c in slot["activities"]:
            ok, why = gate(c, by_id, act, quarantine)
            (passed if ok else failed).append((slot["t"], c, why))
    return passed, failed


def selftest():
    """게이트가 무동작이 아님을 증명한다. 인용을 한 글자 바꾸면 반드시 걸려야 한다."""
    canon = {"s001": {"id": "s001", "t0": 10.0, "t1": 12.0,
                      "text": "다른 실이 필요한데", "conf": "medium"}}
    act = {"t0": 0.0, "t1": 100.0}
    ok, _ = gate({"source_id": "s001", "quote": "실이 필요"}, canon, act, [])
    assert ok, "정상 인용이 막히면 안 된다"
    ok, why = gate({"source_id": "s001", "quote": "바늘이 필요"}, canon, act, [])
    assert not ok and "인용 불일치" in why, "위조된 인용을 통과시켰다"
    ok, why = gate({"source_id": "s001", "quote": "실이 필요"},
                   {"s001": {**canon["s001"], "conf": "low"}}, act, [])
    assert not ok and "신뢰도" in why, "저신뢰 스팬을 통과시켰다"
    ok, why = gate({"source_id": "s999", "quote": "x"}, canon, act, [])
    assert not ok, "없는 세그먼트를 통과시켰다"
    print("게이트 자체검사 4/4 통과")


if __name__ == "__main__":
    selftest()
    if len(sys.argv) > 2:
        p, f = run(Path(sys.argv[1]), Path(sys.argv[2]))
        print(f"\n채택 {len(p)}  폐기 {len(f)}\n" + "=" * 70)
        for t, c, _ in p:
            print(f"\n[{int(t//60)}:{t%60:05.2f}] {c['type']}  ({c['age']})")
            print(f"  Q. {c['prompt']}")
            if c.get("choices"):
                for ch in c["choices"]:
                    print(f"     {'✓' if ch == c.get('answer') else '·'} {ch}")
            elif c.get("answer"):
                print(f"     ✓ {c['answer']}")
            print(f"  근거 {c['source_id']}: \"{c['quote']}\"")
        for t, c, why in f:
            print(f"\n[폐기] {c['type']}: {why}")
