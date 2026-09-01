import json

import pytest

from oneshot.check import check, load_activities

SRT = "1\n00:00:10,000 --> 00:00:12,000\n안녕\n"

ACTIVITY = {
    "timestamp_sec": 30.0,
    "activity_template": "감정_추론",
    "question": "핑이는 어떤 마음일까요?",
    "options": ["기뻐요", "슬퍼요", "무서워요"],
    "answer": "기뻐요",
    "why_here": "핑이가 웃고 있다",
    "scene_description": "핑이가 웃는 얼굴",
}


def _workdir(tmp_path, activities, wrap=False):
    (tmp_path / "v.srt").write_text(SRT, encoding="utf-8")
    meta = {
        "video_id": "v",
        "source": {"video_file": str(tmp_path / "v.mp4"), "subtitle_file": str(tmp_path / "v.srt")},
        "duration_sec": 300.0,
        "age_range": "5-6",
        "frame_sampling": {"interval_sec": 5.0, "width": 1024, "frame_count": 2},
    }
    (tmp_path / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    payload = {"activities": activities} if wrap else activities
    (tmp_path / "acts.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return str(tmp_path / "acts.json"), str(tmp_path / "meta.json"), str(tmp_path / "out.json")


def test_최상위_배열을_읽는다(tmp_path):
    path = tmp_path / "a.json"
    path.write_text(json.dumps([ACTIVITY], ensure_ascii=False), encoding="utf-8")
    assert load_activities(str(path)) == [ACTIVITY]


def test_activities_키를_가진_객체도_읽는다(tmp_path):
    path = tmp_path / "a.json"
    path.write_text(json.dumps({"activities": [ACTIVITY]}, ensure_ascii=False), encoding="utf-8")
    assert load_activities(str(path)) == [ACTIVITY]


def test_배열도_activities_키도_없으면_예외(tmp_path):
    path = tmp_path / "a.json"
    path.write_text(json.dumps({"quiz": []}, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(RuntimeError, match="활동 배열을 찾지 못함"):
        load_activities(str(path))


def test_정상_활동은_통과하고_출처가_에이전트로_남는다(tmp_path):
    acts, meta, out = _workdir(tmp_path, [ACTIVITY])
    result = check(acts, meta, out, min_spacing_sec=20.0)

    assert len(result["activities"]) == 1
    assert result["rejections"] == []
    assert result["produced_by"] == "agents"
    assert result["frame_sampling"]["frame_count"] == 2


def test_카탈로그_밖_활동은_사유와_함께_버려진다(tmp_path):
    bad = dict(ACTIVITY, activity_template="색_찾기")  # 3-4 티어
    acts, meta, out = _workdir(tmp_path, [bad], wrap=True)
    result = check(acts, meta, out, min_spacing_sec=20.0)

    assert result["activities"] == []
    assert "카탈로그" in result["rejections"][0]["reason"]
    assert result["rejections"][0]["activity"] == bad


def test_결과가_파일로_저장된다(tmp_path):
    acts, meta, out = _workdir(tmp_path, [ACTIVITY])
    check(acts, meta, out, min_spacing_sec=20.0)

    saved = json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))
    assert saved["video_id"] == "v"
    assert saved["activities"][0]["answer"] == "기뻐요"
