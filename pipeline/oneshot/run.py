"""CLI 오케스트레이터.

영상 하나가 실패해도 나머지는 계속 처리하고, 실패 목록은 failures.json에 남긴다.
활동 0개는 실패다 — 기존 파이프라인이 whale_princess를 활동 0개로 끝내고도
성공으로 기록한 전례가 있다.
"""

import argparse
import json
import subprocess
from pathlib import Path

import anthropic

from oneshot._reuse import parse_subtitle_file
from oneshot.generate import generate_activities
from oneshot.prompt import build_content_blocks, build_system_prompt
from oneshot.sample_frames import extract_frames
from oneshot.validate import validate

SUBTITLE_EXTENSIONS = (".srt", ".vtt")


def probe_duration(video_path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(
            f"{video_path}: 길이 probe 실패 (ffprobe 종료 코드 {exc.returncode}). "
            f"파일이 손상됐거나 영상 스트림이 없을 수 있음: {exc.stderr.strip()!r}"
        ) from exc

    raw = out.stdout.strip()
    try:
        return float(raw)
    except ValueError:
        raise RuntimeError(
            f"{video_path}: 길이 probe 실패 — ffprobe가 길이를 읽지 못함 (출력: {raw!r}). "
            "파일이 손상됐거나 영상 스트림이 없을 수 있음"
        ) from None


def discover_pairs(input_dir: str) -> list[tuple[str, str, str]]:
    directory = Path(input_dir)
    pairs = []
    for video_path in sorted(directory.glob("*.mp4")):
        for ext in SUBTITLE_EXTENSIONS:
            subtitle_path = directory / f"{video_path.stem}{ext}"
            if subtitle_path.exists():
                pairs.append((str(video_path), str(subtitle_path), video_path.stem))
                break
    return pairs


def discover_missing_subtitles(input_dir: str) -> list[str]:
    """자막 짝이 없어 discover_pairs에서 조용히 빠지는 영상들.
    이대로 두면 오타 하나로 영상이 사라진 채 배치가 '완료'로 보인다."""
    directory = Path(input_dir)
    missing = []
    for video_path in sorted(directory.glob("*.mp4")):
        if not any((directory / f"{video_path.stem}{ext}").exists() for ext in SUBTITLE_EXTENSIONS):
            missing.append(video_path.stem)
    return missing


def run_for_video(
    video_path: str,
    subtitle_path: str,
    video_id: str,
    *,
    client,
    output_dir: str,
    age_range: str,
    topic: str,
    target_count: int,
    frame_interval: float,
    frame_width: int,
    min_spacing_sec: float,
) -> dict:
    duration = probe_duration(video_path)
    subtitles = parse_subtitle_file(subtitle_path)
    print(f"[{video_id}] 길이 {duration:.1f}초, 자막 {len(subtitles)}줄")
    if not subtitles:
        raise RuntimeError(
            f"{video_id}: 자막을 0줄 파싱함 (파일: {subtitle_path}). "
            "자막 형식이 잘못됐거나 지원하지 않는 포맷일 수 있음 — 확인 필요"
        )

    frames_dir = str(Path(output_dir) / f"{video_id}_frames")
    frames = extract_frames(video_path, frames_dir, duration, frame_interval, frame_width)
    print(f"[{video_id}] 프레임 {len(frames.paths)}장 ({frames.interval_sec}초 간격)")
    if frames.interval_sec != frame_interval:
        print(f"[{video_id}] 이미지 개수 상한 때문에 간격을 {frame_interval}초 → {frames.interval_sec}초로 늘림")
    if not frames.paths:
        raise RuntimeError(
            f"{video_id}: 프레임을 0장 추출함 (영상: {video_path}). "
            "ffmpeg가 읽지 못하는 영상 스트림이거나 손상된 파일일 수 있음"
        )

    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_response_path = out_dir / f"{video_id}_raw_response.txt"

    meta = {"video_id": video_id, "duration_sec": duration, "topic": topic,
            "age_range": age_range, "target_count": target_count}
    raw = generate_activities(
        client,
        build_system_prompt(age_range),
        build_content_blocks(subtitles, frames, meta),
        on_raw_text=lambda text: raw_response_path.write_text(text, encoding="utf-8"),
    )
    print(f"[{video_id}] 모델이 활동 {len(raw)}개 생성")

    checked = validate(raw, age_range=age_range, duration_sec=duration,
                       subtitles=subtitles, min_spacing_sec=min_spacing_sec)
    for rejection in checked.rejections:
        print(f"[{video_id}] 버림: {rejection['reason']}")

    result = {
        "video_id": video_id,
        "source": {"video_file": video_path, "subtitle_file": subtitle_path},
        "frame_sampling": {
            "interval_sec": frames.interval_sec,
            "width": frames.width,
            "frame_count": len(frames.paths),
        },
        "activities": checked.activities,
        "rejections": checked.rejections,
    }

    (out_dir / f"{video_id}_activities.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if not checked.activities:
        raise RuntimeError(f"{video_id}: 활동 0개")

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="영상+자막에서 상호작용 활동을 한 번의 모델 호출로 생성")
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--age-range", required=True, choices=["3-4", "5-6", "7"])
    parser.add_argument("--topic", default="")
    parser.add_argument("--target-count", type=int, default=5)
    parser.add_argument("--frame-interval", type=float, default=5.0)
    parser.add_argument("--frame-width", type=int, default=1024)
    parser.add_argument("--min-spacing-sec", type=float, default=20.0)
    args = parser.parse_args()

    client = anthropic.Anthropic()
    failures = []

    for video_id in discover_missing_subtitles(args.input_dir):
        print(f"[{video_id}] 건너뜀: 짝이 되는 자막(.srt/.vtt)을 찾지 못함")
        failures.append({"video_id": video_id, "error": "자막 없음 (.srt/.vtt 파일을 찾지 못함)"})

    for video_path, subtitle_path, video_id in discover_pairs(args.input_dir):
        try:
            run_for_video(
                video_path, subtitle_path, video_id,
                client=client, output_dir=args.output_dir,
                age_range=args.age_range, topic=args.topic,
                target_count=args.target_count, frame_interval=args.frame_interval,
                frame_width=args.frame_width, min_spacing_sec=args.min_spacing_sec,
            )
            print(f"[{video_id}] 완료")
        except Exception as exc:  # 영상 하나가 실패해도 나머지는 계속
            print(f"[{video_id}] 실패: {type(exc).__name__}: {exc}")
            failures.append({"video_id": video_id, "error": f"{type(exc).__name__}: {exc}"})

    if failures:
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "failures.json").write_text(
            json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"실패 {len(failures)}건 → {out_dir / 'failures.json'}")


if __name__ == "__main__":
    main()
