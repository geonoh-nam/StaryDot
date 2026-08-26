"""앵커 일치 판정을 고치면 재료가 얼마나 회복되는가 — **자막을 정답지로** 잰다.

현행 규칙은 "앵커(VAD 패스)가 다뤘는데 어긋남 = 진짜 반증" 인데, 실측하면 앵커가
다룬 구간의 69~75% 가 어긋남으로 찍힌다. 그리고 low 는 재료에서 제외되므로
출제 가능한 재료의 65% 가 버려진다(5편 389건 중 252건).

원인은 **세그먼트 정렬 실패**다. VAD 가 음성 구간을 뭉쳐 앵커 세그먼트가 3배 길다:

    타요1화   base 237개 평균 2.1초   vs   anchor 90개 평균 6.1초

그래서 시간은 겹치는데 텍스트는 서로 다른 부분을 담는다. 실측 사례:

    base[15-17] "포마버스들이 은행을 나왔어요"
    anc [12-17] "화창한 아침 호마 버스들이 운행을 나왔어요"
                앞12자 0.19  ←  전체 0.69   같은 문장인데 앞부분이 달라 탈락

여기서는 storydot 을 건드리지 않고 규칙 후보를 나란히 재기만 한다. 정답 여부는
**공식 자막**과 대조해 판정하므로, "회복된 재료가 실제로 정확한가" 까지 나온다.

    현행    앞 12자 유사도 >= 0.6
    fix1    전체 유사도 (짧은 쪽 기준) >= 0.6
    fix2    base 내용 토큰의 70% 이상이 앵커에 존재
    fix3    fix1 과 fix2 의 합집합

    python3 align.py            5편 전체
    python3 align.py 타요1화     한 편 + 표본
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import storydot

ROOT = Path(__file__).parent
WORK = ROOT / "work"
SRT_DIRS = [Path.home() / "Downloads" / "test_videos", Path.home() / "Downloads"]

TRUTH_OK = 0.70      # 자막과 이 이상 닮으면 '정확한 전사' 로 본다
AGREE_TH = 0.60      # 규칙들이 공통으로 쓰는 일치 임계
TOKEN_TH = 0.70      # fix2 — base 토큰이 앵커에 얼마나 남아 있는가


def find_srt(stem: str) -> Path | None:
    for d in SRT_DIRS:
        for p in d.glob("*.srt"):
            if storydot.nfc(p.stem) == storydot.nfc(stem):
                return p
    return None


def parse_srt(path: Path) -> list[dict]:
    def sec(s):
        h, m, rest = s.split(":")
        s2, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s2) + int(ms) / 1000
    out = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").strip()):
        lines = [x for x in block.strip().split("\n") if x.strip()]
        if len(lines) < 2:
            continue
        head = lines[1] if lines[0].strip().isdigit() else lines[0]
        m = re.search(r"([\d:,]+)\s*-->\s*([\d:,]+)", head)
        if not m:
            continue
        body = lines[2:] if lines[0].strip().isdigit() else lines[1:]
        text = storydot.nfc(re.sub(r"<[^>]+>", "", " ".join(body)).strip())
        if text:
            out.append({"t0": sec(m.group(1)), "t1": sec(m.group(2)), "text": text})
    return out


# ── 정답 판정 ───────────────────────────────────────────────────────────────
def truth_score(seg: dict, srt: list[dict]) -> float:
    """자막과 얼마나 닮았는가. 겹치는 자막을 이어붙여 비교한다.

    자막도 세그먼트 경계가 다르므로 **겹치는 것을 모두 이어붙인 뒤** 그 안에
    base 문장이 들어 있는지를 본다. 한 자막과만 비교하면 정렬 문제가 반복된다.
    """
    a = storydot.norm(seg["text"])
    if not a:
        return 0.0
    joined = storydot.norm(" ".join(
        c["text"] for c in srt
        if storydot.overlaps(seg["t0"] - 1.0, seg["t1"] + 1.0, c["t0"], c["t1"])))
    if not joined:
        return 0.0
    if a in joined:
        return 1.0
    return token_ratio(a, joined)


def token_ratio(a: str, b: str) -> float:
    """a 의 2음절 조각이 b 에 얼마나 남아 있는가. 길이 차이에 둔감하다."""
    grams = [a[i:i + 2] for i in range(len(a) - 1)] or [a]
    return sum(1 for g in grams if g in b) / len(grams)


# ── 규칙 후보 ───────────────────────────────────────────────────────────────
def rule_current(a: str, b: str) -> bool:
    return a in b or b in a or storydot.similarity(a[:12], b[:12]) >= AGREE_TH


def rule_fix1(a: str, b: str) -> bool:
    """전체 유사도. 길이가 다르면 짧은 쪽 길이만큼 잘라 비교한다."""
    if a in b or b in a:
        return True
    n = min(len(a), len(b))
    return storydot.similarity(a[:n], b[:n]) >= AGREE_TH


def rule_fix2(a: str, b: str) -> bool:
    """base 조각이 앵커에 얼마나 남아 있는가. 앵커가 훨씬 길어도 성립한다."""
    return a in b or b in a or token_ratio(a, b) >= TOKEN_TH


def rule_fix3(a: str, b: str) -> bool:
    return rule_fix1(a, b) or rule_fix2(a, b)


RULES = {"현행": rule_current, "fix1": rule_fix1,
         "fix2": rule_fix2, "fix3": rule_fix3}


# ── 평가 ────────────────────────────────────────────────────────────────────
def evaluate(name: str, verbose: bool = False) -> dict | None:
    srtp = find_srt(name)
    if srtp is None:
        print(f"  {name}: 자막 없음, 건너뜀")
        return None
    base = storydot.read_whisper_json(WORK / f"{name}_small.json")
    anc = storydot.read_whisper_json(WORK / f"{name}_vad.json")
    srt = parse_srt(srtp)
    plan = json.loads((WORK / f"{name}_plan.json").read_text())
    names = set(plan["names"]) | {v for vs in plan["names"].values() for v in vs}

    rows = []
    for s in base:
        a = storydot.norm(s["text"])
        if not a:
            continue
        ov = [c for c in anc
              if storydot.overlaps(s["t0"], s["t1"], c["t0"], c["t1"])
              and storydot.norm(c["text"])]
        if not ov:
            continue                                   # 앵커 미커버 → 판정 보류
        verdicts = {k: any(fn(a, storydot.norm(c["text"])) for c in ov)
                    for k, fn in RULES.items()}
        rows.append({"seg": s, "truth": truth_score(s, srt), "v": verdicts,
                     "useful": storydot.informative(s["text"], names)
                     and not storydot.songlike(s["text"])})

    out = {"name": name, "n": len(rows), "rules": {}}
    for k in RULES:
        # 규칙이 '일치' 라 하면 medium(재료로 씀), '어긋남' 이면 low(버림)
        kept = [r for r in rows if r["v"][k]]
        drop = [r for r in rows if not r["v"][k]]
        loss = [r for r in drop if r["truth"] >= TRUTH_OK and r["useful"]]   # 정확한데 버림
        dirt = [r for r in kept if r["truth"] < TRUTH_OK and r["useful"]]    # 오인식인데 씀
        good = [r for r in kept if r["truth"] >= TRUTH_OK and r["useful"]]
        out["rules"][k] = {"kept": len(kept), "good": len(good),
                           "loss": len(loss), "dirt": len(dirt)}
    if verbose:
        print(f"\n  [{name}] fix2 가 살려낸 것 표본 (현행은 버렸다)")
        n = 0
        for r in rows:
            if r["v"]["fix2"] and not r["v"]["현행"] and r["truth"] >= TRUTH_OK \
                    and r["useful"] and n < 5:
                print(f"    자막일치 {r['truth']:.2f}  {r['seg']['text'][:52]}")
                n += 1
        print(f"  [{name}] fix2 가 새로 들인 오인식 표본")
        n = 0
        for r in rows:
            if r["v"]["fix2"] and not r["v"]["현행"] and r["truth"] < TRUTH_OK \
                    and r["useful"] and n < 3:
                print(f"    자막일치 {r['truth']:.2f}  {r['seg']['text'][:52]}")
                n += 1
    return out


def main(argv: list[str]) -> int:
    want = [storydot.nfc(a) for a in argv if not a.startswith("-")]
    names = [storydot.nfc(p.stem.replace("_plan", ""))
             for p in sorted(WORK.glob("*_plan.json"))]
    if want:
        names = [n for n in names if any(w in n for w in want)]

    tot: dict = {k: {"kept": 0, "good": 0, "loss": 0, "dirt": 0} for k in RULES}
    N = 0
    for n in names:
        r = evaluate(n, verbose=bool(want))
        if r is None:
            continue
        N += r["n"]
        for k in RULES:
            for f in ("kept", "good", "loss", "dirt"):
                tot[k][f] += r["rules"][k][f]

    print(f"\n앵커가 다룬 세그먼트 {N}건 기준 (자막을 정답지로)")
    print(f"\n{'규칙':>6}{'일치판정':>9}{'유용+정확':>11}{'손실':>7}{'오염':>7}"
          f"{'정밀도':>9}{'재현율':>9}")
    print("─" * 62)
    for k in RULES:
        t = tot[k]
        prec = t["good"] / max(1, t["good"] + t["dirt"])
        rec = t["good"] / max(1, t["good"] + t["loss"])
        print(f"{k:>6}{t['kept']:>9}{t['good']:>11}{t['loss']:>7}{t['dirt']:>7}"
              f"{100 * prec:>8.1f}%{100 * rec:>8.1f}%")
    print("\n손실 = 정확한 전사인데 버려진 재료   오염 = 오인식인데 재료로 쓰인 것")
    print("정밀도 = 쓴 것 중 정확한 비율        재현율 = 정확한 것 중 쓴 비율")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
