"""모델을 믿되 검산은 코드가 한다.

재시도는 하지 않는다. 한 번 호출하고 통과한 것만 쓴다. 통과율이 낮으면 프롬프트를
고칠 일이지 호출을 늘릴 일이 아니다.
"""

from dataclasses import dataclass, field

from oneshot._reuse import SubtitleSegment, templates_for_tier


@dataclass
class ValidationResult:
    activities: list[dict] = field(default_factory=list)
    rejections: list[dict] = field(default_factory=list)


def _snap_out_of_speech(t: float, subtitles: list[SubtitleSegment]) -> float:
    """발화 한가운데면 그 발화가 끝나는 시각으로 민다."""
    for seg in subtitles:
        if seg.start_sec < t < seg.end_sec:
            return seg.end_sec
    return t


def _check(activity: dict, age_range: str, duration_sec: float) -> str | None:
    """통과하면 None, 걸리면 사유 문자열."""
    if activity.get("activity_template") not in templates_for_tier(age_range):
        return f"활동 유형이 만 {age_range}세 카탈로그에 없음"

    options = activity.get("options") or []
    if len(options) != 3:
        return "선택지가 3개가 아님"
    if len(set(options)) != len(options):
        return "선택지가 중복됨"
    if activity.get("answer") not in options:
        return "정답이 선택지 안에 없음"

    t = activity.get("timestamp_sec")
    if not isinstance(t, (int, float)):
        return f"시각이 숫자가 아님: {t!r}"
    if not (0 < t < duration_sec):
        return "시각이 영상 길이 밖"

    return None


def validate(
    activities: list[dict],
    *,
    age_range: str,
    duration_sec: float,
    subtitles: list[SubtitleSegment],
    min_spacing_sec: float = 20.0,
) -> ValidationResult:
    result = ValidationResult()

    # (원본, 스냅된 사본) 쌍으로 들고 다닌다. 간격 위반으로 버려질 때도
    # rejections에는 모델이 실제로 낸 원본을 남겨야 하기 때문이다.
    survivors: list[tuple[dict, dict]] = []
    for activity in activities:
        reason = _check(activity, age_range, duration_sec)
        if reason:
            result.rejections.append({"activity": activity, "reason": reason})
            continue
        snapped = dict(activity)
        snapped["timestamp_sec"] = _snap_out_of_speech(activity["timestamp_sec"], subtitles)
        survivors.append((activity, snapped))

    last_kept: float | None = None
    for original, snapped in sorted(survivors, key=lambda pair: pair[1]["timestamp_sec"]):
        if last_kept is not None and snapped["timestamp_sec"] - last_kept < min_spacing_sec:
            result.rejections.append(
                {"activity": original, "reason": f"앞 활동과 간격이 {min_spacing_sec}초 미만"}
            )
            continue
        result.activities.append(snapped)
        last_kept = snapped["timestamp_sec"]

    return result
