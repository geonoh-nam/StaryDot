// Parse an SRT subtitle file into cue rows. Times are milliseconds from the start of the video.
const TIME = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;

export function parseSrt(text) {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const cues = [];
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const timeLine = lines.findIndex((l) => TIME.test(l));
    if (timeLine === -1) continue;
    const m = TIME.exec(lines[timeLine]);
    cues.push({
      idx: Number(lines[timeLine - 1]) || cues.length + 1,
      start_ms: toMs(m[1], m[2], m[3], m[4]),
      end_ms: toMs(m[5], m[6], m[7], m[8]),
      text: lines.slice(timeLine + 1).join('\n'),
    });
  }
  return cues;
}
