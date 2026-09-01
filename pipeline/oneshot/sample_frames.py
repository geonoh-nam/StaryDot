"""ffmpeg 단일 패스로 영상 전체의 프레임을 뽑는다.

pipeline/frame_sampler.py 는 지점 하나마다 ffmpeg를 아홉 번 재실행해 가장 선명한 프레임을
고른다. 지점이 다섯이면 합리적이지만 백 장을 뽑을 땐 구백 번 프로세스 기동이 된다.
배치 추출은 단일 패스가 맞다.
"""

import subprocess
from dataclasses import dataclass
from pathlib import Path

from oneshot.limits import MAX_IMAGES_PER_REQUEST


@dataclass
class FrameSet:
    paths: list[str]
    timestamps: list[float]
    interval_sec: float
    width: int
    crop_bottom_ratio: float = 0.0


def plan_interval(
    duration_sec: float,
    requested_interval: float,
    max_frames: int = MAX_IMAGES_PER_REQUEST,
) -> float:
    """요청한 간격으로 뽑았을 때 장수가 상한을 넘으면 간격을 늘려 상한 안으로 맞춘다.
    영상을 쪼개 여러 번 호출하지 않는다 — 영상 전체를 한 맥락에서 보는 것이 이 설계의 전부다.

    ffmpeg는 t=0부터 프레임을 내보내므로 실제 장수는 duration/interval이 아니라
    floor(duration/interval) + 1이다(프레임_시각과 같은 산식). 이 장수가 상한 이하이려면
    interval >= duration / (max_frames - 1)이어야 한다."""
    if duration_sec <= 0 or max_frames <= 1:
        return requested_interval
    minimum = duration_sec / (max_frames - 1)
    return float(max(requested_interval, minimum))


def frame_timestamps(count: int, interval_sec: float) -> list[float]:
    """n번째 프레임의 시각. ffmpeg fps 필터는 t=0부터 리샘플링한다 (showinfo 실측: 0, 5, 10…)."""
    return [n * interval_sec for n in range(count)]


def build_filter(interval_sec: float, width: int, crop_bottom_ratio: float) -> str:
    """ffmpeg -vf 필터 문자열. crop이 scale보다 먼저 와야 비율 계산이 원본 기준이 된다."""
    parts = [f"fps=1/{interval_sec}"]
    if crop_bottom_ratio > 0:
        # 하단을 잘라 화면에 구워진 자막을 없앤다. 자막이 픽셀에 박혀 있으면
        # 관찰자를 자막에서 격리한다는 이 파이프라인의 전제가 무너진다 —
        # tinyping 실측에서 프레임 하단에 "고고핑을 생각하는 빤 짝"이 박혀 있었다.
        parts.append(f"crop=iw:ih*{1 - crop_bottom_ratio:.4f}:0:0")
    parts.append(f"scale={width}:-2")
    return ",".join(parts)


def extract_frames(
    video_path: str,
    output_dir: str,
    duration_sec: float,
    interval_sec: float = 5.0,
    width: int = 1024,
    crop_bottom_ratio: float = 0.0,
) -> FrameSet:
    effective = plan_interval(duration_sec, interval_sec)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 이전 실행에서 남은 프레임이 있으면 장수·시각이 이번 결과와 뒤섞이므로 먼저 지운다.
    for stale in out_dir.glob("*.jpg"):
        stale.unlink()

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", build_filter(effective, width, crop_bottom_ratio),
        "-q:v", "3",
        str(out_dir / "%04d.jpg"),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        raise RuntimeError(
            f"{video_path}: 프레임 추출 실패 (ffmpeg 종료 코드 {exc.returncode}). "
            f"코덱을 지원하지 않거나 파일이 손상됐을 수 있음: {stderr.strip()!r}"
        ) from exc

    paths = sorted(str(p) for p in out_dir.glob("*.jpg"))
    return FrameSet(
        paths=paths,
        timestamps=frame_timestamps(len(paths), effective),
        interval_sec=effective,
        width=width,
        crop_bottom_ratio=crop_bottom_ratio,
    )
