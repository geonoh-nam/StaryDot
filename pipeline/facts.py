"""활동 재료를 **영상 전체**에서 뽑는다. 정지점을 모른다. (신규 · 기존 파일 무수정)

현행 파이프라인은 재료가 정지점의 함수다 — `evidence(canon, act, names, at=t)` 는
t 가 정해져야 부르고 직전 100초만 본다. 그래서 "이 영상에 어떤 출제 재료가 있는가"
라는 질문 자체가 없다. 실측하면 손실이 크다:

    작품        세그먼트   출제가능   실제조회   조회율
    브레드         237       119        0     0.0%   ← 정지점이 0이라 재료 전체가 사장
    뽀로로         214        56       18    32.1%
    아기상어       157        39        7    17.9%
    타요           237        69       30    43.5%
    티니핑         167       106        6     5.7%
    ─────────────────────────────────────────────────
    합계          1012       389       61    15.7%

여기서는 재료를 **정지점과 무관하게** 인덱스로 만든다. 각 재료가 시간 범위를 갖고
있으므로, 언제 보여줄지는 나중에 이 인덱스를 조회하면 되는 별개 문제가 된다.

재료 판정 원칙 — **정답을 만들 수 있는가만 본다.**
오답은 틀리는 게 목적이라 증거에 없는 게 정상이고, 지어내도 된다. 그래서
"안전한 오답 확보"는 재료 조건이 아니다. 대신 팔레트의 absent 대역은 버리지 않고
**정답 반증 목록**으로 쓴다 — "화면에 없는 색을 정답이라 했다"를 모델 없이 잡는다.

추출은 전부 결정적이다. LLM 을 쓰지 않는다.

**개수 재료는 뺐다 (실측 실패).** 색 이름 기준 연결 성분으로 '동종 사물 복수' 를
잡으려 했는데 실제 사례에서 무너졌다. 타요 276초(사람 검증: 버스 4대 — 빨강·노랑·
초록·파랑)에서 뽑힌 덩어리는 흰색 20.9% · 회색 14.3% · 회색 6.0% · 노랑 4.7% …
로 버스가 잡히지 않는다. 이유가 둘이고 둘 다 구조적이다.
  · **동종 사물의 색이 서로 다르다.** 버스 4대를 같은 색으로 묶을 수가 없다.
  · **3D 음영 때문에 한 사물이 여러 색 이름에 걸친다.** 한 대가 여러 덩어리로 쪼개진다.
색 무관 크기 유사 묶음도 시도했으나 [160, 271, 275, 417, 430] 처럼 무관한 것들이
섞였다. 5편 전체로는 프레임당 4개꼴(브레드 289건)이 나와 잡음이 지배적이었다.
결론: **개수 세기는 결정적 재료 판정이 불가능한 유형이다.** 프레임을 직접 보는
쪽(생성자)에 맡기고, 여기서는 재료로 주장하지 않는다.

    python3 facts.py                 자체검사 + 5편 재료 인덱스 요약
    python3 facts.py 타요1화          한 편 상세
    python3 facts.py --write         work/<작품>_facts.json 저장 (원본 무수정)
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import beats
import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
# 이 저장소의 영상은 콘텐츠 서버가 스트리밍하는 media 아래 산다. 먼저 거기를 본다.
VIDEO_DIRS = [Path(__file__).resolve().parent.parent / "backend" / "server" / "media" / "video",
              Path.home() / "videodata",
              Path.home() / "Downloads" / "test_videos", Path.home() / "Downloads"]

# ── 샘플링 ──────────────────────────────────────────────────────────────────
# 화면 재료는 전 구간에서 균등 샘플한다. 장면 경계에 맞추면 beats 에 다시 묶이므로
# 일부러 단순 균등으로 둔다 — 재료 추출은 어떤 경계 정의도 몰라야 한다.
SAMPLE_SEC = 12.0
SAMPLE_W, SAMPLE_H = 128, 72

# ── 대사 표지 ───────────────────────────────────────────────────────────────
CAUSE = re.compile(r"(때문|니까|어서|아서|므로|덕분|바람에|그래서|왜냐)")
EMOTION = re.compile(r"(기뻐|기쁘|슬퍼|슬프|무서|두려|놀랐|놀라|화났|화나|속상|"
                     r"신나|신났|좋아|싫어|미안|고마워|울어|울고|웃어|웃으|행복|외로)")
# '같이/함께' 는 뺐다. "같이 놀까?" 가 수혜 재료로 잡혀 도움 주고받기 문제의
# 근거가 되면 안 된다 — 실측(타요 0:19)에서 오탐이었다.
HELP = re.compile(r"(줄게|줄까|도와|도움|구해|살려|고마워|빌려|나눠)")

# 명사 판별용 조사. 명사는 조사를 받고 부사·감탄사는 잘 안 받는다("그럼이" ✗).
NOUN_PARTICLE = re.compile(r"(이|가|을|를|은|는|에|도|와|과|으로|로|의|만|랑|이랑)(?![가-힣])")

# 재료 id 접두사. **종류마다 달라야 한다** — 'cause' 와 'color' 를 둘 다 c### 로 냈다가
# by_id 에서 서로 덮어썼고, 모델이 고른 인과 재료가 색 재료로 해석돼 멀쩡한 카드
# 3건이 "재료가 뒷받침하지 않음" 으로 폐기됐다(실측 타요). 환각률이 내 버그로 부풀었다.
PREFIX = {"utterance": "ut", "cause": "ca", "emotion": "em",
          "help": "hp", "keyword": "kw", "color": "co"}

# 재료 종류 → 이 재료로 만들 수 있는 활동 유형 (skills/quiz 의 20종 중)
AFFORD = {
    "utterance": ["이야기 이해", "이어질 말 상상", "장면 감상"],
    "cause":     ["원인과 결과"],
    "emotion":   ["마음 읽기", "내가 그 자리라면"],
    "help":      ["도움 주고받기"],
    "keyword":   ["낱말 알기"],
    "color":     ["색깔 퀴즈"],
}
# 결정적 재료 판정이 불가능한 유형. 프레임을 직접 봐야 성립 여부를 알 수 있으므로
# 재료 인덱스가 보증하지 않는다. 생성자에게 프레임과 함께 '가능할 수도 있음' 으로만 넘긴다.
FRAME_ONLY = ["개수 세기", "크기 비교", "모양 찾기", "같은 것 찾기", "순서 세기"]


def find_video(stem: str) -> Path | None:
    for d in VIDEO_DIRS:
        p = d / f"{stem}.mp4"
        if p.exists():
            return p
    return None


# ── 프레임 샘플링 (ffmpeg 1회) ──────────────────────────────────────────────
def sample_frames(video: Path, interval: float = SAMPLE_SEC) -> list[tuple[float, bytes]]:
    """전 구간을 interval 초 간격으로 샘플한다. **ffmpeg 을 한 번만** 부른다.

    프레임마다 따로 부르면 12분 1편에 70여 회가 되어 재료 추출이 인제스트보다
    느려진다. fps 필터로 한 번에 뽑아 PPM 스트림으로 받는다.
    """
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
         "-vf", f"fps=1/{interval},scale={SAMPLE_W}:{SAMPLE_H}",
         "-f", "image2pipe", "-vcodec", "ppm", "-"],
        capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg 실패: {p.stderr.decode('utf-8','replace')[-300:]}")
    out, data, i, n = [], p.stdout, 0, 0
    while i < len(data) - 1 and data[i:i + 2] == b"P6":
        w, h, px, nxt = _read_ppm_at(data, i)
        # fps=1/interval 은 각 구간의 첫 프레임을 낸다. 시각은 n*interval.
        out.append((n * interval, px))
        n += 1
        i = nxt
    return out


def _read_ppm_at(data: bytes, pos: int) -> tuple[int, int, bytes, int]:
    """스트림 중간의 P6 하나를 읽고 다음 시작 위치를 돌려준다."""
    pos += 2
    vals = []
    while len(vals) < 3:
        while pos < len(data) and data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b"#":
            while pos < len(data) and data[pos] not in (0x0A, 0x0D):
                pos += 1
            continue
        s = pos
        while pos < len(data) and not data[pos:pos + 1].isspace():
            pos += 1
        vals.append(int(data[s:pos]))
    pos += 1
    w, h, maxv = vals
    if maxv != 255:
        raise ValueError(f"8비트 PPM만 다룬다 (maxval={maxv})")
    end = pos + w * h * 3
    return w, h, data[pos:end], end


def quantize(px: bytes, w: int, h: int) -> list[str]:
    """픽셀마다 11색 중 하나로 이름을 붙인다. visual.classify_color 와 같은 규칙."""
    return [visual.classify_color(px[i], px[i + 1], px[i + 2])
            for i in range(0, w * h * 3, 3)]


def palette_of(labels: list[str]) -> dict[str, float]:
    c = Counter(labels)
    n = len(labels)
    return {k: c[k] / n for k in visual.COLOR_NAMES if c[k]}


# ── 대사 재료 ───────────────────────────────────────────────────────────────
def _fact(fid, s, kind, payload, conf=None):
    return {"id": fid, "t0": s["t0"], "t1": s["t1"], "kind": kind,
            "payload": payload, "evidence": [s["id"]],
            "conf": conf or s.get("conf", "medium"),
            "afford": AFFORD.get(kind, [])}


def speech_facts(canon: list[dict], names: set[str]) -> list[dict]:
    """전 구간 세그먼트에서 대사 재료를 뽑는다. 정지점을 안 본다."""
    out, i = [], 0
    for s in canon:
        if s["conf"] not in ("high", "medium"):
            continue
        if not storydot.informative(s["text"], names) or storydot.songlike(s["text"]):
            continue
        t = s["text"]
        i += 1
        out.append(_fact(f"{PREFIX['utterance']}{i:03d}", s, "utterance", {"text": t}))
        for kind, rx in (("cause", CAUSE), ("emotion", EMOTION), ("help", HELP)):
            m = rx.search(t)
            if m:
                i += 1
                out.append(_fact(f"{PREFIX[kind]}{i:03d}", s, kind,
                                 {"cue": m.group(1), "text": t}))
    return out


def _noun_like(word: str, texts: list[str]) -> bool:
    """이 말이 명사인가 — **조사가 붙은 형태로 관측된 적이 있는가**로 판정한다.

    형태소 분석기 없이 품사를 가르는 최소 신호다. 명사는 조사를 받지만
    부사·감탄사는 거의 안 받는다. 이걸 안 걸면 낱말 재료가 '그럼·좋아' 로
    채워진다 — 실측(타요)에서 상위 두 개가 정확히 그것이었다.
    """
    rx = re.compile(re.escape(word) + r"(이|가|을|를|은|는|에서|에게|에|도|와|과"
                                      r"|으로|로|의|만|랑|이랑|처럼|보다)(?![가-힣])")
    return any(rx.search(t) for t in texts)


def keyword_facts(canon: list[dict], names: set[str], lo=2, hi=8) -> list[dict]:
    """에피소드 안에서 드물지도 흔하지도 않은 **명사** = 낱말 문제 재료.

    한 번뿐인 말은 오인식일 수 있고, 너무 잦은 말은 이미 아는 말이다.
    빈도만으로는 기능어가 올라오므로 명사 판별을 함께 건다.
    """
    freq, where = Counter(), {}
    texts = [x["text"] for x in canon if x["conf"] in ("high", "medium")]
    for s in canon:
        if s["conf"] not in ("high", "medium"):
            continue
        for tok in beats.tokens(s["text"]):
            if tok in names or len(tok) < 2 or not _noun_like(tok, texts):
                continue
            freq[tok] += 1
            where.setdefault(tok, s)
    out = []
    for k, (word, n) in enumerate(
            sorted(((w, n) for w, n in freq.items() if lo <= n <= hi),
                   key=lambda x: -x[1])[:12], 1):
        out.append(_fact(f"{PREFIX['keyword']}{k:03d}", where[word], "keyword",
                         {"word": word, "count": n}))
    return out


# ── 화면 재료 ───────────────────────────────────────────────────────────────
def screen_facts(video: Path, interval: float = SAMPLE_SEC) -> list[dict]:
    """샘플 프레임마다 색 재료와 개수 재료를 뽑는다."""
    out = []
    for k, (t, px) in enumerate(sample_frames(video, interval), 1):
        labels = quantize(px, SAMPLE_W, SAMPLE_H)
        pal = palette_of(labels)
        present = [nm for nm, r in pal.items() if r >= visual.MIN_RATIO]
        absent = [nm for nm in visual.COLOR_NAMES
                  if pal.get(nm, 0.0) < visual.ABSENT_RATIO]
        if present:
            out.append({
                "id": f"{PREFIX['color']}{k:03d}", "t0": t, "t1": t, "kind": "color",
                "payload": {"present": present, "absent": absent,
                            "peak": {nm: round(r, 4) for nm, r in pal.items()}},
                "evidence": [f"frame@{t:.0f}"], "conf": "high",
                "afford": AFFORD["color"]})
    return out


# ── 인덱스 ──────────────────────────────────────────────────────────────────
def build_index(canon: list[dict], names: set[str],
                video: Path | None = None, interval: float = SAMPLE_SEC) -> list[dict]:
    facts = speech_facts(canon, names) + keyword_facts(canon, names)
    if video is not None:
        facts += screen_facts(video, interval)
    return sorted(facts, key=lambda f: (f["t0"], f["id"]))


def afford_summary(facts: list[dict]) -> dict[str, int]:
    """활동 유형별로 뒷받침하는 재료가 몇 건인가. 0 이면 그 유형은 못 만든다."""
    c = Counter()
    for f in facts:
        for a in f["afford"]:
            c[a] += 1
    return dict(c)


# ── 자체검사 ────────────────────────────────────────────────────────────────
def selftest() -> None:
    """영상 없이 도는 검사. 재료 판정이 무동작이 아님을 증명한다."""
    def seg(i, t, txt, cf="medium"):
        return {"id": f"s{i:03d}", "t0": float(t), "t1": float(t) + 2.0,
                "text": txt, "conf": cf}

    canon = [
        seg(1, 10, "곰인형은 찢어진 이불을 꿰매기 시작했어요"),
        seg(2, 20, "실이 없어서 꿰맬 수가 없어"),          # cause
        seg(3, 30, "정말 속상해 보이는 표정이야"),          # emotion
        seg(4, 40, "내가 실을 빌려줄게"),                   # help
        seg(5, 50, "크롱! 크롱!"),                          # 내용 없음 → 제외
        seg(6, 60, "저기 고드름이 매달려 있네", "low"),     # 저신뢰 → 제외
    ]
    names = {"크롱"}
    f = speech_facts(canon, names)
    kinds = Counter(x["kind"] for x in f)

    assert kinds["cause"] == 1, f"인과 재료 검출 실패: {kinds}"
    assert kinds["emotion"] == 1, f"감정 재료 검출 실패: {kinds}"
    assert kinds["help"] == 1, f"수혜 재료 검출 실패: {kinds}"
    assert kinds["utterance"] == 4, f"발화 재료 수가 다르다: {kinds}"
    assert all(x["evidence"] for x in f), "근거 없는 재료가 있다"
    assert not any("s005" in x["evidence"] for x in f), "옹알이가 재료로 올라왔다"
    assert not any("s006" in x["evidence"] for x in f), "저신뢰 세그먼트가 올라왔다"

    # 낱말 재료는 조사가 붙는 명사만 (기능어 배제)
    assert _noun_like("이불", ["찢어진 이불을 꿰매요"]), "명사를 못 알아봤다"
    assert not _noun_like("그럼", ["그럼 같이 놀까?"]), "기능어가 명사로 잡혔다"

    ids = [x["id"] for x in f]
    assert len(ids) == len(set(ids)), f"재료 id 가 겹친다: {ids}"

    a = afford_summary(f)
    assert a.get("원인과 결과") == 1 and a.get("마음 읽기") == 1, a
    assert "개수 세기" not in a, "화면 재료 없이 개수 유형이 생겼다"

    print("자체검사 8/8 통과")


# ── 실행 ────────────────────────────────────────────────────────────────────
def main(argv: list[str]) -> int:
    selftest()
    write = "--write" in argv
    want = [a for a in argv if not a.startswith("-")]

    plans = sorted(WORK.glob("*_plan.json"))
    if want:
        # macOS 파일명은 NFD 로 저장된다. 인자(NFC)와 그냥 비교하면 절대 안 맞는다.
        plans = [p for p in plans
                 if any(storydot.nfc(w) in storydot.nfc(p.stem) for w in want)]

    print(f"\n{'작품':11s}{'재료':>6}{'발화':>6}{'인과':>5}{'감정':>5}{'수혜':>5}"
          f"{'낱말':>5}{'색':>5}   유형")
    print("─" * 88)
    for pp in plans:
        plan = json.loads(pp.read_text())
        name = pp.stem.replace("_plan", "")
        names = set(plan["names"]) | {v for vs in plan["names"].values() for v in vs}
        video = find_video(name)
        facts = build_index(plan["canonical"], names, video)
        k = Counter(f["kind"] for f in facts)
        a = afford_summary(facts)
        print(f"{name:11s}{len(facts):>6}{k['utterance']:>6}{k['cause']:>5}"
              f"{k['emotion']:>5}{k['help']:>5}{k['keyword']:>5}{k['color']:>5}"
              f"   {len(a)}종{'  (영상없음)' if video is None else ''}")
        if want:
            print("\n  유형별 재료 수: " + " · ".join(
                f"{t} {n}" for t, n in sorted(a.items(), key=lambda x: -x[1])))
            print("  ── 표본 ──")
            for kind in ("cause", "emotion", "help", "keyword", "color"):
                for f in [x for x in facts if x["kind"] == kind][:2]:
                    p = f["payload"]
                    desc = (p.get("text") or p.get("word")
                            or "정답가능 " + ", ".join(p.get("present", [])[:5]))
                    print(f"   [{kind:9s}] {storydot.mmss(f['t0']):>8}  {str(desc)[:56]}")
        if write:
            out = WORK / f"{name}_facts.json"
            out.write_text(json.dumps({"video": str(video) if video else None,
                                       "facts": facts, "afford": a},
                                      ensure_ascii=False, indent=1))
            print(f"   → {out.name} 저장")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
