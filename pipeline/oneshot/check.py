"""에이전트 경로 마지막 단계: 에이전트가 만든 활동에 결정론적 가드를 건다.

에이전트 경로도 API 경로와 같은 검산을 받는다. 사람이 바뀌든 모델이 바뀌든
카탈로그 위반·정답 누락·지점 부적절은 코드가 잡는다.
"""

import argparse
import json
from pathlib import Path

from oneshot._reuse import parse_subtitle_file
from oneshot.validate import validate


def load_activities(path: str) -> list[dict]:
    """활동 배열을 읽는다. 최상위가 배열이든 {"activities": [...]}든 받는다 —
    에이전트가 둘 중 무엇으로 쓸지 확실치 않다."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("activities")
    if not isinstance(raw, list):
        raise RuntimeError(
            f"{path}: 활동 배열을 찾지 못함 — 최상위가 배열이거나 activities 키를 가진 객체여야 함"
        )
    return raw


def check(activities_path: str, meta_path: str, out_path: str, min_spacing_sec: float) -> dict:
    meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
    activities = load_activities(activities_path)
    subtitles = parse_subtitle_file(meta["source"]["subtitle_file"])

    checked = validate(
        activities,
        age_range=meta["age_range"],
        duration_sec=meta["duration_sec"],
        subtitles=subtitles,
        min_spacing_sec=min_spacing_sec,
    )

    result = {
        "video_id": meta["video_id"],
        "source": meta["source"],
        "frame_sampling": meta["frame_sampling"],
        "produced_by": "agents",
        "activities": checked.activities,
        "rejections": checked.rejections,
    }

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="에이전트가 만든 활동에 결정론적 가드를 건다")
    parser.add_argument("--activities", required=True, help="에이전트가 쓴 활동 JSON")
    parser.add_argument("--meta", required=True, help="prep이 만든 meta.json")
    parser.add_argument("--out", required=True)
    parser.add_argument("--min-spacing-sec", type=float, default=20.0)
    args = parser.parse_args()

    result = check(args.activities, args.meta, args.out, args.min_spacing_sec)
    kept, dropped = len(result["activities"]), len(result["rejections"])
    print(f"[{result['video_id']}] 통과 {kept}개, 버림 {dropped}개")
    for rejection in result["rejections"]:
        ts = rejection["activity"].get("timestamp_sec")
        print(f"  버림 ({ts}초): {rejection['reason']}")
    print(f"[{result['video_id']}] 저장됨: {args.out}")

    if not result["activities"]:
        raise SystemExit(f"{result['video_id']}: 활동 0개 — 통과한 활동이 없다")


if __name__ == "__main__":
    main()
