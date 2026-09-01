from oneshot._reuse import TEMPLATES_BY_AGE_TIER, SubtitleSegment, templates_for_tier


def test_카탈로그_티어가_세_종류다():
    assert set(TEMPLATES_BY_AGE_TIER) == {"3-4", "5-6", "7"}


def test_티어별_카탈로그만_돌려준다():
    templates = templates_for_tier("5-6")
    assert "감정_추론" in templates
    assert "색_찾기" not in templates  # 3-4 티어 활동


def test_모르는_티어는_빈_카탈로그():
    assert templates_for_tier("99") == {}


def test_자막_세그먼트_타입을_노출한다():
    seg = SubtitleSegment(text="안녕", start_sec=1.0, end_sec=2.0)
    assert seg.start_sec == 1.0
