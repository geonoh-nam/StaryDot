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


# kind 마다 되물을 수 있는 것이 다르다. "사건을 물어라" 만으로는 생성자가
# "뭐라고 했나요?" 한 문항으로 때우고 나머지를 화면 세기로 채운다(실측).
# 어떤 형태로 물을지까지 지정해야 레벨 3(추론)이 나온다.
ASK_BY_KIND = {
    "결과": "왜 그렇게 됐을까? / 그전에 무슨 일이 있었을까?",
    "갈등": "왜 다퉜을까? / 내가 그 자리라면 어떻게 했을까?",
    "감정": "어떤 마음이었을까? / 왜 그런 마음이 들었을까?",
    "시도": "왜 그렇게 하려고 했을까? / 어떻게 될 것 같아?",
    "발견": "그걸 알고 나서 어떻게 했을까? / 다음엔 무슨 일이 생길까?",
}


def event_prefix(it: dict) -> str:
    """개입지점에 붙은 사건을 프롬프트 머리말로 만든다. 사건이 없으면 빈 문자열."""
    if not it.get("what"):
        return ""
    who = it.get("asked_by") or "누군가"
    kind = it.get("kind", "")
    ask = ASK_BY_KIND.get(kind, "왜 그랬을까?")
    return (f"## 이 지점에서 방금 일어난 일\n"
            f"  {it['what']}\n"
            f"  주체: {who}  ·  종류: {kind}\n\n"
            f"**이 일을 되묻는 활동을 반드시 하나 이상 만들어라.** 이 지점이 선택된 이유다.\n"
            f"이 종류의 사건은 이렇게 묻는다: {ask}\n"
            f"그런 문항은 `원인과 결과` · `마음 읽기` · `내가 그 자리라면` ·\n"
            f"`이어질 말 상상` 중 하나가 된다 (레벨 2~3).\n"
            f"화면에서 세거나 색을 묻는 문항(레벨 1)은 **최대 하나**만 넣어라.\n"
            + (f"**{who} 가 직접 묻는다.** 해설자 말투로 쓰지 마라 —\n"
               f"  ✗ \"{who}는 어떤 마음이었을까요?\"\n"
               f"  ✓ \"나 그때 어떤 마음이었을까?\"\n"
               f"화면을 묻는 문항(개수·색·모양)만 예외로 3인칭을 쓴다.\n"
               if it.get("asked_by") else "")
            + "\n")


_orig_bundle = generate.bundle
_orig_claude = generate._claude


def bundle_ev(it: dict) -> str:
    return event_prefix(it) + _orig_bundle(it)


def claude_ev(skill: str, prompt: str, extra_dirs=()):
    return _orig_claude("quiz_ev" if skill == "quiz" else skill, prompt, extra_dirs)


def _assert_patch_still_effective() -> None:
    """아래 몽키패치는 generate.run_slot 이 bundle·_claude 를 전역 이름으로 찾아
    "quiz" 스킬을 호출한다는 전제로만 동작한다. run_slot 이 인라인되거나 이름이
    바뀌거나 "quiz" 문자열이 달라지면 패치가 조용히 무동작이 되어, 사건 머리말도
    quiz_ev 스킬도 없이 그럴듯한 카드가 에러 하나 없이 나온다. 실행 전에 미리 걸러낸다."""
    names = generate.run_slot.__code__.co_names
    consts = generate.run_slot.__code__.co_consts
    missing = [n for n in ("bundle", "_claude") if n not in names]
    if "quiz" not in consts:
        missing.append('"quiz" 상수')
    if missing:
        sys.exit(
            "generate_ev.py 전제 깨짐 — generate.run_slot 이 더 이상 "
            + " · ".join(missing) + " 를 참조하지 않는다. "
            "generate.bundle / generate._claude 몽키패치가 무동작이 되어 "
            "사건 머리말·quiz_ev 스킬 없이 카드가 조용히 생성될 수 있다. "
            "generate.py 의 현재 구현에 맞춰 generate_ev.py 를 고쳐라."
        )


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        sys.exit("사용법: python3 generate_ev.py work/ev/<작품>_ev_plan.json")
    _assert_patch_still_effective()
    generate.bundle = bundle_ev
    generate._claude = claude_ev
    generate.main(Path(args[0]).expanduser())
