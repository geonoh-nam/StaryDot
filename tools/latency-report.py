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


def first_attempts(rows: list[dict]) -> list[dict]:
    """세션 안 같은 문항(activity_id)에 대한 재시도 행을 버리고 첫 시도만 남긴다.

    Break 화면은 오답이면 같은 문항을 다시 물을 수 있어 (session_id, activity_id) 가
    같은 행이 여러 개 생긴다. 재시도 행까지 그대로 세면 회차(N번째로 본 문항)가 밀리고,
    재시도로 맞춘 걸 '알았다'로 세어 정답률도 부풀어 버린다. 첫 시도만 남겨야
    회차 = 실제로 본 서로 다른 문항 수, 정답률 = 처음 봤을 때 안 정답률이 된다.
    """
    best: dict[tuple, dict] = {}
    for r in rows:
        key = (r["session_id"], r["activity_id"])
        if key not in best or r["created_at"] < best[key]["created_at"]:
            best[key] = r
    return list(best.values())


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
        "SELECT session_id, activity_id, result, latency_ms, created_at FROM activity_result "
        "WHERE latency_ms IS NOT NULL"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def _selftest() -> None:
    rows = [
        # 세션 A: 1번째 느리고 맞음, 2번째 빠르고 틀림
        {"session_id": 1, "activity_id": 10, "created_at": 100, "latency_ms": 8000, "result": "correct"},
        {"session_id": 1, "activity_id": 11, "created_at": 200, "latency_ms": 900, "result": "wrong"},
        # 세션 B: 같은 패턴
        {"session_id": 2, "activity_id": 10, "created_at": 150, "latency_ms": 6000, "result": "correct"},
        {"session_id": 2, "activity_id": 11, "created_at": 250, "latency_ms": 700, "result": "wrong"},
    ]
    b = buckets(first_attempts(rows))
    assert [t for t, *_ in b] == [1, 2], b
    assert b[0][2] > b[1][2], "회차가 갈수록 지연이 줄어야 이 표본에서 맞다"
    assert b[0][3] == 1.0 and b[1][3] == 0.0, b
    # 세션이 섞여도 회차 배정이 세션별로 독립이어야 한다
    assert b[0][1] == 2 and b[1][1] == 2, b
    # 한 세션만 있어도 안 깨진다
    assert len(buckets(first_attempts(rows[:1]))) == 1

    # 재시도: 세션 1이 문항 11 을 처음엔 틀리고(200ms 시점) 재시도로 맞춘다(220ms 시점).
    # DB 에는 두 행이 남지만 회차 수·정답률은 첫 시도 기준으로 그대로여야 한다.
    retry_rows = rows + [
        {"session_id": 1, "activity_id": 11, "created_at": 220, "latency_ms": 500, "result": "correct"},
    ]
    rb = buckets(first_attempts(retry_rows))
    assert [t for t, *_ in rb] == [1, 2], rb
    assert rb[1][1] == 2, "재시도 행이 회차 건수를 부풀리면 안 된다"
    assert rb[1][3] == 0.0, "재시도로 맞췄어도 정답률은 첫 시도(오답) 기준이어야 한다"
    print("지연 리포트 자체검사 통과")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        _selftest()
        sys.exit(0)
    rows = first_attempts(load(Path(args[0]).expanduser()))
    if not rows:
        print("latency_ms 가 기록된 응답이 아직 없다.")
        sys.exit(0)
    print(f"{'회차':>4}{'건수':>6}{'지연중앙값':>12}{'정답률':>8}")
    for turn, n, med, acc in buckets(rows):
        print(f"{turn:>4}{n:>6}{med/1000:>10.1f}s{acc*100:>7.0f}%")
