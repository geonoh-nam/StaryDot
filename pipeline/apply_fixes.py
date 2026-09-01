"""사다리 실험 완료 후 반영할 수정 4건. **실험 중에는 돌리지 마라.**

storydot.build_canonical 과 grounding 을 고치면 정본과 판정이 바뀌어서, 이미 나온
arm 결과와 비교가 깨진다. 사다리를 끝낸 뒤에 한 번에 반영한다.

각 수정은 실측 근거가 있다.

  #1 앵커 일치 판정  similarity(a[:12],b[:12]) → token_ratio(a,b)
     근거: 자막을 정답지로 809건 채점 (align.py)
           정밀도 82.4% → 89.9% · 재현율 56.0% → 63.0% · 오염 44 → 26건
     원인: VAD 가 음성을 뭉쳐 앵커 세그먼트가 3배 길다(타요 2.1s vs 6.1s).
           앞 12자만 보면 "화창한 아침 호마 버스들이…" 처럼 앞이 어긋난 경우
           같은 문장인데도 0.19 로 탈락한다(전체 유사도는 0.69).

  #2 name_hit 확장  치환 발생 → 치환 발생 OR 확정 이름이 원문에 등장
     근거: 시리즈 사전을 채워도 high 가 안 늘었다(11건 그대로).
           apply_names 는 **변이형 치환이 일어나야만** True 를 준다.
           변이형이 없는 이름(타요·로미·올리…)은 영원히 high 를 못 만든다.
           확장 시 high 11 → 74건.
     논리: ASR 이 '크롱' 을 정확히 들은 것도 '크랑' 을 교정한 것과 같은 검증 신호다.

  #3 경계 등호  s["t0"] > t  →  s["t0"] >= t
     근거: 타요 114.60 에서 다음 발화가 정확히 114.60 에 시작하는데 `>` 라 건너뛰고
           118.2 까지 재서 gap 3.60s 로 규칙을 통과했다. 실제 여유는 0.00s.

  #4 어간 매칭  용언 활용을 잇는다
     근거: J3 위반 13건 전수 검토(judge 메타평가). 4건(31%)이 과폐기였다.
           다투는→다퉈서 · 도와주고→도와줘서 · 재미있을→재미있다
     grounding docstring 이 이미 인정한 한계다("용언 활용은 못 잇는다").
     앞 2음절의 자모 유사도로 근사한다. 3음절 미만은 제외해 부스러기 매칭을 막는다.

    python3 apply_fixes.py --dry     무엇이 바뀌는지만 출력
    python3 apply_fixes.py           적용 + 자체검사
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent

FIXES = [
    # (파일, 찾을 것, 바꿀 것, 설명)
    ("storydot.py",
     '''                covered = True
                if a in b or b in a or similarity(a[:12], b[:12]) >= 0.6:''',
     '''                covered = True
                # 앞 12자 비교는 세그먼트 경계가 어긋나면 무너진다. VAD 가 음성을
                # 뭉쳐 앵커가 3배 길기 때문에(타요 2.1s vs 6.1s) 같은 문장인데도
                # 앞부분이 달라 탈락한다. 조각 잔존율로 바꾸면 길이 차이에 둔감하다.
                # 자막 정답지 809건 채점: 정밀도 82.4→89.9% · 재현율 56.0→63.0%
                if a in b or b in a or token_ratio(a, b) >= 0.70:''',
     "#1 앵커 일치 판정을 조각 잔존율로"),

    ("storydot.py",
     '''def norm(t: str) -> str:
    return re.sub(r"[^가-힣0-9]", "", t)''',
     '''def norm(t: str) -> str:
    return re.sub(r"[^가-힣0-9]", "", t)


def token_ratio(a: str, b: str) -> float:
    """a 의 2음절 조각이 b 에 얼마나 남아 있는가. 길이 차이에 둔감하다.

    앵커가 base 보다 훨씬 길어도 성립하고, 진짜 오인식은 조각이 안 남아 걸러진다.
    """
    grams = [a[i:i + 2] for i in range(len(a) - 1)] or [a]
    return sum(1 for g in grams if g in b) / len(grams)''',
     "#1 token_ratio 추가"),

    ("storydot.py",
     '''        fixed, name_hit = apply_names(text, names, phrases)
        nameset = set(names) | {v for vs in names.values() for v in vs}''',
     '''        fixed, name_hit = apply_names(text, names, phrases)
        nameset = set(names) | {v for vs in names.values() for v in vs}
        # 확정된 이름이 **원문에 그대로 있는 것**도 검증 신호다. apply_names 는
        # 변이형 치환이 일어나야만 True 를 주므로, 변이형이 없는 이름(타요·로미…)
        # 은 영원히 high 를 못 만든다 — 사전을 채워도 high 가 11건 그대로였다.
        # ASR 이 처음부터 맞게 들은 것을 인정하지 않을 이유가 없다. 11 → 74건.
        name_hit = name_hit or any(n in fixed for n in names)''',
     "#2 name_hit 에 원문 등장 포함"),

    ("storydot.py",
     '''        nxt = min((s["t0"] for s in canon if s["t0"] > t), default=end)''',
     '''        # `>` 면 t 에 **정확히 붙어 시작하는** 발화를 건너뛴다. 타요 114.60 에서
        # 다음 발화가 114.60 에 시작하는데 그걸 놓치고 118.2 까지 재서 gap 3.60s 로
        # 규칙을 통과했다. 실제 여유는 0.00s 였다.
        nxt = min((s["t0"] for s in canon if s["t0"] >= t), default=end)''',
     "#3 경계 등호"),

    ("grounding.py",
     '''def _token_grounded(token: str, ev_all: set[str], ev_strong: set[str]) -> bool:''',
     '''_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = "_ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"


def _jamo(w: str) -> str:
    out = []
    for ch in w:
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            out += [_CHO[c // 588], _JUNG[(c % 588) // 28], _JONG[c % 28]]
        else:
            out.append(ch)
    return "".join(out)


def _stem_match(a: str, b: str) -> bool:
    """용언 활용을 잇는다. '다퉈서' ↔ '다투는' 처럼 어미만 다른 경우.

    접미사 목록으로는 못 잡는 자리다(모듈 docstring 이 인정한 한계). 앞 2음절의
    자모 유사도로 근사한다. 3음절 미만은 제외해 부스러기 매칭을 막는다 —
    '바다' ↔ '바를' 같은 우연 일치가 살아나면 안 된다.

    실측 근거: J3 위반 13건 전수 검토에서 4건(31%)이 이 한계로 인한 과폐기였다.
    """
    if len(a) < 3 or len(b) < 3:
        return False
    ja, jb = _jamo(a[:2]), _jamo(b[:2])
    if not ja or not jb:
        return False
    d = _lev_local(ja, jb)
    return 1.0 - d / max(len(ja), len(jb)) >= 0.8


def _lev_local(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _token_grounded(token: str, ev_all: set[str], ev_strong: set[str]) -> bool:''',
     "#4 어간 매칭 함수 추가"),

    ("grounding.py",
     '''    short = {v for v in hit if len(v) == 1}
    if not short:
        return False
    return bool(short & variants(token, strong_only=True) & ev_strong)''',
     '''    short = {v for v in hit if len(v) == 1}
    if short and (short & variants(token, strong_only=True) & ev_strong):
        return True
    # 용언 활용 — 접미사 벗기기로 안 이어지는 자리를 어간 근사로 잇는다.
    return any(_stem_match(v, e) for v in ans_all if len(v) >= 3
               for e in ev_all if len(e) >= 3)''',
     "#4 _token_grounded 에 어간 매칭 연결"),
]


def main(argv: list[str]) -> int:
    dry = "--dry" in argv
    files = sorted({f for f, *_ in FIXES})

    if not dry:
        for f in files:
            shutil.copy(ROOT / f, ROOT / f"{f}.bak")
        print(f"백업: {', '.join(f + '.bak' for f in files)}\n")

    src = {f: (ROOT / f).read_text() for f in files}
    for f, old, new, desc in FIXES:
        if old not in src[f]:
            print(f"  ✗ {desc}  — 대상을 못 찾음 ({f}). 이미 반영됐거나 코드가 바뀌었다")
            return 1
        src[f] = src[f].replace(old, new, 1)
        print(f"  ✓ {desc}  ({f})")

    if dry:
        print("\n--dry 모드: 파일을 쓰지 않았다")
        return 0

    for f in files:
        (ROOT / f).write_text(src[f])
    print("\n적용 완료. 자체검사를 돌린다.\n")

    ok = True
    for mod in ("grounding.py", "beats.py", "facts.py", "activities.py"):
        r = subprocess.run([sys.executable, mod], capture_output=True, text=True, cwd=ROOT)
        tail = (r.stdout.strip().splitlines() or ["(출력 없음)"])[-1]
        print(f"  {mod:16s} {'통과' if r.returncode == 0 else '실패'}  {tail[:56]}")
        ok &= r.returncode == 0
    if not ok:
        print("\n자체검사 실패. 되돌리려면:")
        for f in files:
            print(f"  mv {f}.bak {f}")
        return 1
    print("\n다음: python3 facts.py --write  (정본이 바뀌었으므로 재료를 다시 뽑는다)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
