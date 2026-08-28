#!/usr/bin/env python3
"""사건 트랙이 있는 전편 스캔.

scan.py 를 임포트해 깔때기와 서사 트랙만 사건 기준으로 덮어쓴다.

    python3 scan_ev.py ~/Downloads/test_videos/타요1화.mp4
"""
import json
import sys
import unicodedata as ud
from pathlib import Path

import scan


def scan_ev(video: Path) -> dict:
    """scan.scan 을 돌리고 eplan 의 사건을 얹는다."""
    r = scan.scan(video)
    key = ud.normalize("NFC", video.stem)
    ep = next((p for p in scan.WORK.glob("*_ev_plan.json")
               if ud.normalize("NFC", p.stem) == key + "_ev_plan"), None)
    if ep is None:
        sys.exit(f"work/{key}_ev_plan.json 이 없다. events.py 를 먼저 돌려라.")
    e = json.loads(ep.read_text())
    r["plan"]["events"] = e.get("events", [])
    r["plan"]["interrupts"] = e.get("interrupts", [])
    return r


def funnel(r: dict):
    """scan.funnel 의 네 번째 단계를 act 경계에서 사건으로 바꾼다."""
    rows = scan.funnel(r)
    rows[3] = ("+ 사건이 있음", len(r["plan"].get("events", [])),
               "LLM 추출 + 게이트 통과")
    return rows


# 저장할 원본 scan.funnel 참조 (svg() 내에서 임시로 교체할 때 사용).
_original_scan_funnel = None


def _make_funnel_wrapper(r: dict) -> list[tuple[str, int, str]]:
    """원본 scan.funnel 을 호출하고 행 3 을 사건으로 바꾼다."""
    rows = _original_scan_funnel(r)
    rows[3] = ("+ 사건이 있음", len(r["plan"].get("events", [])),
               "LLM 추출 + 게이트 통과")
    return rows


def svg(r: dict) -> str:
    """scan.svg 를 일시적으로 funnel 을 오버라이드하고 호출한 후 사건 눈금을 얹는다."""
    global _original_scan_funnel
    # scan.svg 가 호출할 funnel 을 임시로 교체해 행 3 을 사건으로 바꾼다.
    _original_scan_funnel = scan.funnel
    try:
        scan.funnel = _make_funnel_wrapper
        base = scan.svg(r)
    finally:
        scan.funnel = _original_scan_funnel

    dur = r["dur"]
    used = {it.get("event_id") for it in r["plan"].get("interrupts", [])}
    marks = []
    y = scan.TOP
    for ev in r["plan"].get("events", []):
        xx = scan._x(ev["t"], dur)
        on = ev["id"] in used
        marks.append(f'<line x1="{xx:.1f}" y1="{y}" x2="{xx:.1f}" '
                     f'y2="{y + scan.TRACK_H}" '
                     f'stroke="{"#0B6E77" if on else "#A9B4B6"}" '
                     f'stroke-width="{3 if on else 1.5}"/>')
        marks.append(f'<text x="{xx + 3:.1f}" y="{y + 11}" font-size="8.5" '
                     f'fill="#3D474A">{scan._esc(ev["kind"])}</text>')
    return base.replace("</svg>", "\n".join(marks) + "\n</svg>")


if __name__ == "__main__":
    for v in [a for a in sys.argv[1:] if not a.startswith("-")]:
        r = scan_ev(Path(v).expanduser())
        out = scan.WORK / f"{r['key']}_escan.svg"
        out.write_text(svg(r), encoding="utf-8")
        print(f"\n{'='*66}\n{r['key']}   {scan.mmss(r['dur'])}")
        prev = None
        for label, n, note in funnel(r):
            drop = "" if prev is None else f"  ({n/prev*100:>5.1f}%)"
            print(f"  {n:>5}  {label:<26}{drop:>10}   {note}")
            prev = n if n else prev
        print(f"  → {out}")
