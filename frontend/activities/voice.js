import LINES from '../assets/lines.json';
import VOICE from '../assets/voice-index.js';
import { playVoice } from '../sound';
import { pickLine } from './lines';

// One line: the words for the bubble, and the recording if we happen to have one. A missing
// recording is the normal case until the files land, so it is silent, not an error.
//
// `key` is usually a lines.json key ("quiz.ask"). Some activities (e.g. findit) carry their own
// one-off question in their payload instead of a pool entry — for those, `key` IS the text to
// say, and there's no recording for it, so it renders as text only.
export function sayLine(character, key, last) {
  if (!(key in LINES)) return key;
  const pool = LINES[key] || [];
  const text = pickLine(pool, last);
  if (text === null) return null;
  const clips = (VOICE[character] || {})[key] || [];
  const idx = pool.indexOf(text);
  if (clips[idx]) playVoice(clips[idx], character);
  return text;
}

// The counting voice is indexed, not random: "셋" must be the third clip.
export function sayCount(character, n) {
  const text = (LINES.count || [])[n - 1] || String(n);
  const clips = (VOICE[character] || {}).count || [];
  if (clips[n - 1]) playVoice(clips[n - 1], character);
  return text;
}
