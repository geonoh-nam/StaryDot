import subprocess
from unittest.mock import patch

import pytest

from oneshot.sample_frames import FrameSet, extract_frames, frame_timestamps, plan_interval


def _true_count(duration_sec: float, interval_sec: float) -> int:
    """ffmpeg가 실제로 내보내는 장수. t=0부터 시작하므로 duration/interval이 아니라
    floor(duration/interval) + 1이다 (frame_timestamps와 같은 산식)."""
    import math
    return math.floor(duration_sec / interval_sec) + 1


def test_요청_간격이_상한_안이면_그대로_쓴다():
    # 300초 / 5초 = 60장, 상한 100 이하
    assert plan_interval(300.0, 5.0, max_frames=100) == 5.0


def test_상한을_넘으면_간격을_늘린다():
    # 900초를 5초 간격으로 뽑으면 181장(floor(900/5)+1) → 상한 100 이하이려면
    # interval >= duration/(max_frames-1) = 900/99
    assert plan_interval(900.0, 5.0, max_frames=100) == 900.0 / 99


def test_늘린_간격으로_뽑으면_상한_이하다():
    interval = plan_interval(900.0, 5.0, max_frames=100)
    assert _true_count(900.0, interval) <= 100


def test_정확히_나누어떨어지는_길이도_상한을_넘지_않는다():
    # 500초를 5초 간격으로 뽑으면 t=0..500 까지 101장이 나온다(500/5=100 그대로 쓰면 초과).
    # 옛 산식 ceil(duration/max_frames)은 이 경계를 못 잡았다.
    interval = plan_interval(500.0, 5.0, max_frames=100)
    assert _true_count(500.0, interval) <= 100


def test_프레임_시각은_구간_시작이다():
    # ffmpeg fps 필터는 t=0부터 내보낸다 (showinfo 실측: pts_time 0, 5, 10)
    assert frame_timestamps(3, 5.0) == [0.0, 5.0, 10.0]


def test_추출_결과의_장수와_시각_개수가_같다(tmp_path):
    def fake_run(cmd, **kwargs):
        out_dir = tmp_path / "frames"
        out_dir.mkdir(exist_ok=True)
        for i in range(1, 4):
            (out_dir / f"{i:04d}.jpg").write_bytes(b"\xff\xd8\xff")
        return None

    with patch("oneshot.sample_frames.subprocess.run", side_effect=fake_run):
        result = extract_frames("v.mp4", str(tmp_path / "frames"), duration_sec=15.0)

    assert isinstance(result, FrameSet)
    assert len(result.paths) == len(result.timestamps) == 3
    assert result.timestamps == [0.0, 5.0, 10.0]
    assert result.interval_sec == 5.0
    assert result.width == 1024


def test_기존_출력_디렉터리의_이전_프레임은_지워진다(tmp_path):
    out_dir = tmp_path / "frames"
    out_dir.mkdir()
    (out_dir / "9999.jpg").write_bytes(b"\xff\xd8\xff")  # 이전 실행에서 남은 잔재

    def fake_run(cmd, **kwargs):
        for i in range(1, 3):
            (out_dir / f"{i:04d}.jpg").write_bytes(b"\xff\xd8\xff")
        return None

    with patch("oneshot.sample_frames.subprocess.run", side_effect=fake_run):
        result = extract_frames("v.mp4", str(out_dir), duration_sec=10.0)

    assert len(result.paths) == 2
    assert not (out_dir / "9999.jpg").exists()


def test_ffmpeg가_한_번만_호출된다(tmp_path):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        out_dir = tmp_path / "frames"
        out_dir.mkdir(exist_ok=True)
        (out_dir / "0001.jpg").write_bytes(b"\xff\xd8\xff")
        return None

    with patch("oneshot.sample_frames.subprocess.run", side_effect=fake_run):
        extract_frames("v.mp4", str(tmp_path / "frames"), duration_sec=5.0)

    assert len(calls) == 1


def test_ffmpeg_실패_사유가_예외_메시지에_남는다(tmp_path):
    def fake_run(cmd, **kwargs):
        raise subprocess.CalledProcessError(
            1, cmd, stderr=b"Unsupported codec"
        )

    with patch("oneshot.sample_frames.subprocess.run", side_effect=fake_run):
        with pytest.raises(RuntimeError, match="Unsupported codec"):
            extract_frames("v.mp4", str(tmp_path / "frames"), duration_sec=5.0)
