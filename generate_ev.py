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
