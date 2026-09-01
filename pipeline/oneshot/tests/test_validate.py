from oneshot._reuse import SubtitleSegment
from oneshot.validate import validate


def act(**kw):
    base = {
        "timestamp_sec": 30.0,
        "activity_template": "감정_추론",
        "question": "핑이는 어떤 마음일까요?",
        "options": ["기뻐요", "슬퍼요", "무서워요"],
        "answer": "기뻐요",
        "why_here": "핑이가 웃고 있다",
        "scene_description": "핑이가 웃는 얼굴",
    }
    base.update(kw)
    return base


SUBS = [
    SubtitleSegment(text="안녕", start_sec=10.0, end_sec=12.0),
    SubtitleSegment(text="반가워", start_sec=40.0, end_sec=42.0),
]
KW = {"age_range": "5-6", "duration_sec": 300.0, "subtitles": SUBS}


def test_정상_활동은_통과한다():
    result = validate([act()], **KW)
    assert len(result.activities) == 1
    assert result.rejections == []


def test_티어_밖_활동은_버린다():
    result = validate([act(activity_template="색_찾기")], **KW)  # 3-4 티어
    assert result.activities == []
    assert "카탈로그" in result.rejections[0]["reason"]


def test_정답이_선택지에_없으면_버린다():
    result = validate([act(answer="화가 나요")], **KW)
    assert result.activities == []
    assert "정답" in result.rejections[0]["reason"]


def test_선택지가_중복되면_버린다():
    result = validate([act(options=["기뻐요", "기뻐요", "슬퍼요"])], **KW)
    assert result.activities == []
    assert "중복" in result.rejections[0]["reason"]


def test_영상_길이_밖이면_버린다():
    result = validate([act(timestamp_sec=500.0)], **KW)
    assert result.activities == []
    assert "길이" in result.rejections[0]["reason"]


def test_발화_한가운데면_발화_끝으로_스냅한다():
    result = validate([act(timestamp_sec=11.0)], **KW)  # 10~12초 발화 중
    assert len(result.activities) == 1
    assert result.activities[0]["timestamp_sec"] == 12.0


def test_간격이_좁으면_뒤엣것을_버린다():
    result = validate([act(timestamp_sec=30.0), act(timestamp_sec=35.0)], **KW)
    assert len(result.activities) == 1
    assert result.activities[0]["timestamp_sec"] == 30.0
    assert "간격" in result.rejections[0]["reason"]


def test_결과는_시각_순으로_정렬된다():
    result = validate([act(timestamp_sec=100.0), act(timestamp_sec=30.0)], **KW)
    assert [a["timestamp_sec"] for a in result.activities] == [30.0, 100.0]


def test_버려진_항목은_원본과_사유를_함께_남긴다():
    bad = act(answer="화가 나요")
    result = validate([bad], **KW)
    assert result.rejections[0]["activity"] == bad
    assert result.rejections[0]["reason"]


def test_스냅후_간격으로_버려져도_사유에는_원본_시각이_남는다():
    # 15.0은 10~12초 발화 밖이라 안 스냅되지만, 대신 10~20초 발화를 하나 더 둔다.
    subs = [SubtitleSegment(text="안녕", start_sec=10.0, end_sec=20.0)]
    kept = act(timestamp_sec=5.0)
    snapped_away = act(timestamp_sec=15.0)  # 발화 중 -> 20.0으로 스냅 -> kept(5.0)와 15초 간격, 20초 미만
    result = validate([kept, snapped_away], age_range="5-6", duration_sec=300.0, subtitles=subs)
    assert len(result.activities) == 1
    assert result.activities[0]["timestamp_sec"] == 5.0
    assert result.rejections[0]["activity"]["timestamp_sec"] == 15.0
    assert "간격" in result.rejections[0]["reason"]


def test_간격은_스냅된_최종_시각으로_판단한다():
    # 원래 시각(25.0) 기준이면 kept(10.0)와 15초 차이라 간격 위반이지만,
    # 25.0이 발화(24~45초) 중이라 45.0으로 스냅되면 35초 차이로 통과한다.
    subs = [SubtitleSegment(text="안녕", start_sec=24.0, end_sec=45.0)]
    kept = act(timestamp_sec=10.0)
    snaps_to_pass = act(timestamp_sec=25.0)
    result = validate([kept, snaps_to_pass], age_range="5-6", duration_sec=300.0, subtitles=subs)
    assert [a["timestamp_sec"] for a in result.activities] == [10.0, 45.0]
    assert result.rejections == []


def test_시각이_숫자가_아니면_타입_전용_사유를_남긴다():
    result = validate([act(timestamp_sec="30")], **KW)
    assert result.activities == []
    assert "숫자가 아님" in result.rejections[0]["reason"]
