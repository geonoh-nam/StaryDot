// The hint ladder. A child who cannot solve it loses interest fast, so the buddy takes over
// at HINT_SOLVE rather than leaving them stuck.
export const HINT_LOOK = 8000;
export const HINT_HOP = 16000;
export const HINT_SOLVE = 24000;

export function hintLevel(elapsedMs) {
  if (elapsedMs >= HINT_SOLVE) return 3;
  if (elapsedMs >= HINT_HOP) return 2;
  if (elapsedMs >= HINT_LOOK) return 1;
  return 0;
}

// Did the child speak? Not what they said — see the spec. A toddler saying "아과" for "사과"
// is normal, and scoring it would mark healthy speech wrong. Real speech dips below the floor
// for a sample or two at plosives and breaths, so a short dip (<= gapMs) doesn't reset the run.
export function speechPassed(samples, opts = {}) {
  const floor = opts.floor ?? -35;
  const holdMs = opts.holdMs ?? 400;
  const gapMs = opts.gapMs ?? 150;
  let since = null;
  let silenceStart = null;
  for (const s of samples) {
    if (s.db >= floor) {
      silenceStart = null;
      if (since === null) since = s.atMs;
      if (s.atMs - since >= holdMs) return true;
    } else if (since !== null) {
      if (silenceStart === null) silenceStart = s.atMs;
      if (s.atMs - silenceStart > gapMs) {
        since = null;
        silenceStart = null;
      }
    }
  }
  return false;
}
