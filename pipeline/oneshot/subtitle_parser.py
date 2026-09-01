import re
from pathlib import Path

from oneshot.schemas import SubtitleSegment

_SRT_TIME_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})"
)
_VTT_TIME_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})"
)


def _to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(text: str) -> list[SubtitleSegment]:
    segments = []
    blocks = re.split(r"\n\s*\n", text.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 2:
            continue
        time_line_idx = 1 if _SRT_TIME_RE.search(lines[0]) is None else 0
        match = _SRT_TIME_RE.search(lines[time_line_idx])
        if not match:
            continue
        start = _to_seconds(*match.groups()[0:4])
        end = _to_seconds(*match.groups()[4:8])
        content = " ".join(lines[time_line_idx + 1 :]).strip()
        if content:
            segments.append(SubtitleSegment(text=content, start_sec=start, end_sec=end))
    return segments


def parse_vtt(text: str) -> list[SubtitleSegment]:
    segments = []
    body = text.strip()
    if body.startswith("WEBVTT"):
        body = body.split("\n", 1)[1] if "\n" in body else ""
    blocks = re.split(r"\n\s*\n", body.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if not lines:
            continue
        time_line_idx = 0
        match = _VTT_TIME_RE.search(lines[time_line_idx])
        if not match:
            continue
        start = _to_seconds(*match.groups()[0:4])
        end = _to_seconds(*match.groups()[4:8])
        content = " ".join(lines[time_line_idx + 1 :]).strip()
        if content:
            segments.append(SubtitleSegment(text=content, start_sec=start, end_sec=end))
    return segments


def parse_subtitle_file(path: str) -> list[SubtitleSegment]:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix.lower() == ".vtt":
        return parse_vtt(text)
    return parse_srt(text)
