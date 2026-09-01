import json
from unittest.mock import patch

import pytest

from oneshot._reuse import SubtitleSegment
from oneshot.prep import find_subtitle, format_timestamp, prepare, render_subtitles
from oneshot.sample_frames import FrameSet

SRT = "1\n00:00:10,000 --> 00:00:12,000\n안녕\n\n2\n00:00:20,000 --> 00:00:22,000\n반가워\n"


def _sample(tmp_path):
    (tmp_path / "v.mp4").write_bytes(b"\x00")
    (tmp_path / "v.srt").write_text(SRT, encoding="utf-8")
    return tmp_path


def test_같은_이름의_자막을_찾는다(tmp_path):
    _sample(tmp_path)
    assert find_subtitle(str(tmp_path / "v.mp4")) == str(tmp_path / "v.srt")


def test_자막이_없으면_예외(tmp_path):
    (tmp_path / "solo.mp4").write_bytes(b"\x00")
    with pytest.raises(RuntimeError, match="자막을 찾지 못함"):
        find_subtitle(str(tmp_path / "solo.mp4"))


def test_자막을_프레임과_같은_시각_형식으로_편다():
    subs = [SubtitleSegment(text="안녕", start_sec=5.0, end_sec=7.0),
            SubtitleSegment(text="반가워", start_sec=65.0, end_sec=67.0)]
    assert render_subtitles(subs) == "[00:05] 안녕\n[01:05] 반가워"


def _prepare(tmp_path, frame_count=2):
    frames_dir = tmp_path / "work" / "frames"
    frames_dir.mkdir(parents=True)
    paths = []
    for i in range(1, frame_count + 1):
        p = frames_dir / f"{i:04d}.jpg"
        p.write_bytes(b"\xff\xd8\xff\xe0")
        paths.append(str(p))
    fs = FrameSet(paths=paths, timestamps=[i * 5.0 for i in range(frame_count)],
                  interval_sec=5.0, width=1024)

    with patch("oneshot.prep.probe_duration", return_value=300.0), \
         patch("oneshot.prep.extract_frames", return_value=fs):
        return prepare(
            str(tmp_path / "v.mp4"), str(tmp_path / "work"),
            age_range="5-6", target_count=5, frame_interval=5.0,
            frame_width=1024, topic="동물",
        )


def test_작업_폴더에_자막과_메타가_남는다(tmp_path):
    _sample(tmp_path)
    meta = _prepare(tmp_path)

    assert (tmp_path / "work" / "subtitles.md").read_text(encoding="utf-8") == "[00:10] 안녕\n[00:20] 반가워"
    saved = json.loads((tmp_path / "work" / "meta.json").read_text(encoding="utf-8"))
    assert saved["video_id"] == "v"
    assert saved["frame_sampling"] == {"interval_sec": 5.0, "width": 1024,
                                       "frame_count": 2, "crop_bottom_ratio": 0.0}
    assert meta["subtitle_line_count"] == 2


def test_프레임마다_경로와_라벨이_짝지어_남는다(tmp_path):
    _sample(tmp_path)
    meta = _prepare(tmp_path, frame_count=3)

    assert [f["label"] for f in meta["frames"]] == ["[00:00]", "[00:05]", "[00:10]"]
    assert [f["timestamp_sec"] for f in meta["frames"]] == [0.0, 5.0, 10.0]
    assert all(f["path"].endswith(".jpg") for f in meta["frames"])


def test_자막이_0줄이면_프레임을_뽑기_전에_실패한다(tmp_path):
    (tmp_path / "v.mp4").write_bytes(b"\x00")
    (tmp_path / "v.srt").write_text("", encoding="utf-8")

    with patch("oneshot.prep.probe_duration", return_value=300.0), \
         patch("oneshot.prep.extract_frames") as extract:
        with pytest.raises(RuntimeError, match="자막이 0줄"):
            prepare(str(tmp_path / "v.mp4"), str(tmp_path / "work"),
                    age_range="5-6", target_count=5, frame_interval=5.0,
                    frame_width=1024, topic="")
    extract.assert_not_called()


def test_프레임이_0장이면_실패한다(tmp_path):
    _sample(tmp_path)
    empty = FrameSet(paths=[], timestamps=[], interval_sec=5.0, width=1024)

    with patch("oneshot.prep.probe_duration", return_value=300.0), \
         patch("oneshot.prep.extract_frames", return_value=empty):
        with pytest.raises(RuntimeError, match="프레임이 0장"):
            prepare(str(tmp_path / "v.mp4"), str(tmp_path / "work"),
                    age_range="5-6", target_count=5, frame_interval=5.0,
                    frame_width=1024, topic="")


def test_시각_형식은_프롬프트_모듈과_같다():
    assert format_timestamp(0.0) == "00:00"
    assert format_timestamp(205.0) == "03:25"
