"""시스템 프롬프트와 사용자 콘텐츠 블록 조립.

이미지 앞의 [MM:SS] 라벨이 이 설계의 핵심이다. 라벨이 없으면 모델은 프레임의 시각을
알 수 없고 timestamp_sec을 지어낸다. 자막도 같은 형식이라 두 축이 정렬되고, 모델은
"이 대사가 나올 때 화면에 무엇이 있었는지"를 직접 대조할 수 있다.
"""

import base64
from pathlib import Path

from oneshot._reuse import TEMPLATES_BY_AGE_TIER, SubtitleSegment, templates_for_tier
from oneshot.sample_frames import FrameSet


def format_timestamp(sec: float) -> str:
    total = int(sec)
    return f"{total // 60:02d}:{total % 60:02d}"


def build_system_prompt(age_range: str) -> str:
    templates = templates_for_tier(age_range)
    if not templates:
        raise ValueError(f"알 수 없는 연령 티어: {age_range!r} (가능: {sorted(TEMPLATES_BY_AGE_TIER)})")
    catalog = "\n".join(f"- {name}: {desc}" for name, desc in templates.items())
    return f"""당신은 만 {age_range}세 아이가 보는 영상에 넣을 상호작용 학습 활동을 설계합니다.

영상의 프레임들과 자막 전문을 함께 받습니다. 프레임 앞의 [MM:SS]는 그 화면이 나오는 시각이고,
자막 줄 앞의 [MM:SS]도 같은 시각 축입니다. 둘을 대조해서 판단하세요.

## 만들 수 있는 활동 유형

{catalog}

이 목록 밖의 유형은 만들지 마세요. activity_template에는 위 이름을 그대로 씁니다.

## 지점을 고르는 원칙

- 말이 끝나고 잠시 쉬어 가는 곳에 넣습니다. 대사 한가운데를 끊지 마세요.
- 활동끼리 충분히 떨어뜨립니다. 연달아 나오면 아이가 영상을 못 봅니다.
- 그 지점까지 본 것만으로 풀 수 있어야 합니다. 뒤에 나올 내용을 묻지 마세요.

## 문제를 만드는 원칙

- 정답은 반드시 하나입니다. 여러 개가 답이 될 수 있으면 그 문제는 버리세요.
- 정답의 근거가 화면이나 자막에 있어야 합니다. 짐작해야 풀리는 문제는 만들지 마세요.
- 선택지 3개는 같은 층위여야 합니다. ("하트로즈", "고고핑의 집", "야외"처럼 장소와
  범주가 섞이면 안 됩니다.)
- 아이가 소리 내어 읽을 문장으로 씁니다.

## why_here

왜 하필 이 지점인지를 씁니다. "자연스럽게 연결되며" 같은 형식 문구는 쓰지 마세요.
그 순간 화면과 자막에 무엇이 있어서 이 활동이 성립하는지를 적습니다."""


def _encode_image(path: str) -> dict:
    data = base64.standard_b64encode(Path(path).read_bytes()).decode()
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def build_content_blocks(
    subtitles: list[SubtitleSegment],
    frames: FrameSet,
    video_meta: dict,
) -> list[dict]:
    if len(frames.paths) != len(frames.timestamps):
        raise ValueError(
            f"프레임 수와 시각 수가 다름: paths={len(frames.paths)}, timestamps={len(frames.timestamps)}"
        )

    blocks: list[dict] = [
        {
            "type": "text",
            "text": (
                f"영상: {video_meta['video_id']}\n"
                f"길이: {format_timestamp(video_meta['duration_sec'])}\n"
                f"주제: {video_meta['topic']}\n"
                f"대상: 만 {video_meta['age_range']}세\n"
                f"만들 활동 수: {video_meta['target_count']}개"
            ),
        }
    ]

    subtitle_text = "\n".join(
        f"[{format_timestamp(s.start_sec)}] {s.text}" for s in subtitles
    )
    blocks.append({"type": "text", "text": f"## 자막 전문\n\n{subtitle_text}"})
    blocks.append({"type": "text", "text": f"## 프레임 ({frames.interval_sec}초 간격)"})

    for path, ts in zip(frames.paths, frames.timestamps):
        blocks.append({"type": "text", "text": f"[{format_timestamp(ts)}]"})
        blocks.append(_encode_image(path))

    return blocks
