#!/usr/bin/env python3
"""전편 개입 가능성 스캔 — 세 축을 시간축에 깔고 눈으로 보게 한다.

    python3 scan.py ~/Downloads/test_videos/타요1화.mp4
      → work/<작품>_scan.svg  +  콘솔 깔때기

storydot.py 가 낸 work/<작품>_plan.json 을 읽는다. ASR 을 다시 안 돌린다.
영상은 화면 변화량 1패스만 더 뜬다 (10분 1편 약 7초).

이 파일은 판정을 **바꾸지 않는다.** 파이프라인이 이미 쓰는 값을 같은 임계로
전 구간에 펼쳐 보여줄 뿐이다. 그림과 파이프라인이 어긋나면 그림이 틀린 것이다.
"""
import json
import sys
import unicodedata as ud
from pathlib import Path

import motion

ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"

# 개입 방식 — 필요한 여유가 큰 것부터. 여유가 이만큼 있으면 이 방식이 된다.
MODES = [
    ("fade",   3.0, "#2C6E52", "페이드아웃"),
    ("duck",   1.0, "#B8860B", "오디오 덕킹"),
    ("freeze", 0.0, "#3F6880", "컷 직후 정지"),
]
BLOCKED = "#B23A2F"
STEP = 0.5              # 판정 격자. 사람이 볼 그림이라 0.5초면 충분하다.


def mmss(t: float) -> str:
    return f"{int(t) // 60}:{t % 60:04.1f}"


def head_at(t: float, starts: list[float], end: float) -> float:
    """t 에서 다음 발화가 시작할 때까지 남은 시간."""
    return min((s for s in starts if s >= t), default=end) - t


def mode_at(head: float, post_cut: bool) -> tuple[str, str] | None:
    for name, need, color, _ in MODES:
        if head < need:
            continue
        if name == "freeze" and not post_cut:
            return None     # 컷 직후가 아니면 얼려도 어색하다
        return name, color
    return None


def scan(video: Path) -> dict:
    key = ud.normalize("NFC", video.stem)
    plan_path = next((p for p in WORK.glob("*_plan.json")
                      if ud.normalize("NFC", p.stem) == key + "_plan"), None)
    if plan_path is None:
        sys.exit(f"work/{key}_plan.json 이 없다. storydot.py 를 먼저 돌려라.")
    plan = json.loads(plan_path.read_text())
    dur, end = plan["duration"], plan["end"]

    frames = motion._gray_frames(video, 0.0, dur, motion.PROF_W, motion.PROF_H, fps=6)
    prof = []
    for i in range(1, len(frames)):
        prev, (ts, cur) = frames[i - 1][1], frames[i]
        if len(cur) == len(prev) and cur:
            prof.append((ts, sum(abs(a - b) for a, b in zip(cur, prev)) / len(cur)))
    cls = motion.classify(prof)

    starts = sorted(s["t0"] for s in plan["canonical"])
    acts = plan["acts"]
    diff_at = {round(ts / STEP): d for ts, d in prof}

    grid = []
    for k in range(int(dur / STEP)):
        t = k * STEP
        d = diff_at.get(k)
        if d is None:
            continue
        head = head_at(t, starts, end)
        post_cut = any(0.0 <= t - c <= motion.POST_CUT_SEC for c in cls["cuts"])
        still = d < motion.QUIET
        m = mode_at(head, post_cut) if still else None
        grid.append({"t": t, "diff": d, "head": head, "still": still,
                     "post_cut": post_cut, "mode": m[0] if m else None,
                     "color": m[1] if m else BLOCKED})
    return {"plan": plan, "prof": prof, "cls": cls, "grid": grid,
            "acts": acts, "key": key, "dur": dur, "end": end}


# ── 깔때기 ──────────────────────────────────────────────────────────────────
def funnel(r: dict) -> list[tuple[str, int, str]]:
    g = r["grid"]
    still = [x for x in g if x["still"]]
    openable = [x for x in still if x["mode"]]
    fade = [x for x in openable if x["mode"] == "fade"]
    return [
        ("영상 전체", len(g), f"{STEP}초 격자"),
        ("화면이 앉음", len(still), f"변화량 < {motion.QUIET}"),
        ("+ 개입 방식이 있음", len(openable),
         f"페이드 {len(fade)} · 덕킹 {len([x for x in openable if x['mode']=='duck'])}"
         f" · 정지 {len([x for x in openable if x['mode']=='freeze'])}"),
        ("+ 이야기가 끝남 (act 경계)", len(r["acts"]), "서사 게이트"),
        ("최종 채택", len(r["plan"]["interrupts"]), "증거·간격까지 통과"),
    ]


# ── SVG ─────────────────────────────────────────────────────────────────────
W, LEFT, RIGHT = 1600, 96, 24
TRACK_H, GAP, TOP = 54, 16, 44


def _x(t: float, dur: float) -> float:
    return LEFT + (W - LEFT - RIGHT) * t / dur


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def svg(r: dict) -> str:
    dur, g, acts = r["dur"], r["grid"], r["acts"]
    plan = r["plan"]
    rows = ["서사 · 이야기가 끝났나", "시각 · 화면이 앉았나",
            "청각 · 소리가 비었나", "판정 · 개입 방식"]
    ys = [TOP + i * (TRACK_H + GAP) for i in range(len(rows))]
    H = ys[-1] + TRACK_H + 40 + 19 * 5 + 34
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'font-family="IBM Plex Sans KR, Apple SD Gothic Neo, sans-serif">',
         f'<rect width="{W}" height="{H}" fill="#FCFCFA"/>',
         f'<text x="{LEFT}" y="26" font-size="19" font-weight="700" fill="#171C1E">'
         f'{_esc(r["key"])} — 개입 가능성 전편 스캔</text>',
         f'<text x="{W-RIGHT}" y="26" font-size="13" fill="#6E7A7C" text-anchor="end">'
         f'{mmss(dur)}  ·  격자 {STEP}s  ·  정지 임계 {motion.QUIET}</text>']

    for y, lab in zip(ys, rows):
        o.append(f'<text x="{LEFT-10}" y="{y+TRACK_H/2+4}" font-size="11.5" '
                 f'fill="#3D474A" text-anchor="end">{_esc(lab)}</text>')
        o.append(f'<rect x="{LEFT}" y="{y}" width="{W-LEFT-RIGHT}" height="{TRACK_H}" '
                 f'fill="#F1F1EC"/>')

    # 1 서사 — act 블록, 경계에 눈금
    for i, a in enumerate(acts):
        x0, x1 = _x(a["t0"], dur), _x(min(a["t1"], dur), dur)
        o.append(f'<rect x="{x0:.1f}" y="{ys[0]}" width="{max(1,x1-x0):.1f}" '
                 f'height="{TRACK_H}" fill="{"#DDE4E5" if i%2 else "#E9EDEE"}"/>')
        o.append(f'<line x1="{x1:.1f}" y1="{ys[0]}" x2="{x1:.1f}" '
                 f'y2="{ys[0]+TRACK_H}" stroke="#0B6E77" stroke-width="2"/>')
    o.append(f'<line x1="{_x(r["end"],dur):.1f}" y1="{ys[0]}" '
             f'x2="{_x(r["end"],dur):.1f}" y2="{ys[0]+TRACK_H}" '
             f'stroke="#B23A2F" stroke-width="2" stroke-dasharray="3 3"/>')

    # 2 시각 — 변화량 면적 + 정지 임계선
    cap = 40.0
    pts = [f'{_x(x["t"],dur):.1f},{ys[1]+TRACK_H-TRACK_H*min(x["diff"],cap)/cap:.1f}'
           for x in g]
    o.append(f'<polygon points="{_x(0,dur):.1f},{ys[1]+TRACK_H} '
             f'{" ".join(pts)} {_x(dur,dur):.1f},{ys[1]+TRACK_H}" fill="#8FA9AD"/>')
    for x in g:                                   # 임계 아래 = 화면이 앉은 자리
        if x["still"]:
            o.append(f'<rect x="{_x(x["t"],dur):.2f}" y="{ys[1]+TRACK_H-6}" '
                     f'width="1.6" height="6" fill="#0B6E77"/>')
    qy = ys[1] + TRACK_H - TRACK_H * motion.QUIET / cap
    o.append(f'<line x1="{LEFT}" y1="{qy:.1f}" x2="{W-RIGHT}" y2="{qy:.1f}" '
             f'stroke="#B23A2F" stroke-width="1" stroke-dasharray="4 3"/>')

    # 3 청각 — 여유를 0~5초로 잘라 막대. 대사 중이면 바닥.
    for x in g:
        h = TRACK_H * min(x["head"], 5.0) / 5.0
        c = "#2C6E52" if x["head"] >= 3 else ("#B8860B" if x["head"] >= 1 else "#D8B4AE")
        o.append(f'<rect x="{_x(x["t"],dur):.2f}" y="{ys[2]+TRACK_H-h:.1f}" '
                 f'width="1.3" height="{h:.1f}" fill="{c}"/>')

    # 4 판정 — 개입 가능한 격자만 방식 색으로
    for x in g:
        if x["mode"]:
            o.append(f'<rect x="{_x(x["t"],dur):.2f}" y="{ys[3]}" width="1.6" '
                     f'height="{TRACK_H}" fill="{x["color"]}"/>')

    # 채택 지점 — 전 트랙 관통
    for it in plan["interrupts"]:
        xx = _x(it["t"], dur)
        o.append(f'<line x1="{xx:.1f}" y1="{ys[0]}" x2="{xx:.1f}" '
                 f'y2="{ys[3]+TRACK_H}" stroke="#171C1E" stroke-width="1.5"/>')
        o.append(f'<text x="{xx:.1f}" y="{ys[0]-6}" font-size="11.5" font-weight="700" '
                 f'fill="#171C1E" text-anchor="middle">★ {mmss(it["t"])}'
                 f'  {it.get("score")}</text>')

    # 시간축
    step = 60 if dur <= 900 else 120
    for s in range(0, int(dur) + 1, step):
        o.append(f'<text x="{_x(s,dur):.1f}" y="{ys[3]+TRACK_H+16}" font-size="10.5" fill="#6E7A7C" '
                 f'text-anchor="middle">{s//60}:00</text>')

    # 깔때기 — 이 그림의 결론. 개입 가능한 자리는 널렸고 서사가 병목이다.
    fy = ys[3] + TRACK_H + 40
    steps = funnel(r)
    top = steps[0][1]
    fw = W - LEFT - RIGHT
    for i, (label, n, note) in enumerate(steps):
        bw = max(2.0, fw * n / top)
        yy = fy + i * 19
        o.append(f'<rect x="{LEFT}" y="{yy}" width="{bw:.1f}" height="13" '
                 f'fill="{"#B23A2F" if i == len(steps)-2 else "#0B6E77"}" '
                 f'opacity="{0.30 + 0.14*i:.2f}"/>')
        o.append(f'<text x="{LEFT-10}" y="{yy+10.5}" font-size="11" fill="#3D474A" '
                 f'text-anchor="end">{_esc(label)}</text>')
        inside = LEFT + bw + 8 > W - RIGHT - 120       # 막대가 길면 숫자를 안에 넣는다
        tx = LEFT + bw - 8 if inside else LEFT + bw + 8
        o.append(f'<text x="{tx:.1f}" y="{yy+10.5}" font-size="11" '
                 f'text-anchor="{"end" if inside else "start"}" '
                 f'font-weight="600" fill="{"#FCFCFA" if inside else "#171C1E"}">{n}'
                 f'<tspan font-weight="400" '
                 f'fill="{"#FCFCFA" if inside else "#6E7A7C"}">  {_esc(note)}</tspan></text>')

    lx = LEFT
    for name, _need, color, label in MODES:
        o.append(f'<rect x="{lx}" y="{H-16}" width="11" height="11" fill="{color}"/>')
        o.append(f'<text x="{lx+16}" y="{H-6.5}" font-size="11" fill="#3D474A">'
                 f'{_esc(label)}</text>')
        lx += 26 + len(label) * 12
    o.append('</svg>')
    return "\n".join(o)


if __name__ == "__main__":
    for v in [a for a in sys.argv[1:] if not a.startswith("-")]:
        r = scan(Path(v).expanduser())
        out = WORK / f"{r['key']}_scan.svg"
        out.write_text(svg(r), encoding="utf-8")
        print(f"\n{'='*66}\n{r['key']}   {mmss(r['dur'])}")
        prev = None
        for label, n, note in funnel(r):
            drop = "" if prev is None else f"  ({n/prev*100:>5.1f}%)"
            print(f"  {n:>5}  {label:<26}{drop:>10}   {note}")
            prev = n if n else prev
        print(f"  → {out}")
