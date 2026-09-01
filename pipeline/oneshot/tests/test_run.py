import json
import subprocess
from unittest.mock import patch

import pytest

from oneshot.run import discover_missing_subtitles, discover_pairs, main, probe_duration, run_for_video

ACTIVITIES = [{"timestamp_sec": 30.0, "activity_template": "감정_추론", "question": "q",
               "options": ["a", "b", "c"], "answer": "a", "why_here": "w",
               "scene_description": "s"}]

SRT = "1\n00:00:10,000 --> 00:00:12,000\n안녕\n"


def _setup(tmp_path):
    (tmp_path / "v.mp4").write_bytes(b"\x00")
    (tmp_path / "v.srt").write_text(SRT, encoding="utf-8")
    return tmp_path


def test_영상과_자막_쌍을_찾는다(tmp_path):
    _setup(tmp_path)
    pairs = discover_pairs(str(tmp_path))
    assert len(pairs) == 1
    assert pairs[0][2] == "v"


def test_자막이_없으면_쌍에서_빠진다(tmp_path):
    (tmp_path / "solo.mp4").write_bytes(b"\x00")
    assert discover_pairs(str(tmp_path)) == []


def test_ffprobe로_길이를_구한다():
    with patch("oneshot.run.subprocess.run") as run:
        run.return_value.stdout = "123.45\n"
        assert probe_duration("v.mp4") == 123.45


def _run(tmp_path, activities):
    from oneshot.sample_frames import FrameSet
    frame = tmp_path / "0001.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xe0")
    fs = FrameSet(paths=[str(frame)], timestamps=[0.0], interval_sec=5.0, width=1024)

    with patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities", return_value=activities):
        return run_for_video(
            str(tmp_path / "v.mp4"), str(tmp_path / "v.srt"), "v",
            client=None, output_dir=str(tmp_path / "out"), age_range="5-6",
            topic="동물", target_count=5, frame_interval=5.0,
            frame_width=1024, min_spacing_sec=20.0,
        )


def test_출력_계약을_지킨다(tmp_path):
    _setup(tmp_path)
    result = _run(tmp_path, ACTIVITIES)
    assert result["video_id"] == "v"
    assert result["frame_sampling"] == {"interval_sec": 5.0, "width": 1024, "frame_count": 1}
    assert len(result["activities"]) == 1
    assert result["rejections"] == []


def test_결과가_파일로_저장된다(tmp_path):
    _setup(tmp_path)
    _run(tmp_path, ACTIVITIES)
    saved = json.loads((tmp_path / "out" / "v_activities.json").read_text(encoding="utf-8"))
    assert saved["video_id"] == "v"


def test_활동이_0개면_실패로_본다(tmp_path):
    _setup(tmp_path)
    with pytest.raises(RuntimeError, match="활동 0개"):
        _run(tmp_path, [])


def test_전부_가드에_걸려도_실패로_본다(tmp_path):
    _setup(tmp_path)
    bad = [dict(ACTIVITIES[0], answer="없는답")]
    with pytest.raises(RuntimeError, match="활동 0개"):
        _run(tmp_path, bad)


def test_ffprobe가_길이를_못_구하면_probe_실패로_알린다():
    with patch("oneshot.run.subprocess.run") as run:
        run.return_value.stdout = "N/A\n"
        with pytest.raises(RuntimeError, match="길이 probe 실패"):
            probe_duration("broken.mp4")


def test_ffprobe가_비정상_종료하면_probe_실패로_알린다():
    with patch("oneshot.run.subprocess.run") as run:
        run.side_effect = subprocess.CalledProcessError(
            1, "ffprobe", stderr="Invalid data found when processing input"
        )
        with pytest.raises(RuntimeError, match="길이 probe 실패"):
            probe_duration("broken.mp4")


def _setup_two_pairs(tmp_path):
    for name in ("a", "b"):
        (tmp_path / f"{name}.mp4").write_bytes(b"\x00")
        (tmp_path / f"{name}.srt").write_text(SRT, encoding="utf-8")


def test_한_영상이_실패해도_나머지는_계속_처리된다(tmp_path, capsys):
    _setup_two_pairs(tmp_path)
    out_dir = tmp_path / "out"
    from oneshot.sample_frames import FrameSet
    frame = tmp_path / "0001.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xe0")
    fs = FrameSet(paths=[str(frame)], timestamps=[0.0], interval_sec=5.0, width=1024)

    with patch("sys.argv", ["run.py", "--input-dir", str(tmp_path),
                             "--output-dir", str(out_dir), "--age-range", "5-6"]), \
         patch("oneshot.run.anthropic.Anthropic"), \
         patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities", side_effect=[[], ACTIVITIES]):
        main()

    assert (out_dir / "b_activities.json").exists()
    failures = json.loads((out_dir / "failures.json").read_text(encoding="utf-8"))
    assert len(failures) == 1
    assert failures[0]["video_id"] == "a"
    assert "활동 0개" in failures[0]["error"]


def test_전부_성공하면_failures_json을_만들지_않는다(tmp_path):
    _setup_two_pairs(tmp_path)
    out_dir = tmp_path / "out"
    from oneshot.sample_frames import FrameSet
    frame = tmp_path / "0001.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xe0")
    fs = FrameSet(paths=[str(frame)], timestamps=[0.0], interval_sec=5.0, width=1024)

    with patch("sys.argv", ["run.py", "--input-dir", str(tmp_path),
                             "--output-dir", str(out_dir), "--age-range", "5-6"]), \
         patch("oneshot.run.anthropic.Anthropic"), \
         patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities", return_value=ACTIVITIES):
        main()

    assert (out_dir / "a_activities.json").exists()
    assert (out_dir / "b_activities.json").exists()
    assert not (out_dir / "failures.json").exists()


def test_자막이_0줄이면_모델_호출_전에_실패한다(tmp_path):
    _setup(tmp_path)
    from oneshot.sample_frames import FrameSet
    fs = FrameSet(paths=["x.jpg"], timestamps=[0.0], interval_sec=5.0, width=1024)

    with patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.parse_subtitle_file", return_value=[]), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities") as generate:
        with pytest.raises(RuntimeError, match="자막을 0줄 파싱함"):
            run_for_video(
                str(tmp_path / "v.mp4"), str(tmp_path / "v.srt"), "v",
                client=None, output_dir=str(tmp_path / "out"), age_range="5-6",
                topic="동물", target_count=5, frame_interval=5.0,
                frame_width=1024, min_spacing_sec=20.0,
            )
    generate.assert_not_called()


def test_프레임이_0장이면_모델_호출_전에_실패한다(tmp_path):
    _setup(tmp_path)
    from oneshot.sample_frames import FrameSet
    fs = FrameSet(paths=[], timestamps=[], interval_sec=5.0, width=1024)

    with patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities") as generate:
        with pytest.raises(RuntimeError, match="프레임을 0장 추출함"):
            run_for_video(
                str(tmp_path / "v.mp4"), str(tmp_path / "v.srt"), "v",
                client=None, output_dir=str(tmp_path / "out"), age_range="5-6",
                topic="동물", target_count=5, frame_interval=5.0,
                frame_width=1024, min_spacing_sec=20.0,
            )
    generate.assert_not_called()


def test_원문_응답이_파싱_전에_파일로_저장된다(tmp_path):
    _setup(tmp_path)
    from oneshot.sample_frames import FrameSet
    frame = tmp_path / "0001.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xe0")
    fs = FrameSet(paths=[str(frame)], timestamps=[0.0], interval_sec=5.0, width=1024)

    def fake_generate(client, system_prompt, content_blocks, *, on_raw_text=None):
        if on_raw_text is not None:
            on_raw_text("모델이 실제로 낸 원문")
        return ACTIVITIES

    with patch("oneshot.run.probe_duration", return_value=300.0), \
         patch("oneshot.run.extract_frames", return_value=fs), \
         patch("oneshot.run.generate_activities", side_effect=fake_generate):
        run_for_video(
            str(tmp_path / "v.mp4"), str(tmp_path / "v.srt"), "v",
            client=None, output_dir=str(tmp_path / "out"), age_range="5-6",
            topic="동물", target_count=5, frame_interval=5.0,
            frame_width=1024, min_spacing_sec=20.0,
        )

    saved = (tmp_path / "out" / "v_raw_response.txt").read_text(encoding="utf-8")
    assert saved == "모델이 실제로 낸 원문"


def test_자막_없는_영상은_목록에서_빠진다(tmp_path):
    (tmp_path / "solo.mp4").write_bytes(b"\x00")
    assert discover_missing_subtitles(str(tmp_path)) == ["solo"]


def test_짝이_있는_영상은_빠짐_목록에_없다(tmp_path):
    _setup(tmp_path)
    assert discover_missing_subtitles(str(tmp_path)) == []


def test_자막_없는_영상은_failures에_기록되고_출력에도_남는다(tmp_path, capsys):
    (tmp_path / "solo.mp4").write_bytes(b"\x00")
    out_dir = tmp_path / "out"

    with patch("sys.argv", ["run.py", "--input-dir", str(tmp_path),
                             "--output-dir", str(out_dir), "--age-range", "5-6"]), \
         patch("oneshot.run.anthropic.Anthropic"):
        main()

    failures = json.loads((out_dir / "failures.json").read_text(encoding="utf-8"))
    assert len(failures) == 1
    assert failures[0]["video_id"] == "solo"
    assert "자막" in failures[0]["error"]
    assert "solo" in capsys.readouterr().out
