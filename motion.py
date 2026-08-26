"""화면 움직임을 '컷'과 '실제 동작'으로 갈라 보는 모듈.

기존 storydot.motion_profile() 은 프레임 간 평균절대차 하나만 보고 값이 크면
버렸다. 실측에서 두 가지가 깨졌다.

  결함 1 — 컷과 동작을 구분 못 한다.
      장면 전환은 **한 프레임에서만** 값이 튀고 곧바로 가라앉는다. 그 직후는
      새 샷이 시작된 정지 구간이라 오히려 멈추기 **가장 좋은** 자리다.
      반대로 카메라 팬·캐릭터 달리기는 값이 **여러 프레임에 걸쳐 지속**되고
      멈추기 나쁘다. 둘 다 "움직임 큼"으로 버리면 좋은 자리까지 같이 버린다.
      실측: 타요1화 t=276.5 가 37.0 으로 찍혀 버려졌는데, 창 안을 열어 보면
      273.7 에 컷(62.0, 이웃 0.1/0.5)이 있고 그 뒤 273.8~275.8 이 2.2초 동안
      0.3~0.8 로 죽어 있다. 버릴 게 아니라 1.2초 앞으로 당겼어야 했다.

  결함 2 — 샷 크기를 못 본다.
      뽀로로1화 t=455.9 는 바늘이 이불을 꿰매는 익스트림 클로즈업이다.
      바늘이 느려서 평균절대차가 3~6 밖에 안 나오고 임계 6.0 미만이라
      "정지"로 통과한다. 수치는 조용한데 서사적으로는 동작 한복판이다.
      화면 **전체가 움직이지 않아도** 화면 **전체가 하나의 대상**이면
      멈추기 나쁘다. 그래서 움직임과 별개로 샷 크기를 따로 재야 한다.

외부 패키지를 쓰지 않는다. ffmpeg 로 작은 회색 pgm 을 뽑아 순수 파이썬으로 센다.

임계값은 전부 아래 6개 실측 지점에서 뽑았다. 근거는 각 상수 옆에 적어 둔다.
`python3 motion.py` 로 그 6개 지점을 다시 재고 표로 찍는다.
"""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

# ── 프레임 격자 ──────────────────────────────────────────────────────────────
# 움직임은 32x18 로 충분하다 (기존 motion_profile 과 같은 격자라 0~255 평균절대차
# 스케일이 그대로 호환된다). 반면 샷 크기는 '디테일이 얼마나 촘촘한가'를 보는
# 것이라 격자가 거칠면 클로즈업과 와이드가 같이 뭉개진다. 그래서 따로 128x72.
PROF_W, PROF_H = 32, 18
SCALE_W, SCALE_H = 128, 72

# ── 컷 판정 ─────────────────────────────────────────────────────────────────
# 실측 6개 창에서 확인된 컷의 평균절대차 최솟값은 44.1 (타요 557.7),
# 지속 동작 고원의 최댓값은 35.4 (티니핑 608.6). 그 사이를 40 으로 끊는다.
CUT_ABS = 40.0
# 절댓값만으로는 부족하다 — 빠른 장면에서는 동작만으로도 40 을 넘긴다.
# 컷은 '한 프레임짜리'라는 게 본질이므로 이웃 대비 배수를 같이 본다.
# 실측 컷의 이웃 대비 배수 최솟값 2.47 (티니핑 160.4: 49.0 vs 19.8),
# 지속 동작 고원의 배수 최댓값 1.6 (타요 558.5: 24.5 vs 15.0). 사이를 2.0 으로.
CUT_RATIO = 2.0

# ── 지속 동작 판정 ───────────────────────────────────────────────────────────
# 기존 파이프라인이 쓰던 '정지' 임계 6.0 을 그대로 승계한다. 이 값 자체는
# 결함 2에서 보듯 단독으로는 못 믿지만, '여러 프레임 연속'이라는 조건이
# 붙으면 신호가 된다 — 지속이 곧 팬·달리기의 정의다.
SUSTAIN_MIN = 6.0
# 0.6초. 6fps 기준 4프레임. 실측에서 티니핑 162.7 / 605.3 은 창 전체가 잡히고,
# 타요 557.5 의 순간적 움직임(558.3~558.7, 0.5초)은 걸리지 않는 경계다.
SUSTAIN_SEC = 0.6

# ── 정지 판정 ───────────────────────────────────────────────────────────────
# 눈으로 확인한 정지 구간 안에서 관측된 최댓값이 2.5 (티니핑 605.8~607.3 꼬리).
# 바느질 클로즈업(뽀로로 455.9~458.2)은 1.9~5.8, 중앙값 약 4.0.
# 둘 사이를 3.0 으로 끊는다. 여유가 넉넉하지 않다는 걸 알고 쓴다 —
# 바느질 같은 '조용한 동작'의 진짜 방어선은 이 값이 아니라 shot_scale() 이다.
QUIET = 3.0

# 컷 가산점이 0 으로 떨어지는 시각. 새 샷이 눈에 앉고 나면 컷은 더 이상 정보가
# 아니다. 가산점은 이 값까지 **선형으로 줄어든다**. 계단으로 주면 안 되는 이유는
# 실측에서 나왔다 — 뽀로로 661.4 의 최적 후보가 컷에서 정확히 1.50초 떨어진
# 자리라 계단 방식에서는 가산점을 만점으로 받고 "post-cut" 으로 뒤집혔다.
# 1.49초와 1.51초가 다른 판정을 받는 건 근거가 아니라 사고다.
POST_CUT_SEC = 1.5
# 가산점이 실질적으로 남아 있을 때만 "post-cut" 이라고 부른다 (컷에서 0.75초 이내).
# 라벨과 점수가 같은 근거를 쓰도록 묶어 두는 장치다.
POST_CUT_LABEL = 0.5

# ── best_pause 점수 가중치 (합 1.0) ──────────────────────────────────────────
# 컷 직후 정지가 최고점이 되도록 W_CUT 을 얹되, 요청 시각에서 멀어지면
# W_PROX 가 그걸 눌러야 한다. 안 그러면 창 맨 끝의 컷 직후 지점이
# 요청 시각 바로 옆의 멀쩡한 정지 구간을 이긴다 (실측: 타요 557.5 에서
# 553.7 컷 직후가 557.0 을 이기는 현상). W_PROX > W_CUT 이 그 방어선이다.
W_QUIET, W_RUN, W_TAIL, W_PROX, W_CUT = 0.30, 0.10, 0.10, 0.35, 0.15

# ── 샷 크기 판정 ────────────────────────────────────────────────────────────
# 128x72 회색 격자에서 인접 픽셀 최대차의 평균(= 거친 총변동, tv).
# 클로즈업은 큰 균일 영역이 화면을 지배해 tv 가 낮고, 와이드는 나무·건물·군중
# 같은 고주파가 많아 tv 가 높다. 실측(단일 프레임, 128x72):
#     뽀로로 455.9 바느질 익스트림 클로즈업   tv= 4.4  flat=0.71
#     타요   558.0 손·천 클로즈업             tv= 6.4  flat=0.56
#     아기상어 396.0 클로즈업                 tv= 8.5  flat=0.57
#     ──────────────────── 경계 ────────────────────
#     티니핑 439.0                            tv=12.8  flat=0.28
#     타요   557.5 구조차 3대                 tv=12.9  flat=0.38
#     브레드 300.0                            tv=14.6  flat=0.29
#     티니핑 162.7 / 605.3                    tv=14.7 / 14.2
#     타요   276.5 차고 와이드                 tv=15.9  flat=0.34
#     타요   114.0                            tv=16.9  flat=0.34
#     뽀로로 661.4 눈 덮인 집 와이드           tv=25.5  flat=0.29
# 클로즈업 무리는 8.5 에서 끝나고 나머지는 12.8 에서 시작한다 → 10.0 으로 끊는다.
# 와이드는 14.0 부터. 그 사이(10~14)는 미디엄.
SCALE_CLOSEUP_TV = 10.0
SCALE_WIDE_TV = 14.0
# 균일 영역 비율(인접 최대차 <= 2 인 픽셀 비율)을 보조 축으로 둔다.
# 클로즈업 0.56~0.72 vs 나머지 0.20~0.43. tv 가 애매할 때만 개입시킨다.
SCALE_FLAT_HI = 0.55
FLAT_EPS = 2


# ── 프레임 추출 ─────────────────────────────────────────────────────────────
def _gray_frames(video: Path, start: float, dur: float, w: int, h: int,
                 fps: float | None = None) -> list[tuple[float, bytes]]:
    """[start, start+dur) 구간의 회색 프레임을 (절대시각, 픽셀바이트)로 돌려준다.

    시각을 `start + i/fps` 로 **계산하지 않고** ffmpeg 의 showinfo 가 찍은
    pts_time 을 읽어 쓴다. `-ss` 를 `-i` 앞에 두는 빠른 탐색은 요청한 지점에
    정확히 안 떨어질 수 있고, fps 필터가 프레임을 고를 때 한 프레임씩 밀리기도
    한다. 검증 중에 같은 시각을 두 방식으로 뽑았더니 **다른 샷**이 나온 적이
    있어서(타요 557.5 — 구조차 vs 손 클로즈업) 계산 대신 ffmpeg 이 말한 값을
    그대로 받는다. 파싱이 실패하면 옛 방식으로 되돌린다.
    """
    vf = []
    if fps:
        vf.append(f"fps={fps}")
    vf += [f"scale={w}:{h}", "format=gray", "showinfo"]
    start = max(0.0, start)
    with tempfile.TemporaryDirectory() as td:
        p = subprocess.run(
            ["ffmpeg", "-hide_banner", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}",
             "-i", str(video), "-vf", ",".join(vf),
             "-f", "image2", f"{td}/f%04d.pgm", "-y"],
            capture_output=True, text=True)
        files = sorted(Path(td).glob("f*.pgm"))
        if not files:
            raise RuntimeError(f"프레임을 못 뽑았다: {video} @{start:.2f}\n{p.stderr[-400:]}")
        stamps = [float(x) for x in re.findall(r"pts_time:([0-9.]+)", p.stderr)]
        out = []
        for i, f in enumerate(files):
            if i < len(stamps):
                ts = start + stamps[i]
            else:                                   # showinfo 를 못 읽은 경우
                ts = start + (i / fps if fps else 0.0)
            # pgm 헤더는 "P5\n{w} {h}\n255\n" — 개행 3개 뒤가 픽셀이다
            out.append((ts, f.read_bytes().split(b"\n", 3)[-1]))
    return out


def profile(video: Path, t: float, span: float = 4.0,
            fps: int = 6) -> list[tuple[float, float]]:
    """[t-span, t+span] 구간의 프레임 간 변화량 시계열. (시각, 0~255 평균절대차).

    각 값은 **뒤쪽 프레임의 시각**에 매단다. "이 시각의 화면은 직전 프레임과
    이만큼 다르다"는 뜻이다.
    """
    lo = max(0.0, t - span)
    frames = _gray_frames(Path(video), lo, span * 2, PROF_W, PROF_H, fps=fps)
    prof: list[tuple[float, float]] = []
    for i in range(1, len(frames)):
        prev, (ts, cur) = frames[i - 1][1], frames[i]
        if len(cur) != len(prev) or not cur:
            continue
        prof.append((ts, sum(abs(a - b) for a, b in zip(cur, prev)) / len(cur)))
    return prof


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    if not n:
        return 0.0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


# ── 시계열 해석 ─────────────────────────────────────────────────────────────
def classify(prof: list[tuple[float, float]]) -> dict:
    """시계열을 컷 / 지속 동작 / 정지 구간으로 가른다.

    반환
      cuts       — 컷으로 본 시각 목록
      sustained  — 실제 동작·팬으로 본 (시작, 끝) 구간 목록
      quiet      — 멈춰도 되는 (시작, 끝) 구간 목록
      step       — 프레임 간격(초). prof 에서 역산한다.
    """
    if len(prof) < 2:
        return {"cuts": [], "sustained": [], "quiet": [], "step": 0.0}

    ts = [p[0] for p in prof]
    ds = [p[1] for p in prof]
    n = len(ds)
    step = _median([ts[i] - ts[i - 1] for i in range(1, n)]) or 1 / 6

    # 컷 — 한 프레임에서만 크게 튀고 곧바로 낮아진다.
    # 이웃을 max() 로 보는 게 핵심이다. 지속 동작이 시작되는 첫 프레임은
    # 직전(정지) 대비 배수가 크지만 직후(동작)가 비슷하게 높아서 걸러진다.
    is_cut = [False] * n
    for i, d in enumerate(ds):
        nb = [ds[j] for j in (i - 1, i + 1) if 0 <= j < n]
        if nb and d >= CUT_ABS and d >= CUT_RATIO * max(nb):
            is_cut[i] = True
    cuts = [ts[i] for i in range(n) if is_cut[i]]

    # 지속 동작 — SUSTAIN_MIN 이상이 SUSTAIN_SEC 이상 이어진다.
    # 컷 프레임은 '높다'로도 '낮다'로도 치지 않고 **투명하게 건너뛴다**.
    # 빠른 장면 한복판의 컷이 하나의 동작 구간을 둘로 쪼개면 각 조각이
    # 길이 미달로 탈락해 버린다 (실측: 티니핑 162.5 의 81.8).
    high = [ds[i] >= SUSTAIN_MIN and not is_cut[i] for i in range(n)]
    sustained: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if not high[i]:
            i += 1
            continue
        j, last = i, i
        while j < n and (high[j] or is_cut[j]):
            if high[j]:
                last = j
            j += 1
        if ts[last] - ts[i] + step >= SUSTAIN_SEC:
            sustained.append((ts[i], ts[last]))
        i = j

    # 정지 — QUIET 이하가 이어지는 구간. 컷은 값이 커서 자연히 경계가 된다.
    quiet: list[tuple[float, float]] = []
    i = 0
    while i < n:
        if ds[i] > QUIET:
            i += 1
            continue
        j = i
        while j + 1 < n and ds[j + 1] <= QUIET:
            j += 1
        quiet.append((ts[i], ts[j]))
        i = j + 1

    return {"cuts": cuts, "sustained": sustained, "quiet": quiet, "step": step}


# ── 멈출 자리 고르기 ────────────────────────────────────────────────────────
def best_pause(video: Path, t: float, span: float = 4.0) -> dict:
    """t 근처에서 활동을 제안해도 아이가 잘렸다고 느끼지 않을 시각을 고른다.

    반환 {"t", "score" 0~1, "why", "kind": "still"|"post-cut"|"none"}.

    정지 구간 안의 **모든 프레임**을 후보로 놓고 점수를 매겨 최댓값을 고른다.
    구간 하나를 먼저 고르고 그 안에서 대표를 뽑는 방식은, 컷 직후 가산점과
    요청 시각 근접도가 서로 다른 구간을 가리킬 때 답이 이상해진다.
    """
    prof = profile(video, t, span)
    if not prof:
        return {"t": t, "score": 0.0, "why": "프레임을 못 읽었다", "kind": "none"}

    c = classify(prof)
    ts = [p[0] for p in prof]
    ds = [p[1] for p in prof]

    if not c["quiet"]:
        i = min(range(len(ds)), key=lambda k: ds[k])
        # 정지 구간이 아예 없으면 0 에 가깝게 준다. 다만 완전한 0 으로 깔면
        # 여러 후보를 서로 비교할 수 없어서, 최소 변화량으로 미세한 순위만 남긴다.
        score = 0.15 * max(0.0, 1.0 - ds[i] / SUSTAIN_MIN)
        return {
            "t": round(ts[i], 2), "score": round(score, 3), "kind": "none",
            "why": f"{span * 2:.0f}초 창 전체가 동작 중이다 "
                   f"(최소 변화량 {ds[i]:.1f} > 정지 임계 {QUIET}). 멈출 자리가 없다",
        }

    best = None
    for lo, hi in c["quiet"]:
        idx = [k for k in range(len(ts)) if lo <= ts[k] <= hi]
        run_len = hi - lo + c["step"]
        for k in idx:
            near = [ds[j] for j in idx if abs(ts[j] - ts[k]) <= 0.35]
            local = sum(near) / len(near)
            q = max(0.0, 1.0 - local / QUIET)          # 얼마나 조용한가
            r = min(1.0, run_len / 1.5)                # 그 조용함이 얼마나 버티는가
            # 구간 **끝**까지 남은 여유만 본다. 끝은 동작이 다시 시작되는 지점이라
            # 거기서 멈추면 0.2초 뒤에 화면이 튄다. 반대로 구간 시작 쪽은
            # 컷 직후인 경우가 많아 오히려 좋은 자리다.
            tail = min(1.0, (hi - ts[k]) / 0.5)
            prox = max(0.0, 1.0 - abs(ts[k] - t) / span)
            # 직전 컷까지의 거리. 가까울수록 크고 POST_CUT_SEC 에서 0 이 된다.
            lead = [ts[k] - x for x in c["cuts"] if 0.0 <= ts[k] - x <= POST_CUT_SEC]
            gap = min(lead) if lead else None
            cut_b = 0.0 if gap is None else max(0.0, 1.0 - gap / POST_CUT_SEC)
            score = (W_QUIET * q + W_RUN * r + W_TAIL * tail
                     + W_PROX * prox + W_CUT * cut_b)
            if best is None or score > best[0]:
                best = (score, ts[k], local, run_len, hi - ts[k], gap, cut_b)

    score, ts_best, local, run_len, tail_gap, gap, cut_b = best
    if cut_b >= POST_CUT_LABEL:
        kind = "post-cut"
        why = (f"컷({ts_best - gap:.1f}s) 직후 {gap:.1f}초, "
               f"{run_len:.1f}초짜리 정지 구간. 평균 변화량 {local:.1f} — "
               f"새 샷이 시작되고 화면이 앉은 자리다")
    else:
        kind = "still"
        why = (f"{run_len:.1f}초짜리 정지 구간, 평균 변화량 {local:.1f}. "
               f"정지가 {tail_gap:.1f}초 더 간다")
    if abs(ts_best - t) >= 0.3:
        why += f" (요청 {t:.1f}s 에서 {ts_best - t:+.1f}초 옮김)"
    return {"t": round(ts_best, 2), "score": round(score, 3), "why": why, "kind": kind}


# ── 샷 크기 ─────────────────────────────────────────────────────────────────
def _detail(px: bytes, w: int, h: int) -> tuple[float, float]:
    """(총변동 평균, 균일 픽셀 비율). 인접 픽셀 최대차를 엣지 세기로 쓴다."""
    tv = 0
    flat = 0
    n = w * h
    for y in range(h):
        row = y * w
        nxt = row + w
        for x in range(w):
            g = 0
            if x + 1 < w:
                g = abs(px[row + x] - px[row + x + 1])
            if y + 1 < h:
                g = max(g, abs(px[row + x] - px[nxt + x]))
            tv += g
            if g <= FLAT_EPS:
                flat += 1
    return tv / n, flat / n


def shot_scale(video: Path, t: float) -> str:
    """t 시점의 샷 크기를 근사한다. "closeup" | "medium" | "wide".

    엣지 검출을 따로 돌리지 않고 다운스케일한 회색 격자에서 인접 픽셀 차이를
    직접 더한다 (ffmpeg edgedetect 는 임계 튜닝이 하나 더 늘 뿐 정보량이 같다).

    t 를 **가운데 둔** ±0.15초 창의 프레임을 전부 재서 **중앙값**을 쓴다.
    한 장만 재면 모션블러 낀 프레임 하나에 판정이 끌려가고, 중앙값은 창의
    과반이 요청한 샷 안에 있어야만 맞는다.

    가운데 두는 게 핵심이다. 실측: 타요 557.5(구조차 와이드, tv 12.9)는
    0.14초 뒤에 컷이 있어서 다음 샷이 손 클로즈업(tv 6.4)이다.
        [t, t+0.3] 앞으로만  → 10프레임 중 5개가 컷 너머 → "closeup" (오판)
        [t-0.15, t+0.15]     →  9프레임 중 1개만 컷 너머 → "medium" (정답)
    창이 넓어질수록 근처 컷이 과반을 가져갈 위험이 커지므로 좁게 잡는다.
    """
    return scale_of(*scale_stats(video, t))


def scale_stats(video: Path, t: float) -> tuple[float, float]:
    """shot_scale() 이 보는 원수치 (tv, flat). 임계 재조정·디버깅용."""
    frames = _gray_frames(Path(video), t - 0.15, 0.30, SCALE_W, SCALE_H)
    stats = [_detail(px, SCALE_W, SCALE_H) for _, px in frames]
    return _median([s[0] for s in stats]), _median([s[1] for s in stats])


def scale_of(tv: float, flat: float) -> str:
    """원수치 → 라벨. shot_scale() 과 판정 기준을 한 군데로 묶어 둔다."""
    if tv < SCALE_CLOSEUP_TV or flat >= SCALE_FLAT_HI:
        return "closeup"
    if tv >= SCALE_WIDE_TV:
        return "wide"
    return "medium"


# ── 자체검사 ────────────────────────────────────────────────────────────────
# 눈으로 확인한 6개 지점. shots/ 에 같은 시각의 캡처가 있다.
CASES = [
    ("타요1화", 276.5, "차고 와이드 — 273.7에 컷, 276.0부터 카메라 틸트"),
    ("뽀로로1화", 455.9, "바느질 익스트림 클로즈업 — 느려서 수치는 조용함"),
    ("티니핑1화", 162.7, "캐릭터 점프 + 배경 흐름"),
    ("티니핑1화", 605.3, "기차 주행 모션블러"),
    ("타요1화", 557.5, "구조차 3대 정지"),
    ("뽀로로1화", 661.4, "눈 덮인 집 와이드 정지"),
]


def _covers(spans: list[tuple[float, float]], t: float, slack: float = 0.35) -> bool:
    return any(lo - slack <= t <= hi + slack for lo, hi in spans)


def _selftest() -> None:
    src = Path.home() / "Downloads"
    rows = []
    for name, t, note in CASES:
        video = src / f"{name}.mp4"
        prof = profile(video, t)
        c = classify(prof)
        bp = best_pause(video, t)
        tv, flat = scale_stats(video, t)
        sc = scale_of(tv, flat)
        assert sc == shot_scale(video, t), "scale_of 와 shot_scale 이 갈렸다"
        here = min((d for ts, d in prof if abs(ts - t) < 0.2), default=float("nan"))
        rows.append((name, t, note, prof, c, bp, sc, tv, flat, here))

    w = "─" * 118
    print(f"\n{w}\n  motion.py 자체검사 — 눈으로 확인한 6개 지점\n{w}")
    print(f"{'영상':<9}{'t':>7}  {'옛값':>5} {'컷':>3} {'지속':>4} {'정지':>4}  "
          f"{'best_pause':>10} {'점수':>5} {'kind':<9} {'샷':<8}{'tv':>6}{'flat':>6}")
    print(f"{'':<9}{'':>7}  {'-' * 100}")
    for name, t, note, prof, c, bp, sc, tv, flat, here in rows:
        print(f"{name:<9}{t:>7.1f}  {here:>5.1f} {len(c['cuts']):>3} "
              f"{len(c['sustained']):>4} {len(c['quiet']):>4}  "
              f"{bp['t']:>10.2f} {bp['score']:>5.2f} {bp['kind']:<9} "
              f"{sc:<8}{tv:>6.1f}{flat:>6.2f}")
        print(f"{'':<9}{'':>7}  └ {note}")
        print(f"{'':<9}{'':>7}    컷 {[round(x, 1) for x in c['cuts']]}  "
              f"지속 {[(round(a, 1), round(b, 1)) for a, b in c['sustained']]}")
        print(f"{'':<9}{'':>7}    {bp['why']}")
    print(w)

    R = {(n, t): r for r in rows for n, t in [(r[0], r[1])]}

    # 1) 타요 276.5 — 컷이 잡히고, 멈출 자리가 좋은 점수로 나온다
    r = R[("타요1화", 276.5)]
    assert r[4]["cuts"], "타요 276.5: 컷을 못 찾았다 (273.7에 62.0 스파이크가 있다)"
    assert r[5]["kind"] in ("post-cut", "still"), f"타요 276.5: kind={r[5]['kind']}"
    assert r[5]["score"] >= 0.6, f"타요 276.5: 점수 {r[5]['score']} 가 낮다"
    # 옛 코드가 '움직임 큼'으로 버린 자리다. 새 코드는 버리는 대신 옮겨야 한다.
    assert r[9] > SUSTAIN_MIN, "타요 276.5: 옛 지표는 여기서 높게 나와야 정상"

    # 2) 뽀로로 455.9 — 수치는 조용하지만 익스트림 클로즈업
    r = R[("뽀로로1화", 455.9)]
    assert r[6] == "closeup", f"뽀로로 455.9: shot_scale={r[6]} (closeup 이어야)"
    assert r[9] < SUSTAIN_MIN, "뽀로로 455.9: 옛 지표는 임계 미만이라 통과했었다"

    # 3) 티니핑 162.7 — 지속 동작, 멈출 자리 없음
    r = R[("티니핑1화", 162.7)]
    assert _covers(r[4]["sustained"], 162.7), "티니핑 162.7: 지속 동작을 못 잡았다"
    assert r[5]["score"] <= 0.3, f"티니핑 162.7: 점수 {r[5]['score']} 가 높다"

    # 4) 티니핑 605.3 — 지속 동작
    r = R[("티니핑1화", 605.3)]
    assert _covers(r[4]["sustained"], 605.3), "티니핑 605.3: 지속 동작을 못 잡았다"

    # 5) 타요 557.5 — 정지, 높은 점수
    r = R[("타요1화", 557.5)]
    assert r[5]["kind"] == "still", f"타요 557.5: kind={r[5]['kind']} (still 이어야)"
    assert r[5]["score"] >= 0.7, f"타요 557.5: 점수 {r[5]['score']} 가 낮다"
    assert not _covers(r[4]["sustained"], 557.5), "타요 557.5: 지속 동작이 잡히면 안 된다"

    # 6) 뽀로로 661.4 — 멈춰도 되는 자리, 와이드
    #
    # 기대값을 still 하나로 박았다가 틀렸다. 이 지점 앞 657.7s 에 컷이 있어서
    # 실제 분류는 post-cut 이다. 그런데 post-cut 은 still 보다 나쁜 게 아니라
    # "새 샷이 시작되고 화면이 앉은 자리" 라 오히려 멈추기 좋은 곳이다.
    # 검사해야 할 것은 라벨이 아니라 "멈출 자리를 찾았는가" 다.
    r = R[("뽀로로1화", 661.4)]
    assert r[5]["kind"] in ("still", "post-cut"), \
        f"뽀로로 661.4: kind={r[5]['kind']} (멈출 자리를 못 찾았다)"
    assert r[5]["score"] >= 0.7, f"뽀로로 661.4: 점수 {r[5]['score']} 가 낮다"
    assert r[6] == "wide", f"뽀로로 661.4: shot_scale={r[6]} (wide 여야)"

    # 7) 컷 직후 정지가 최고점이라는 설계가 실제로 성립하는지.
    #    티니핑 605.6 에 컷이 있고 그 뒤 1.5초가 죽어 있다 — 여기가 만점권이어야 한다.
    r = R[("티니핑1화", 605.3)]
    post = best_pause(src / "티니핑1화.mp4", 606.2)
    assert post["kind"] == "post-cut", f"컷 직후 검출 실패: {post}"
    assert post["score"] >= 0.85, f"컷 직후가 최고점이 아니다: {post['score']}"
    print(f"  컷 직후 확인 — 티니핑 606.2 → t={post['t']} score={post['score']} "
          f"kind={post['kind']}")

    print("\n  ✅ 자체검사 7건 전부 통과\n")


if __name__ == "__main__":
    _selftest()
