"""Opus 5 단일 호출. 지점 선정과 활동 생성은 같은 판단이므로 한 번에 끝낸다."""

import json

MODEL = "claude-opus-5"
MAX_TOKENS = 16000

# 거부되면 조용히 빈 결과가 나오는 것보다 폴백이 도는 편이 낫다.
# 이것 때문에 beta 엔드포인트(client.beta.messages)를 쓴다.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

ACTIVITY_SCHEMA = {
    "type": "object",
    "properties": {
        "activities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "timestamp_sec": {"type": "number"},
                    "activity_template": {"type": "string"},
                    "question": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 3,
                        "maxItems": 3,
                    },
                    "answer": {"type": "string"},
                    "why_here": {"type": "string"},
                    "scene_description": {"type": "string"},
                },
                "required": [
                    "timestamp_sec", "activity_template", "question",
                    "options", "answer", "why_here", "scene_description",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["activities"],
    "additionalProperties": False,
}


class RefusalError(RuntimeError):
    """모델이 요청을 거부했다. 조용히 빈 결과로 넘기지 않는다."""


class TruncatedResponseError(RuntimeError):
    """응답이 max_tokens에서 잘렸다. MAX_TOKENS를 늘려야 할 수 있다."""


class InvalidActivitiesResponseError(RuntimeError):
    """모델 응답에서 활동 목록을 읽어낼 수 없었다."""


def _preview(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[:limit] + "…"


def generate_activities(
    client,
    system_prompt: str,
    content_blocks: list[dict],
    *,
    on_raw_text=None,
) -> list[dict]:
    """단일 호출은 재시도가 없다 — 실패해도 이미 돈은 나갔다.
    `on_raw_text`가 주어지면 파싱을 시도하기 전, 원문 텍스트를 얻은 그 순간 호출한다.
    호출자(run_for_video)가 이걸로 원문을 디스크에 남겨야 파싱 실패 시에도 응답이 남는다."""
    with client.beta.messages.stream(
        model=MODEL,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        max_tokens=MAX_TOKENS,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        thinking={"type": "adaptive"},
        output_config={
            "effort": "high",
            # NOTE(Task 6, Step 5): 이 format 형태({"type": "json_schema", "schema": ...})는
            # claude-api 스킬 문서의 raw-schema 예시와 그대로 일치한다(리뷰로 확인됨).
            # 아직 실제로 확인 안 된 건 실호출 그 자체뿐이다 — Task 8에서 실행해볼 것.
            "format": {"type": "json_schema", "schema": ACTIVITY_SCHEMA},
        },
        messages=[{"role": "user", "content": content_blocks}],
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise RefusalError(f"모델이 거부함: {getattr(message, 'stop_details', None)}")
    if message.stop_reason == "max_tokens":
        raise TruncatedResponseError(
            "응답이 max_tokens에서 잘렸다. MAX_TOKENS를 늘려야 할 수 있다."
        )

    text = "".join(b.text for b in message.content if b.type == "text")
    if on_raw_text is not None:
        on_raw_text(text)
    if not text:
        raise InvalidActivitiesResponseError("응답에 텍스트 블록이 없다.")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise InvalidActivitiesResponseError(
            f"응답이 JSON이 아니다: {_preview(text)!r}"
        ) from None
    try:
        activities = parsed["activities"]
    except KeyError:
        raise InvalidActivitiesResponseError(
            f"응답 JSON에 'activities' 키가 없다: {_preview(text)!r}"
        ) from None
    if not isinstance(activities, list):
        raise InvalidActivitiesResponseError(
            f"응답 JSON의 'activities'가 배열이 아니다: {_preview(text)!r}"
        )
    return activities
