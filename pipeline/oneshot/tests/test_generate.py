import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from oneshot.generate import (
    ACTIVITY_SCHEMA,
    InvalidActivitiesResponseError,
    RefusalError,
    TruncatedResponseError,
    generate_activities,
)

PAYLOAD = {"activities": [{"timestamp_sec": 30.0, "activity_template": "감정_추론",
                           "question": "q", "options": ["a", "b", "c"], "answer": "a",
                           "why_here": "w", "scene_description": "s"}]}


class _ExplodingContent:
    """content를 stop_reason 확인 전에 건드리면 바로 실패하게 만드는 미끼."""

    def __iter__(self):
        raise AssertionError("content should not be read before stop_reason check")


def _client(stop_reason="end_turn", text=None, content=None):
    message = SimpleNamespace(
        stop_reason=stop_reason,
        content=content if content is not None
        else [SimpleNamespace(type="text", text=text if text is not None else json.dumps(PAYLOAD))],
    )
    stream_ctx = MagicMock()
    stream_ctx.__enter__.return_value.get_final_message.return_value = message
    client = MagicMock()
    client.beta.messages.stream.return_value = stream_ctx
    return client


def test_활동_배열을_돌려준다():
    result = generate_activities(_client(), "sys", [{"type": "text", "text": "hi"}])
    assert result == PAYLOAD["activities"]


def test_거부되면_예외를_던진다():
    client = _client(stop_reason="refusal", content=_ExplodingContent())
    with pytest.raises(RefusalError):
        generate_activities(client, "sys", [])


def test_max_tokens에서_잘리면_예외를_던진다():
    client = _client(stop_reason="max_tokens", content=_ExplodingContent())
    with pytest.raises(TruncatedResponseError):
        generate_activities(client, "sys", [])


def test_텍스트_블록이_없으면_예외를_던진다():
    with pytest.raises(InvalidActivitiesResponseError):
        generate_activities(_client(content=[]), "sys", [])


def test_텍스트가_JSON이_아니면_예외를_던진다():
    with pytest.raises(InvalidActivitiesResponseError):
        generate_activities(_client(text="이건 JSON이 아니다"), "sys", [])


def test_activities_키가_없으면_예외를_던진다():
    with pytest.raises(InvalidActivitiesResponseError):
        generate_activities(_client(text=json.dumps({"other": []})), "sys", [])


def test_opus5를_스트리밍으로_부른다():
    client = _client()
    generate_activities(client, "sys", [])
    kwargs = client.beta.messages.stream.call_args.kwargs
    assert kwargs["model"] == "claude-opus-5"
    assert kwargs["thinking"] == {"type": "adaptive"}
    assert kwargs["output_config"]["effort"] == "high"


def test_budget_tokens를_보내지_않는다():
    client = _client()
    generate_activities(client, "sys", [])
    assert "budget_tokens" not in json.dumps(client.beta.messages.stream.call_args.kwargs)


def test_시스템_프롬프트에_캐시_지시가_붙는다():
    client = _client()
    generate_activities(client, "sys", [])
    system = client.beta.messages.stream.call_args.kwargs["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}


def test_거부_폴백을_켠_채_부른다():
    client = _client()
    generate_activities(client, "sys", [])
    kwargs = client.beta.messages.stream.call_args.kwargs
    assert kwargs["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in kwargs["betas"]


def test_스키마가_answer를_필수로_요구한다():
    item = ACTIVITY_SCHEMA["properties"]["activities"]["items"]
    assert "answer" in item["required"]
    assert item["additionalProperties"] is False


def test_파싱_실패_전에_원문이_저장된다(tmp_path):
    # 첫 실호출에서 가장 그럴듯한 실패는 파서가 기대 못한 응답 모양이다.
    # 그때도 원문이 디스크에 남아야 200자 프리뷰 이상을 볼 수 있다.
    dest = tmp_path / "raw.txt"
    client = _client(text="이건 JSON이 아니다")
    with pytest.raises(InvalidActivitiesResponseError):
        generate_activities(
            client, "sys", [],
            on_raw_text=lambda text: dest.write_text(text, encoding="utf-8"),
        )
    assert dest.exists()
    assert dest.read_text(encoding="utf-8") == "이건 JSON이 아니다"


def test_activities가_배열이_아니면_예외를_던진다():
    client = _client(text=json.dumps({"activities": "이건 배열이 아니다"}))
    with pytest.raises(InvalidActivitiesResponseError):
        generate_activities(client, "sys", [])
