#!/usr/bin/env python3
"""사건 경로 카드를 앱 주입 형식으로 바꾼다.

    python3 tools/to-app.py work/ev/<작품>_ev_cards.json
      → work/ev/<작품>_ev_final.json
    그다음: node backend/server/tools/from-storydot.js <video_id> work/ev/<작품>_ev_final.json

generate_ev.py 는 개입지점별로 묶인 `{"slots": [...]}` 를 내는데,
from-storydot.js 는 평평한 `{"activities": [...]}` 를 먹고 각 항목에
`t` 와 `frame`(실제 파일 경로)을 요구한다. 그 사이를 잇는다.

프레임이 없는 카드(대사 기반)에는 **멈춤 화면**을 붙인다. 아이는 어차피
그 정지 화면 위에서 문제를 보므로 그게 실제로 보게 될 그림이다.
붙이지 않으면 from-storydot 이 통째로 버리는데, 하필 사건에 직결된
레벨 2 문항이 거기 몰려 있다.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 창작형 문항에서 아이가 대답할 시간. SayIt 의 기본값은 5초인데, 우리 창작형은
# "누구와 어디로 날아가고 싶나요?" 처럼 열린 질문이라 생각할 틈이 더 필요하다.
SAY_LISTEN_MS = 8000


def plan_for(cards_path: Path) -> dict:
    p = cards_path.with_name(cards_path.name.replace("_ev_cards.json", "_ev_plan.json"))
    if not p.exists():
        sys.exit(f"짝이 되는 계획 파일이 없다: {p}")
    return json.loads(p.read_text())


def convert(cards_path: Path) -> tuple[list[dict], list[tuple[str, str]]]:
    """(앱에 넣을 활동, [(유형, 제외 사유)])."""
    cards = json.loads(cards_path.read_text())
    plan = plan_for(cards_path)
    by_t = {round(it["t"], 2): it for it in plan["interrupts"]}

    out, skipped = [], []
    for slot in cards.get("slots", []):
        it = by_t.get(round(slot.get("t") or -1, 2))
        if it is None:
            skipped.append(("(슬롯)", f"{slot.get('t')}s 에 해당하는 개입지점이 계획에 없다"))
            continue
        frames = it.get("frames") or []
        if not frames:
            skipped.append(("(슬롯)", f"{it['t']}s 에 프레임이 없다"))
            continue
        by_id = {f["id"]: f for f in frames}
        pause = frames[-1]          # 마지막 프레임 = 아이가 실제로 보는 멈춤 화면

        for c in slot.get("activities", []):
            f = by_id.get(c.get("frame_id")) or pause
            row = {
                **{k: v for k, v in c.items() if k != "frame_id"},
                "t": it["t"],
                "frame": f["path"],
                "fact_id": f"{it['id']}-{len(out):02d}",
                # 사건 경로에서만 오는 값. 앱이 아직 안 읽지만 실어 보낸다.
                "event_kind": it.get("kind"),
                "asked_by": it.get("asked_by"),
                "event_what": it.get("what"),
            }
            if c.get("answer") is None or not isinstance(c.get("choices"), list):
                # 창작형은 정답이 없어 4지선다 화면에 못 넣는다. 대신 앱의 말하기
                # 활동(`say`)으로 보낸다 — 버디가 질문을 읽어 주고 아이가 대답하며
                # 채점하지 않는다. 누리과정이 정답보다 표현과 참여를 앞에 두는 자리다.
                # 이걸 버리면 레벨 3 문항 11건 중 9건이 아이에게 도달하지 못한다.
                row.update(type="say", activity_template=c.get("type"),
                           word=c.get("prompt"), listenMs=SAY_LISTEN_MS,
                           choices=None, answer=None)
            out.append(row)
    return out, skipped


def _selftest() -> None:
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        (d / "x_ev_plan.json").write_text(json.dumps({"interrupts": [{
            "id": "i00", "t": 100.0, "kind": "결과", "asked_by": "타요", "what": "무슨 일",
            "frames": [{"id": "f0001", "t": 80.0, "path": "/tmp/a.jpg"},
                       {"id": "f0002", "t": 100.0, "path": "/tmp/b.jpg"}]}]}))
        cp = d / "x_ev_cards.json"
        cp.write_text(json.dumps({"slots": [{"t": 100.0, "activities": [
            {"type": "개수 세기", "frame_id": "f0001", "choices": ["1", "2"], "answer": "1"},
            {"type": "마음 읽기", "frame_id": None, "choices": ["기뻐요", "슬퍼요"], "answer": "기뻐요"},
            {"type": "장면 감상", "frame_id": None, "choices": None, "answer": None},
        ]}]}, ensure_ascii=False))
        acts, skipped = convert(cp)

    assert len(acts) == 2, acts
    # 지목한 프레임은 그대로
    assert acts[0]["frame"] == "/tmp/a.jpg", acts[0]
    # 프레임 없는 대사 카드는 멈춤 화면(마지막)을 받는다 — 버려지면 안 된다
    assert acts[1]["frame"] == "/tmp/b.jpg", acts[1]
    # 창작형은 사유와 함께 제외
    assert len(skipped) == 1 and "창작형" in skipped[0][1], skipped
    # frame_id 는 떨어내고 t·fact_id·사건 정보를 싣는다
    assert "frame_id" not in acts[0] and acts[0]["t"] == 100.0
    assert acts[0]["event_kind"] == "결과" and acts[0]["asked_by"] == "타요"
    assert len({a["fact_id"] for a in acts}) == 2, "fact_id 가 겹친다"
    print("앱 변환 자체검사 통과")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        _selftest()
        sys.exit(0)
    for a in args:
        p = Path(a).expanduser()
        acts, skipped = convert(p)
        out = p.with_name(p.name.replace("_ev_cards.json", "_ev_final.json"))
        out.write_text(json.dumps({"activities": acts}, ensure_ascii=False, indent=1))
        print(f"\n{p.name}  →  {out.name}   활동 {len(acts)}")
        for a2 in acts:
            print(f"   [{a2['type']}] L{a2.get('level','?')}  {a2['prompt'][:52]}")
        for t, why in skipped:
            print(f"   ✗ [{t}] {why}")
