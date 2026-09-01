from dataclasses import dataclass


@dataclass
class SubtitleSegment:
    text: str
    start_sec: float
    end_sec: float


@dataclass
class CandidatePoint:
    timestamp_sec: float
    context_segments: list[SubtitleSegment]
    reason: str | None = None


@dataclass
class ActivityCandidate:
    is_suitable: bool
    score: float
    timestamp_sec: float
    source_subtitle_range: tuple[float, float]
    activity_template: str | None = None
    question: str | None = None
    options: list[str] | None = None
    answer: str | None = None
    reason: str | None = None
    scene_description: str | None = None


# 2026-08-19 활동 체계 개편. 티어별 하드 분할 — 활동은 자기 티어에서만 쓸 수 있다.
TEMPLATES_BY_AGE_TIER = {
    "3-4": {
        "사물_첫글자_찾기": "화면에 보이는 사물 이름의 첫 글자를 찾는다",
        "같은_글자로_시작하는_낱말": "특정 글자로 시작하는 사물을 고른다",
        "색_찾기": "화면에 없는 색을 고른다",
        "수량_확인": "화면에 보이는 사물의 개수를 센다",
        "그림_속_대상_찾기": "화면에 실제로 있던 사물을 고른다",
    },
    "5-6": {
        "그림과_낱말_연결": "화면에 보이는 대상의 이름을 고른다",
        "빠진_글자_완성": "사물 이름의 빠진 글자를 채운다(호□이 → 랑)",
        "이야기_되새기기": "인물이 하려던 행동을 떠올린다",
        "흉내_내는_말_이해": "장면의 움직임에 알맞은 흉내 내는 말을 고른다",
        "감정_추론": "일어난 사건을 근거로 인물의 마음을 고른다",
    },
    "7": {
        "올바른_낱말_찾기": "맞춤법이 올바른 낱말을 고른다",
        "두_낱말_합치기": "두 낱말을 합쳐 새 낱말을 만든다",
        "반대말_찾기": "자막에 나온 낱말의 반대말을 고른다",
        "사건의_순서_파악": "일어난 사건을 순서대로 놓는다",
        "이야기_핵심_주제": "이야기가 전하는 가장 중요한 내용을 고른다",
        "원인과_결과": "사건의 가장 직접적인 원인을 고른다",
    },
}

# 활동 → 연령 티어 역방향 표. 카탈로그가 단일 출처이므로 손으로 적지 않는다.
TIER_OF_TEMPLATE = {
    name: tier for tier, names in TEMPLATES_BY_AGE_TIER.items() for name in names
}

ACTIVITY_CATEGORY = {
    "사물_첫글자_찾기": "글자_어휘",
    "같은_글자로_시작하는_낱말": "글자_어휘",
    "색_찾기": "관찰_이해",
    "수량_확인": "관찰_이해",
    "그림_속_대상_찾기": "관찰_이해",
    "그림과_낱말_연결": "글자_어휘",
    "빠진_글자_완성": "글자_어휘",
    "이야기_되새기기": "관찰_이해",
    "흉내_내는_말_이해": "관찰_이해",
    "감정_추론": "맥락_추론",
    "올바른_낱말_찾기": "글자_어휘",
    "두_낱말_합치기": "글자_어휘",
    "반대말_찾기": "글자_어휘",
    "사건의_순서_파악": "관찰_이해",
    "이야기_핵심_주제": "관찰_이해",
    "원인과_결과": "맥락_추론",
}


def templates_for_tier(age_range: str) -> dict[str, str]:
    """해당 연령 티어에서 쓸 수 있는 활동만 돌려준다. 모르는 티어면 빈 카탈로그."""
    return TEMPLATES_BY_AGE_TIER.get(age_range, {})
