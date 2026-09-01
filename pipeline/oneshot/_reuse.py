"""활동 카탈로그와 자막 파서를 한곳에서 재수출한다.

원래는 별도 `pipeline/` 패키지를 sys.path에 얹어 쓰던 경유지였다. 이제 두 모듈이
이 패키지 안에 있으므로 조작 없이 그냥 다시 내보낸다. 임포트 지점을 한 곳으로
모아 두면 카탈로그의 출처가 코드에서 한눈에 보인다.
"""

from oneshot.schemas import TEMPLATES_BY_AGE_TIER, SubtitleSegment, templates_for_tier
from oneshot.subtitle_parser import parse_subtitle_file

__all__ = [
    "TEMPLATES_BY_AGE_TIER",
    "SubtitleSegment",
    "templates_for_tier",
    "parse_subtitle_file",
]
