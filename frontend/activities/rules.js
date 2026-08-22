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

// Everything is a 0..1 fraction of the stage, so a different screen size changes nothing.
export function isHit(point, target) {
  const dx = point.x - target.x;
  const dy = point.y - target.y;
  return Math.hypot(dx, dy) <= target.r;
}

// Did the child speak? Not what they said — see the spec. A toddler saying "아과" for "사과"
// is normal, and scoring it would mark healthy speech wrong.
export function speechPassed(samples, opts = {}) {
  const floor = opts.floor ?? -35;
  const holdMs = opts.holdMs ?? 400;
  let since = null;
  for (const s of samples) {
    if (s.db >= floor) {
      if (since === null) since = s.atMs;
      if (s.atMs - since >= holdMs) return true;
    } else {
      since = null;
    }
  }
  return false;
}
