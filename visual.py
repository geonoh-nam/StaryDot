"""스토리닷 — 화면에서 근거를 뽑는다. 대사가 아니라 픽셀이 근거다.

전사본만 근거로 쓰면 "버스가 몇 대?", "무슨 색이야?" 를 물을 수 없다.
실제로 생성자가 개수 퀴즈를 만들려다 **없는 대사를 지어냈다.** 근거가 없으면
지어내는 것이 아니라 폐기해야 하고, 지어내지 않으려면 근거를 화면에서 줘야 한다.

    개입지점 t ─► 앞 span초 구간에서 n장 ─► jpg (에이전트가 Read 로 본다)
                                            │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                        palette()                    Read (에이전트)
                   화면에 실제 있는 색            개수·배치·사물은 눈으로
                   결정적 · LLM 없음                    │
                              │                         │
                              └──────────┬──────────────┘
                                         ▼
                                   frame_facts()
                          "이 구간에 존재하는 색" 집합 = 정답 검증
                          없는 색 목록 = 오답 보기 후보

activities.gate 와 같은 계약이다. 게이트는 quote 가 원문에 있는지 대조하고,
여기서는 답으로 쓰려는 색이 화면에 있는지 대조한다. 없으면 폐기다.

외부 패키지를 쓰지 않는다 (numpy·PIL·opencv 전부). 표준 라이브러리 + ffmpeg 뿐.
"""
from __future__ import annotations

import colorsys
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SHOTS = ROOT / "shots"

# ── 상수 ────────────────────────────────────────────────────────────────────
# 유아 퀴즈용 색 이름. 11개면 충분하다 — "청록"·"남색"을 물어봐도 답을 못 한다.
COLOR_NAMES = ["빨강", "주황", "노랑", "초록", "파랑", "보라",
               "분홍", "갈색", "검정", "흰색", "회색"]

FRAME_WIDTH = 512      # 에이전트가 Read 로 보는 해상도. 사물 개수를 셀 수 있는 최소선
SAMPLE_WIDTH = 128     # 색 통계용. 이 정도면 128x72 = 9216 표본
MIN_RATIO = 0.03       # 한 프레임에서 3% = 화면을 눈에 띄게 채웠다 (정답 허용선)
ABSENT_RATIO = 0.005   # 0.5% 미만이라야 "없다"고 단언한다 (오답 보기 허용선)

# 무채색 판정. 채도가 이보다 낮으면 색상(hue)은 노이즈다.
ACHROMATIC_S = 0.13
BLACK_V = 0.18
WHITE_V = 0.78
GRAY_V = 0.30


# ── ffmpeg ──────────────────────────────────────────────────────────────────
def _ffmpeg(args: list[str], capture: bool = False) -> bytes:
    """ffmpeg 1회 실행. 실패하면 stderr를 그대로 올린다 (조용히 삼키지 않는다)."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error"] + args,
                       capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg 실패: {p.stderr.decode('utf-8', 'replace').strip()}")
    return p.stdout if capture else b""


def _read_ppm(data: bytes) -> tuple[int, int, bytes]:
    """P6 PPM 파싱. 헤더는 공백·주석이 임의로 섞일 수 있어 토크나이즈한다."""
    if not data.startswith(b"P6"):
        raise ValueError("P6 PPM이 아니다 (ffmpeg 출력이 비었을 수 있다)")
    pos, vals = 2, []
    while len(vals) < 3:
        while pos < len(data) and data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b"#":                      # 주석은 줄 끝까지
            while pos < len(data) and data[pos] not in (0x0A, 0x0D):
                pos += 1
            continue
        start = pos
        while pos < len(data) and not data[pos:pos + 1].isspace():
            pos += 1
        vals.append(int(data[start:pos]))
    pos += 1                                               # maxval 뒤 공백 정확히 1개
    w, h, maxv = vals
    if maxv != 255:
        raise ValueError(f"8비트 PPM만 다룬다 (maxval={maxv})")
    px = data[pos:pos + w * h * 3]
    if len(px) < w * h * 3:
        raise ValueError(f"픽셀이 모자란다: {len(px)} < {w * h * 3}")
    return w, h, px


# ── 색 이름 ─────────────────────────────────────────────────────────────────
def classify_color(r: int, g: int, b: int) -> str:
    """RGB 한 점 → 한국어 색 이름 1개. 순수 함수 · 결정적.

    HSV로 옮겨서 ① 무채색을 먼저 걷어내고 ② 어둡고 탁한 난색을 갈색으로 빼낸 뒤
    ③ 나머지를 색상환으로 자른다. 순서가 중요하다 — 갈색을 먼저 빼지 않으면
    모든 갈색이 주황으로 몰린다.
    """
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    h *= 360.0

    if v < BLACK_V:
        return "검정"
    if s < ACHROMATIC_S:
        return "흰색" if v > WHITE_V else ("회색" if v > GRAY_V else "검정")

    warm = 10.0 <= h < 50.0
    if warm and v <= 0.60:                 # 어두운 난색 = 갈색 (흙·나무·머리카락)
        return "갈색"
    if warm and s <= 0.45 and v <= 0.80:   # 탁한 난색 = 갈색 (베이지·카키)
        return "갈색"

    if h < 12.0 or h >= 340.0:
        return "분홍" if (v > 0.72 and s < 0.42) else "빨강"
    if h < 45.0:
        return "주황"
    if h < 68.0:
        return "노랑"
    if h < 168.0:
        return "초록"
    if h < 258.0:                          # 하늘색·청록·남색 전부 파랑으로 접는다
        return "파랑"
    if h < 300.0:
        return "보라"
    return "분홍"                          # 300~340 = 자홍


# ── 공개 API ────────────────────────────────────────────────────────────────
def extract_evidence_frames(video_path, t_center: float, span: float = 20.0,
                            n: int = 4, out_dir=SHOTS) -> list[dict]:
    """개입지점 앞 span초에서 n장을 균등 추출한다.

    구간은 [t_center - span, t_center] 이고 양끝을 포함한다. 마지막 장이 정확히
    개입지점인 것이 중요하다 — 영상이 멈추고 퀴즈가 뜰 때 아이가 실제로 보고 있는
    화면이 그 프레임이다. "화면에 몇 대?" 의 '화면'이 이것이다.

    -ss 를 -i 앞에 두면 키프레임까지 빠르게 건너뛴 뒤 정확한 프레임까지 디코딩한다
    (ffmpeg 2.1+). 빠르면서 결정적이다.

    이미 뽑아 둔 파일은 다시 만들지 않는다 (storydot.transcribe 와 같은 재사용 규칙).

    반환: [{"id": "f0001", "t": 259.0, "path": "..../타요1화_002590.jpg"}, ...]
          시각이 겹치면 접으므로 len(반환) <= n 이다.
    """
    video = Path(video_path)
    if not video.exists():
        raise FileNotFoundError(f"영상이 없다: {video}")
    if n < 1:
        raise ValueError("n은 1 이상이어야 한다")
    if span < 0:
        raise ValueError("span은 음수일 수 없다")

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    t0 = max(0.0, t_center - span)
    if n == 1:
        times = [t_center]
    else:
        step = (t_center - t0) / (n - 1)
        times = [round(t0 + step * i, 3) for i in range(n)]
    # 구간이 뭉개지면(span=0, 또는 n에 비해 span이 너무 짧으면) 같은 시각이 겹친다.
    # 같은 파일을 가리키는 프레임을 n장 돌려주느니 중복을 접는다 — 그래서 len < n일 수 있다
    times = list(dict.fromkeys(times))

    frames = []
    for i, t in enumerate(times, 1):
        # 파일명에 시각을 박아 개입지점끼리 덮어쓰지 않게 한다 (id는 호출 단위 일련번호)
        path = out / f"{video.stem}_{int(round(t * 10)):06d}.jpg"
        if not path.exists():
            _ffmpeg(["-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                     "-vf", f"scale={FRAME_WIDTH}:-2", "-pix_fmt", "yuvj444p",
                     "-q:v", "2", "-y", str(path)])
        frames.append({"id": f"f{i:04d}", "t": t, "path": str(path)})
    return frames


def palette(frame_path, k: int = 5) -> list[dict]:
    """프레임 1장의 지배 색상 상위 k개. 결정적 · LLM 없음.

    작게 줄여 PPM으로 받은 뒤 픽셀마다 11색 중 하나로 이름을 붙이고 세는 것이
    전부다. k-means 를 쓰지 않는 이유는 결과가 어차피 11개 이름으로 접히기
    때문이다 — 군집 중심을 정밀하게 찾아도 "파랑"이라는 답은 바뀌지 않는다.

    축소는 neighbor(최근접)로 한다. area 평균을 쓰면 빨간 버스와 파란 버스의
    경계에서 **화면에 없는 보라색이 생긴다.** 없는 색을 만들어내면 안 된다.

    반환: [{"name": "파랑", "hex": "#3A7BD5", "ratio": 0.42}, ...]
          ratio는 전체 픽셀 대비 비율이라 상위 k개의 합은 1.0 이하다.
          k >= 11 이면 합이 1.0이 된다.
    """
    frame = Path(frame_path)
    if not frame.exists():
        raise FileNotFoundError(f"프레임이 없다: {frame}")
    if k < 1:
        raise ValueError("k는 1 이상이어야 한다")

    raw = _ffmpeg(["-i", str(frame), "-vf", f"scale={SAMPLE_WIDTH}:-2",
                   "-sws_flags", "neighbor", "-f", "image2pipe",
                   "-vcodec", "ppm", "-"], capture=True)
    w, h, px = _read_ppm(raw)

    counts = {name: 0 for name in COLOR_NAMES}
    sums = {name: [0, 0, 0] for name in COLOR_NAMES}
    for i in range(0, w * h * 3, 3):
        r, g, b = px[i], px[i + 1], px[i + 2]
        name = classify_color(r, g, b)
        counts[name] += 1
        acc = sums[name]
        acc[0] += r
        acc[1] += g
        acc[2] += b

    total = w * h
    # 동률은 이름 순으로 깨서 결정성을 보장한다
    order = sorted(COLOR_NAMES, key=lambda nm: (-counts[nm], COLOR_NAMES.index(nm)))
    result = []
    for name in order[:k]:
        c = counts[name]
        if c == 0:
            continue
        r, g, b = (v // c for v in sums[name])
        result.append({"name": name, "hex": f"#{r:02X}{g:02X}{b:02X}",
                       "ratio": round(c / total, 4)})
    return result


def frame_facts(frames: list[dict], min_ratio: float = MIN_RATIO,
                absent_ratio: float = ABSENT_RATIO) -> dict:
    """여러 프레임의 팔레트를 합쳐 이 구간의 색 사실을 확정한다.

    판정은 **한 프레임에서라도** 얼마나 차지했는지(peak)로 본다. 평균으로 보면
    4장 중 1장에만 크게 나온 빨간 소방차가 평균 아래로 깔려 사라진다. 한 번
    보였으면 화면에 있었던 것이다.

    색을 세 갈래로 나눈다. **두 갈래로 나누면 틀린 퀴즈가 나온다** — 실측으로
    확인했다. 타요 276.5s 차고 장면의 빨간 버스는 화면의 1.5%, 아기상어 396.7s의
    보라 해초는 2.0%다. 둘 다 눈에 확 띄는데 3% 문턱 아래다. 여기서 "3% 미만 =
    없음" 으로 접으면 **빨간 버스가 눈앞에 있는데 "빨강"을 오답 보기로 낸다.**

        peak >= min_ratio      colors  화면을 눈에 띄게 채운 색. 정답으로 써도 된다
        그 사이               trace   작지만 존재. 정답도 오답도 아니다 — 눈으로 봐라
        peak <  absent_ratio   absent  확정 부재. 오답 보기로 안전하다

    한계 — 화면의 0.5% 미만인 사물(멀리 있는 불가사리 등)은 absent 로 떨어진다.
    면적 통계의 바닥이다. 작은 사물의 색을 물으려면 팔레트가 아니라 jpg를 Read 해라.

    반환: {"frames", "colors", "trace", "absent", "dominant",
           "ratios", "peak", "per_frame", "min_ratio", "absent_ratio"}
    """
    if not frames:
        raise ValueError("프레임이 비었다")
    if not 0.0 <= absent_ratio <= min_ratio:
        raise ValueError("absent_ratio는 0 이상 min_ratio 이하여야 한다")

    pals = [palette(f["path"], k=len(COLOR_NAMES)) for f in frames]
    peak = {name: 0.0 for name in COLOR_NAMES}
    mean = {name: 0.0 for name in COLOR_NAMES}
    for pal in pals:
        for entry in pal:
            nm, ratio = entry["name"], entry["ratio"]
            peak[nm] = max(peak[nm], ratio)
            mean[nm] += ratio / len(pals)

    def by_rank(names):
        return sorted(names, key=lambda nm: (-mean[nm], COLOR_NAMES.index(nm)))

    present = by_rank([nm for nm in COLOR_NAMES if peak[nm] >= min_ratio])
    trace = by_rank([nm for nm in COLOR_NAMES
                     if absent_ratio <= peak[nm] < min_ratio])
    absent = by_rank([nm for nm in COLOR_NAMES if peak[nm] < absent_ratio])
    return {
        "frames": len(frames),
        "colors": present,
        "trace": trace,
        "absent": absent,
        "dominant": present[0] if present else None,
        "ratios": {nm: round(mean[nm], 4) for nm in COLOR_NAMES},
        "peak": {nm: round(peak[nm], 4) for nm in COLOR_NAMES},
        "per_frame": [{"id": f["id"], "t": f["t"], "palette": p}
                      for f, p in zip(frames, pals)],
        "min_ratio": min_ratio,
        "absent_ratio": absent_ratio,
    }


# ── 자체검사 ────────────────────────────────────────────────────────────────
def _check_palette(pal: list[dict], where: str):
    assert pal, f"{where}: 팔레트가 비었다"
    for e in pal:
        assert e["name"] in COLOR_NAMES, f"{where}: 목록 밖의 색 이름 {e['name']!r}"
        assert len(e["hex"]) == 7 and e["hex"][0] == "#", f"{where}: hex 형식 {e['hex']!r}"
        assert 0.0 < e["ratio"] <= 1.0, f"{where}: ratio 범위 {e['ratio']}"
    names = [e["name"] for e in pal]
    assert len(names) == len(set(names)), f"{where}: 색 이름이 중복됐다"
    ratios = [e["ratio"] for e in pal]
    assert ratios == sorted(ratios, reverse=True), f"{where}: 내림차순이 아니다"


def _show(pal: list[dict]) -> str:
    return "  ".join(f"{e['name']} {e['hex']} {e['ratio']:.1%}" for e in pal)


def selftest():
    ok = 0

    # ① 색 이름 분류 — 순수 함수라 영상 없이 돈다
    cases = [
        ((255, 0, 0), "빨강"), ((255, 140, 0), "주황"), ((255, 230, 0), "노랑"),
        ((0, 180, 60), "초록"), ((58, 123, 213), "파랑"), ((135, 206, 235), "파랑"),
        ((140, 60, 200), "보라"), ((255, 130, 190), "분홍"), ((120, 72, 30), "갈색"),
        ((10, 10, 12), "검정"), ((250, 250, 248), "흰색"), ((128, 128, 130), "회색"),
    ]
    for rgb, want in cases:
        got = classify_color(*rgb)
        assert got == want, f"classify_color{rgb} = {got!r}, 기대 {want!r}"
    for r in range(0, 256, 37):
        for g in range(0, 256, 37):
            for b in range(0, 256, 37):
                assert classify_color(r, g, b) in COLOR_NAMES, f"목록 밖: {(r, g, b)}"
    ok += 1
    print(f"[{ok}] 색 분류 {len(cases)}종 + 격자 전수 — 전부 11색 목록 안")

    # ② PPM 파싱 — 주석·복수 공백이 섞인 헤더
    w, h, px = _read_ppm(b"P6\n# ffmpeg\n2  1\n255\n\xff\x00\x00\x00\x00\xff")
    assert (w, h) == (2, 1) and len(px) == 6, "PPM 헤더 파싱이 틀렸다"
    ok += 1
    print(f"[{ok}] PPM 파싱 — 주석·복수 공백 헤더 통과")

    videos = {
        "타요1화": (Path.home() / "Downloads/타요1화.mp4", 276.5),
        "아기상어1화": (Path.home() / "Downloads/아기상어1화.mp4", 396.7),
    }
    missing = [n for n, (p, _) in videos.items() if not p.exists()]
    if missing:
        print(f"\n[건너뜀] 영상 없음: {', '.join(missing)} — 실영상 검사 생략")
        print(f"\n자체검사 {ok}/{ok} 통과 (실영상 검사 제외)")
        return

    out = {}
    for label, (path, t) in videos.items():
        print(f"\n{'=' * 74}\n{label}  t={t}  (구간 {t - 20.0:.1f}~{t:.1f}s)\n{'=' * 74}")
        frames = extract_evidence_frames(path, t)
        assert len(frames) == 4, f"{label}: 4장이 아니다"
        assert [f["id"] for f in frames] == ["f0001", "f0002", "f0003", "f0004"]
        assert frames[-1]["t"] == t, f"{label}: 마지막 장이 개입지점이 아니다"
        assert frames[0]["t"] == round(t - 20.0, 3), f"{label}: 첫 장 위치가 틀렸다"
        for f in frames:
            assert Path(f["path"]).exists(), f"{label}: 파일이 안 생겼다 {f['path']}"
            assert Path(f["path"]).stat().st_size > 1000, f"{label}: jpg가 너무 작다"
            print(f"  {f['id']}  t={f['t']:7.2f}s  {_show(palette(f['path']))}")
            print(f"          {f['path']}")

        # ratio 합 — 11색 전부 받으면 1.0이어야 한다 (분류가 픽셀을 흘리지 않는다)
        full = palette(frames[-1]["path"], k=len(COLOR_NAMES))
        _check_palette(full, f"{label} 전체")
        s = sum(e["ratio"] for e in full)
        assert abs(s - 1.0) < 0.005, f"{label}: ratio 합이 {s:.4f} — 픽셀이 새고 있다"
        top5 = palette(frames[-1]["path"], k=5)
        _check_palette(top5, f"{label} 상위5")
        assert sum(e["ratio"] for e in top5) <= 1.0 + 1e-9

        facts = frame_facts(frames)
        assert facts["colors"], f"{label}: 존재하는 색이 하나도 없다"
        bands = [set(facts["colors"]), set(facts["trace"]), set(facts["absent"])]
        assert set.union(*bands) == set(COLOR_NAMES), f"{label}: 11색을 다 안 나눴다"
        assert sum(len(b) for b in bands) == len(COLOR_NAMES), f"{label}: 갈래가 겹쳤다"
        shown = ", ".join(f"{c}({facts['ratios'][c]:.0%})" for c in facts["colors"])
        print(f"\n  존재: {shown}")
        print(f"  애매: {', '.join(facts['trace']) or '(없음)'}")
        print(f"  부재: {', '.join(facts['absent']) or '(없음)'}   지배: {facts['dominant']}")

        # 개입지점 그 장면만. span 20초는 컷을 넘나들어 다른 장면 색이 섞인다
        solo = frame_facts([frames[-1]])
        print(f"  └ t={t} 그 장면만 → 존재 {solo['colors']}  부재 {solo['absent']}")
        out[label] = (full, facts, solo)

    # ③ 타요 276.5 — 배경이 하늘이다. 파랑이 안 잡히면 팔레트가 화면을 못 보고 있다
    tayo_full, tayo_facts, tayo_solo = out["타요1화"]
    assert "파랑" in tayo_facts["colors"], "타요 276.5s: 하늘인데 파랑이 안 잡혔다"
    ok += 1
    print(f"\n[{ok}] 타요 276.5s — 파랑 검출 "
          f"(구간평균 {tayo_facts['ratios']['파랑']:.1%}, 최대 {tayo_facts['peak']['파랑']:.1%})")

    # ④ 아기상어 396.7 — 파란 바다에 노란 상어. 둘 다 상위에 와야 한다
    shark_full, shark_facts, shark_solo = out["아기상어1화"]
    top = [e["name"] for e in shark_full[:5]]
    assert "파랑" in top, f"아기상어 396.7s: 바다인데 파랑이 상위5에 없다 — {top}"
    assert "노랑" in top, f"아기상어 396.7s: 상어인데 노랑이 상위5에 없다 — {top}"
    ok += 1
    print(f"[{ok}] 아기상어 396.7s — 파랑·노랑 둘 다 상위5 {top}")

    # ⑤ 회귀 — 눈에 보이는 색을 "없다"고 단언하면 안 된다.
    # 3% 단일 문턱이던 시절 실제로 터졌던 오판 두 건을 그대로 박아 둔다.
    # 타요 차고: 빨간 버스가 화면의 1.5%. 3% 문턱에서 "빨강 없음" 으로 떨어졌었다
    assert "빨강" not in tayo_solo["absent"], (
        f"타요 276.5s: 빨간 버스가 화면에 있는데 부재로 단언했다 "
        f"(빨강 {tayo_solo['peak']['빨강']:.2%}) — 오답 보기로 나가면 틀린 퀴즈가 된다")
    # 아기상어: 보라 해초 2.0%, 주황 물고기 1.2%. 둘 다 3% 아래였다
    for nm, what in (("보라", "보라 해초"), ("주황", "주황 물고기")):
        assert nm not in shark_solo["absent"], (
            f"아기상어 396.7s: {what}가 화면에 있는데 부재로 단언했다 "
            f"({nm} {shark_solo['peak'][nm]:.2%})")
    # 반대편도 지킨다 — 부재 갈래가 비면 오답 보기를 못 만든다
    assert tayo_solo["absent"], "타요: 부재 색이 하나도 없으면 오답 보기를 못 만든다"
    ok += 1
    print(f"[{ok}] 오판 회귀 — 빨간버스(타요 {tayo_solo['peak']['빨강']:.2%})·"
          f"보라해초({shark_solo['peak']['보라']:.2%})·"
          f"주황물고기({shark_solo['peak']['주황']:.2%}) 전부 부재 단언 안 함")

    print(f"\n자체검사 {ok}/{ok} 통과")


if __name__ == "__main__":
    if len(sys.argv) > 2:                       # visual.py <video> <t> [span] [n]
        v, t = sys.argv[1], float(sys.argv[2])
        sp = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0
        nn = int(sys.argv[4]) if len(sys.argv) > 4 else 4
        fr = extract_evidence_frames(v, t, span=sp, n=nn)
        for f in fr:
            print(f"{f['id']}  t={f['t']:7.2f}s  {_show(palette(f['path']))}")
            print(f"        {f['path']}")
        ft = frame_facts(fr)
        print(f"\n존재: {ft['colors']}\n애매: {ft['trace']}\n부재: {ft['absent']}"
              f"\n지배: {ft['dominant']}")
        if not ft["absent"]:
            print("주의: 부재 색이 없다 — 이 구간으로는 색 오답 보기를 만들 수 없다")
    else:
        selftest()
