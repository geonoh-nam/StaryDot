"""활동 자동 생성 — claude CLI 두 프로세스 + 결정적 게이트.

    plan.json ──► 개입지점마다
                     │
        ┌────────────┴────────────┐
        │  증거번들 (대사 + 프레임 + 색 팔레트)
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐   claude -p  · skills/quiz/SKILL.md
        │  ① 생성자 프로세스       │   허용 도구 Read (프레임을 눈으로 본다)
        └────────────┬────────────┘
                     │ cards[]  (why 포함)
                     │
                     │  why 를 떼어내고 넘긴다 ◄── 독립성의 실체
                     │
        ┌────────────▼────────────┐   claude -p  · skills/verify/SKILL.md
        │  ② 검증자 프로세스       │   별도 프로세스 = 생성자 문맥 물리적 차단
        └────────────┬────────────┘
                     │ verdicts[]  accept / reject / fix
                     │
        ┌────────────▼────────────┐
        │  ③ 결정적 게이트         │   LLM 판단 아님. 실패는 재시도가 아니라 폐기
        │   activities.gate  인용이 원문에 있는가                       │
        │   grounding.check_answer  정답이 증거에서 나오는가            │
        └────────────┬────────────┘
                     ▼
              <작품>_cards.json

두 에이전트를 **한 프로세스 안 두 프롬프트**로 짜면 안 된다. 같은 문맥을 공유하는
순간 검증이 아니라 추인이 된다. 프로세스를 나누는 것이 유일하게 확실한 차단이다.
"""
from __future__ import annotations

import json
import re
import subprocess

import storydot
import sys
from pathlib import Path

import activities
import grounding

ROOT = Path(__file__).parent
SKILLS = ROOT / "skills"

# 유형마다 "정답이 증거에 어떻게 들어 있는가" 가 다르다. 한 가지로 재면 안 된다.
#   literal      정답이 대사·화면에 그대로 있다        → 문자열 대조로 검사
#   inferential  정답이 증거에서 따라 나온다           → 근거 스팬 실재 + 검증자 accept
#   creative     정답이 없는 것이 정상                 → 정답이 있으면 오히려 오류
# 이 구분을 안 두면 감정·인과 문제가 전멸한다 (실측: '마음 읽기 → 기뻐요' 가
# 전사본에 "기뻐요" 가 없다는 이유로 폐기됐다).
GROUNDING_MODE = {
    "이야기 이해": "literal",   "낱말 알기": "literal",   "문장 배열": "literal",
    "개수 세기": "literal",     "크기 비교": "literal",   "모양 찾기": "literal",
    "같은 것 찾기": "literal",  "분류하기": "literal",    "순서 세기": "literal",
    "색깔 퀴즈": "literal",     "연관성 카드 퀴즈": "literal",
    "마음 읽기": "inferential", "원인과 결과": "inferential",
    "도움 주고받기": "inferential", "안전 알기": "inferential",
    "이어질 말 상상": "creative", "내가 그 자리라면": "creative",
    "장면 감상": "creative",    "그림으로 표현": "creative", "그림 감상문": "creative",
}
TIMEOUT = 300


def _claude(skill: str, prompt: str, extra_dirs: list[Path] = ()) -> dict:
    """claude CLI 를 헤드리스로 1회 호출하고 JSON 을 받는다.

    도구는 Read 만 준다 — 프레임 이미지를 봐야 하지만 파일을 고치면 안 된다.
    """
    sysmsg = (SKILLS / skill / "SKILL.md").read_text()
    cmd = ["claude", "-p", prompt, "--append-system-prompt", sysmsg,
           "--allowed-tools", "Read", "--output-format", "json"]
    for d in extra_dirs:
        cmd += ["--add-dir", str(d)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT, cwd=ROOT)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패({skill}): {r.stderr[-300:]}")
    return _first_json_object(storydot.claude_result(r.stdout), skill)


def _first_json_object(text: str, tag: str = "") -> dict:
    """텍스트에서 첫 번째 완결된 JSON 객체를 꺼낸다.

    `re.search(r"\\{.*\\}")` 로 하면 안 된다. 모델이 JSON 뒤에 설명을 덧붙이거나
    코드블록을 두 개 내면 탐욕 매칭이 그 사이를 통째로 삼켜서
    `Extra data: line 1 column 137` 로 깨진다 (실측: 뽀로로 455.05 슬롯이 통째로 유실).
    중괄호 깊이를 세어 첫 객체가 닫히는 지점에서 끊는다. 문자열 안의 괄호는 건너뛴다.
    """
    start = text.find("{")
    if start < 0:
        raise ValueError(f"JSON 을 못 찾았다({tag}): {text[:200]}")
    depth, in_str, esc = 0, False, False
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
    raise ValueError(f"JSON 이 안 닫혔다({tag}): {text[:200]}")


def bundle(it: dict) -> str:
    """개입지점 하나를 사람이 읽는 증거번들 텍스트로 만든다."""
    lines = [f"# 개입지점 {it['t']:.1f}초 ({int(it['t']//60)}분 {it['t']%60:.0f}초)",
             f"직전에 끝난 장면: {it['act']['beat']}", "",
             "## 아이가 방금 들은 말 (전사본)"]
    for e in it["evidence"]:
        lines.append(f"  {e['id']}  [{e['conf']}]  \"{e['text']}\"")

    frames = it.get("frames") or []
    if frames:
        lines += ["", "## 아이가 방금 본 화면 — Read 로 전부 열어 봐라"]
        for i, f in enumerate(frames):
            tag = " ← 멈춤 화면" if i == len(frames) - 1 else ""
            lines.append(f"  {f['id']}  t={f['t']:.1f}s  {f['path']}{tag}")

    col = it.get("colors") or {}
    if col.get("colors"):
        lines += ["", "## 멈춤 화면의 색 (면적 기준)",
                  f"  정답 가능 : {', '.join(col.get('colors', []))}",
                  f"  애매(금지) : {', '.join(col.get('trace', [])) or '없음'}",
                  f"  오답 안전  : {', '.join(col.get('absent', [])) or '없음'}"]
    return "\n".join(lines)


def strip_reasoning(cards: list[dict]) -> list[dict]:
    """검증자에게 넘기기 전 출제자의 근거 설명을 떼어낸다.

    이걸 남기면 검증자가 증거가 아니라 출제자의 논리를 채점하게 된다.
    독립성은 프롬프트 문구가 아니라 **입력에서 지우는 것**으로 만든다.
    """
    return [{k: v for k, v in c.items() if k != "why"} for c in cards]


def run_slot(plan: dict, it: dict, work: Path) -> dict:
    ev = it["evidence"]
    b = bundle(it)

    gen = _claude("quiz", f"{b}\n\n위 증거만으로 활동을 만들어라.",
                  extra_dirs=[work])
    cards = gen.get("activities", [])
    if not cards:
        return {"t": it["t"], "slot_id": it.get("id"), "activities": [],
                "raw": [], "note": "생성자가 근거 부족으로 0개 반환"}

    # 검증자가 판정을 빠뜨리면 그 카드는 무조건 폐기된다. 진짜 거부와
    # 응답 누락을 구분하지 못하면 멀쩡한 카드가 조용히 사라진다
    # (실측: 타요 1:54 에서 4건이 통째로 유실됐다). 항목 수가 안 맞으면 한 번 더 묻는다.
    vprompt = (f"{b}\n\n## 검증할 활동\n"
               f"{json.dumps(strip_reasoning(cards), ensure_ascii=False, indent=1)}\n\n"
               f"각 항목을 독립 판정해라. **정확히 {len(cards)}개**의 판정을 "
               f"index 0..{len(cards) - 1} 로 빠짐없이 내라.")
    verdicts = {}
    for attempt in range(2):
        try:
            ver = _claude("verify", vprompt, extra_dirs=[work])
            verdicts = {v["index"]: v for v in ver.get("verdicts", [])}
        except Exception:
            verdicts = {}
        if len(verdicts) >= len(cards):
            break
        if attempt == 0:
            print(f"    검증 판정 {len(verdicts)}/{len(cards)} — 재시도", flush=True)

    kept, dropped = [], []
    for i, c in enumerate(cards):
        v = verdicts.get(i, {"verdict": "reject", "reason": "검증자가 판정을 안 냈다"})
        if v["verdict"] == "reject":
            dropped.append({**c, "drop": f"검증자 거부 — {v.get('reason', '')}"})
            continue
        if v["verdict"] == "fix" and v.get("answer"):
            c = {**c, "answer": v["answer"], "fixed_by_verifier": True}
        # 결정적 게이트 — LLM 두 명이 합의해도 여기를 못 넘으면 폐기.
        #
        # 근거 채널이 다르면 검사도 달라야 한다. grounding 은 전사본만 본다.
        # "버스가 몇 대?" 의 정답 4 는 화면에서 나오므로 전사본에 있을 리 없고,
        # 전사본 기준으로 재면 **개수·색 퀴즈가 전부 폐기된다** (실측: 타요에서
        # 4건 전멸). 시각 근거형은 프레임 실재 + 검증자의 직접 확인이 관문이다.
        mode = GROUNDING_MODE.get(c.get("type"), "literal")
        if mode == "creative":
            # 정답이 없는 게 정상이다. 주제가 증거와 이어지는지는 검증자가 봤다.
            if c.get("answer") is not None:
                dropped.append({**c, "drop": "창작형인데 정답이 있다"})
                continue
        elif mode == "inferential":
            # 감정·인과는 대사에 글자로 안 나온다. "기뻐요" 를 전사본에서 찾으면
            # 사회관계 영역 활동이 전멸한다 (실측). 근거 스팬 실재 + 검증자 accept 가 관문.
            if c.get("source_id") and c["source_id"] not in {e["id"] for e in ev}:
                dropped.append({**c, "drop": f"근거 스팬 없음 — {c['source_id']}"})
                continue
            if v["verdict"] != "accept":
                dropped.append({**c, "drop": "추론형은 검증자 accept 필수"})
                continue
        elif c.get("frame_id") and not c.get("source_id"):
            if c["frame_id"] not in {f["id"] for f in (it.get("frames") or [])}:
                dropped.append({**c, "drop": f"프레임 없음 — {c['frame_id']}"})
                continue
            if v["verdict"] != "accept":
                dropped.append({**c, "drop": "시각 근거형은 검증자 accept 필수"})
                continue
        else:
            gv, greason = grounding.check_answer(c, ev)
            if gv == "ungrounded":
                dropped.append({**c, "drop": f"정답 근거 없음 — {greason}"})
                continue
        kept.append(c)
    # 게이트 **이전** 생성자 출력을 그대로 남긴다. 환각률의 분모다.
    #
    # 이걸 안 남기면 activities + dropped 로 근사할 수밖에 없는데, dropped 에는
    # 검증자 거부가 섞여 있고 검증자 이전에 사라진 것은 아예 안 잡힌다.
    # 분모가 가짜면 어떤 비교도 성립하지 않는다. 생성 로직은 건드리지 않는다.
    return {"t": it["t"], "slot_id": it.get("id"),
            "activities": kept, "dropped": dropped, "raw": cards}


def main(plan_path: Path):
    plan = json.loads(plan_path.read_text())
    work = plan_path.parent
    slots = []
    for it in plan["interrupts"]:
        print(f"  · {it['t']:.1f}s 생성·검증 중 …", flush=True)
        try:
            slots.append(run_slot(plan, it, work))
        except Exception as exc:
            print(f"    실패: {type(exc).__name__}: {exc}")
            slots.append({"t": it["t"], "activities": [], "error": str(exc)})

    out = plan_path.with_name(plan_path.name.replace("_plan", "_cards"))
    out.write_text(json.dumps({"slots": slots}, ensure_ascii=False, indent=1))
    raw_out = plan_path.with_name(plan_path.name.replace("_plan", "_raw"))
    raw_out.write_text(json.dumps(
        {"raw": [{**c, "_slot_t": s.get("t")} for s in slots for c in s.get("raw", [])]},
        ensure_ascii=False, indent=1))

    kept = sum(len(s["activities"]) for s in slots)
    drop = sum(len(s.get("dropped", [])) for s in slots)
    print(f"\n{plan_path.stem.replace('_plan','')}  채택 {kept}  폐기 {drop}  → {out.name}")
    for s in slots:
        if not (s["activities"] or s.get("dropped")):
            continue
        print(f"\n[{int(s['t']//60)}:{s['t']%60:05.2f}]")
        for c in s["activities"]:
            print(f"  ✓ {c['type']} ({c['age']})  {c['prompt']}")
            if c.get("choices"):
                print(f"      {' / '.join(c['choices'])}  → {c.get('answer')}")
            src = c.get("source_id") or c.get("frame_id")
            print(f"      근거 {src}: {c.get('quote') or '(화면)'}")
        for c in s.get("dropped", []):
            print(f"  ✗ {c['type']}  {c['drop'][:90]}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("사용법: python3 generate.py work/<작품>_plan.json [...]")
    for p in sys.argv[1:]:
        main(Path(p))
