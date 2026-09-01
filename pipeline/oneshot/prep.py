"""에이전트 경로 1단계: 영상과 자막을 서브에이전트가 읽을 수 있는 작업 폴더로 편다.

API를 부르지 않는다. 프레임을 뽑고 자막을 시각 라벨이 붙은 텍스트로 펴서 파일로 남길 뿐이다.
이후 관찰·지점·출제·검수 네 역할은 이 폴더만 보고 일한다.
"""

import argparse
import json
from pathlib import Path

from oneshot._reuse import parse_subtitle_file
from oneshot.run import SUBTITLE_EXTENSIONS, probe_duration
from oneshot.sample_frames import extract_frames


def format_timestamp(sec: float) -> str:
    total = int(sec)
    return f"{total // 60:02d}:{total % 60:02d}"


def find_subtitle(video_path: str) -> str:
    """영상과 같은 이름의 자막을 찾는다. 없으면 예외 — 조용히 넘어가면 자막 0줄로 진행된다."""
    video = Path(video_path)
    for ext in SUBTITLE_EXTENSIONS:
        candidate = video.with_suffix(ext)
        if candidate.exists():
            return str(candidate)
    raise RuntimeError(
        f"{video_path}: 자막을 찾지 못함 "
        f"(같은 이름의 {' 또는 '.join(SUBTITLE_EXTENSIONS)} 파일이 있어야 함)"
    )


def render_subtitles(subtitles) -> str:
    """프레임 라벨과 같은 [MM:SS] 형식으로 편다. 두 축이 같은 형식이라야 대조된다."""
    lines = [f"[{format_timestamp(s.start_sec)}] {s.text}" for s in subtitles]
    return "\n".join(lines)


def prepare(
    video_path: str,
    out_dir: str,
    *,
    age_range: str,
    target_count: int,
    frame_interval: float,
    frame_width: int,
    topic: str,
    crop_bottom_ratio: float = 0.0,
    subtitle_path: str | None = None,
) -> dict:
    subtitle_path = subtitle_path or find_subtitle(video_path)
    video_id = Path(video_path).stem

    duration = probe_duration(video_path)
    subtitles = parse_subtitle_file(subtitle_path)
    if not subtitles:
        raise RuntimeError(
            f"{video_id}: 자막이 0줄 — 형식이 다르거나 손상됐을 수 있음 ({subtitle_path})"
        )

    work = Path(out_dir)
    work.mkdir(parents=True, exist_ok=True)

    frames = extract_frames(video_path, str(work / "frames"), duration, frame_interval, frame_width, crop_bottom_ratio)
    if not frames.paths:
        raise RuntimeError(f"{video_id}: 프레임이 0장 — ffmpeg가 영상 스트림을 읽지 못함")

    (work / "subtitles.md").write_text(render_subtitles(subtitles), encoding="utf-8")

    meta = {
        "video_id": video_id,
        "source": {"video_file": video_path, "subtitle_file": subtitle_path},
        "duration_sec": duration,
        "age_range": age_range,
        "topic": topic,
        "target_count": target_count,
        "subtitle_line_count": len(subtitles),
        "frame_sampling": {
            "interval_sec": frames.interval_sec,
            "width": frames.width,
            "frame_count": len(frames.paths),
            "crop_bottom_ratio": frames.crop_bottom_ratio,
        },
        "frames": [
            {"path": path, "label": f"[{format_timestamp(ts)}]", "timestamp_sec": ts}
            for path, ts in zip(frames.paths, frames.timestamps)
        ],
    }
    (work / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description="에이전트가 읽을 작업 폴더를 만든다 (API 호출 없음)")
    parser.add_argument("--video", required=True)
    parser.add_argument("--subtitle", default=None, help="생략하면 영상과 같은 이름으로 찾는다")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--age-range", required=True, choices=["3-4", "5-6", "7"])
    parser.add_argument("--topic", default="")
    parser.add_argument("--target-count", type=int, default=5)
    parser.add_argument("--frame-interval", type=float, default=5.0)
    parser.add_argument("--frame-width", type=int, default=1024)
    parser.add_argument("--crop-bottom", type=float, default=0.0,
                        help="프레임 하단을 잘라낼 비율(0~0.5). 영상에 자막이 구워져 있을 때 쓴다")
    args = parser.parse_args()

    meta = prepare(
        args.video, args.out_dir,
        age_range=args.age_range, target_count=args.target_count,
        frame_interval=args.frame_interval, frame_width=args.frame_width,
        topic=args.topic, subtitle_path=args.subtitle,
        crop_bottom_ratio=args.crop_bottom,
    )
    sampling = meta["frame_sampling"]
    print(f"[{meta['video_id']}] 길이 {meta['duration_sec']:.1f}초, 자막 {meta['subtitle_line_count']}줄")
    print(f"[{meta['video_id']}] 프레임 {sampling['frame_count']}장 ({sampling['interval_sec']}초 간격, {sampling['width']}px)")
    if sampling["interval_sec"] != args.frame_interval:
        print(f"[{meta['video_id']}] 이미지 개수 상한 때문에 간격을 {args.frame_interval}초 → {sampling['interval_sec']}초로 늘림")
    print(f"[{meta['video_id']}] 작업 폴더 준비됨: {args.out_dir}")


if __name__ == "__main__":
    main()
