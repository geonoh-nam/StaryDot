import pytest

from oneshot._reuse import SubtitleSegment
from oneshot.prompt import build_content_blocks, build_system_prompt, format_timestamp
from oneshot.sample_frames import FrameSet


def _frames(tmp_path, n):
    paths = []
    for i in range(1, n + 1):
        p = tmp_path / f"{i:04d}.jpg"
        p.write_bytes(b"\xff\xd8\xff\xe0")
        paths.append(str(p))
    return FrameSet(paths=paths, timestamps=[i * 5.0 for i in range(n)],
                    interval_sec=5.0, width=1024)


META = {"video_id": "v", "duration_sec": 60.0, "topic": "동물",
        "age_range": "5-6", "target_count": 5}


def test_시각_형식():
    assert format_timestamp(0.0) == "00:00"
    assert format_timestamp(205.0) == "03:25"
    assert format_timestamp(3661.0) == "61:01"


def test_시스템_프롬프트에_해당_티어_활동만_들어간다():
    prompt = build_system_prompt("5-6")
    assert "감정_추론" in prompt
    assert "색_찾기" not in prompt  # 3-4 티어


def test_모든_이미지_바로_앞에_시각_라벨이_온다(tmp_path):
    blocks = build_content_blocks([], _frames(tmp_path, 3), META)
    for i, block in enumerate(blocks):
        if block["type"] == "image":
            prev = blocks[i - 1]
            assert prev["type"] == "text"
            assert prev["text"].startswith("[") and prev["text"].endswith("]")


def test_라벨의_시각이_프레임_시각과_일치한다(tmp_path):
    blocks = build_content_blocks([], _frames(tmp_path, 3), META)
    labels = [b["text"] for b in blocks if b["type"] == "text" and b["text"].startswith("[0")]
    assert labels == ["[00:00]", "[00:05]", "[00:10]"]


def test_자막이_같은_시각_형식으로_들어간다(tmp_path):
    subs = [SubtitleSegment(text="안녕", start_sec=5.0, end_sec=7.0)]
    blocks = build_content_blocks(subs, _frames(tmp_path, 1), META)
    subtitle_block = next(b for b in blocks if b["type"] == "text" and "안녕" in b["text"])
    assert "[00:05] 안녕" in subtitle_block["text"]


def test_이미지는_base64로_실려간다(tmp_path):
    blocks = build_content_blocks([], _frames(tmp_path, 1), META)
    image = next(b for b in blocks if b["type"] == "image")
    assert image["source"]["type"] == "base64"
    assert image["source"]["media_type"] == "image/jpeg"
    assert "\n" not in image["source"]["data"]


def test_모르는_티어는_예외():
    with pytest.raises(ValueError) as exc_info:
        build_system_prompt("99-100")
    message = str(exc_info.value)
    assert "99-100" in message
    assert "3-4" in message and "5-6" in message


def test_프레임_수와_시각_수가_다르면_예외(tmp_path):
    mismatched = _frames(tmp_path, 2)
    mismatched.timestamps = mismatched.timestamps[:1]
    with pytest.raises(ValueError):
        build_content_blocks([], mismatched, META)
