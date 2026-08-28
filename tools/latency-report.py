#!/usr/bin/env python3
"""응답 지연 분포 — 개입이 광고처럼 학습되고 있는지 본다.

    python3 tools/latency-report.py backend/server/data/stary.db

세션 안 몇 번째 문항이냐(회차)별로 지연 중앙값과 정답률을 낸다.
지연이 짧아지면서 정답률이 같이 떨어지면 아이가 "빨리 누르면 넘어간다"를
학습한 것이다 — 심사 피드백 F 의 가설을 이 표로 확인하거나 반증한다.
"""
import sqlite3
import sys
from pathlib import Path


def buckets(rows: list[dict]) -> list[tuple[int, int, float, float]]:
    """(회차, 건수, 지연 중앙값 ms, 정답률). 회차는 세션 안 문항 순서."""
    by_turn: dict[int, list[dict]] = {}
    seen: dict[object, int] = {}
    for r in sorted(rows, key=lambda x: x["created_at"]):
        s = r["session_id"]
        seen[s] = seen.get(s, 0) + 1
        by_turn.setdefault(seen[s], []).append(r)
    out = []
    for turn in sorted(by_turn):
        g = by_turn[turn]
        lat = sorted(x["latency_ms"] for x in g)
        med = lat[len(lat) // 2] if lat else 0.0
        acc = sum(1 for x in g if x["result"] == "correct") / len(g)
        out.append((turn, len(g), float(med), acc))
    return out


def load(db_path: Path) -> list[dict]:
    """latency_ms 가 기록된 행만 읽는다. 옛 행은 NULL 이라 건너뛴다."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT session_id, result, latency_ms, created_at FROM activity_result "
        "WHERE latency_ms IS NOT NULL"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def _selftest() -> None:
    rows = [
        # 세션 A: 1번째 느리고 맞음, 2번째 빠르고 틀림
        {"session_id": 1, "created_at": 100, "latency_ms": 8000, "result": "correct"},
        {"session_id": 1, "created_at": 200, "latency_ms": 900, "result": "wrong"},
        # 세션 B: 같은 패턴
        {"session_id": 2, "created_at": 150, "latency_ms": 6000, "result": "correct"},
        {"session_id": 2, "created_at": 250, "latency_ms": 700, "result": "wrong"},
    ]
    b = buckets(rows)
    assert [t for t, *_ in b] == [1, 2], b
    assert b[0][2] > b[1][2], "회차가 갈수록 지연이 줄어야 이 표본에서 맞다"
    assert b[0][3] == 1.0 and b[1][3] == 0.0, b
    # 세션이 섞여도 회차 배정이 세션별로 독립이어야 한다
    assert b[0][1] == 2 and b[1][1] == 2, b
    # 한 세션만 있어도 안 깨진다
    assert len(buckets(rows[:1])) == 1
    print("지연 리포트 자체검사 통과")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        _selftest()
        sys.exit(0)
    rows = load(Path(args[0]).expanduser())
    if not rows:
        print("latency_ms 가 기록된 응답이 아직 없다.")
        sys.exit(0)
    print(f"{'회차':>4}{'건수':>6}{'지연중앙값':>12}{'정답률':>8}")
    for turn, n, med, acc in buckets(rows):
        print(f"{turn:>4}{n:>6}{med/1000:>10.1f}s{acc*100:>7.0f}%")
