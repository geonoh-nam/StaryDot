const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function wheelLayout(width, height, holes, inline, reserveDock = false) {
  const size = Math.min(clamp(height * 0.16, 60, 92), (width - 48) / Math.max(holes.length, 1) - 12);
  // 겹쳐 놓을 때는 판이 화면을 통째로 쓴다. 조각 줄 몫을 미리 빼면 판이 그만큼 작아져
  // 영상이 앉아 있던 자리와 어긋난다 — 조각은 판 위에 겹쳐 놓는다.
  const boardHeight = inline ? height : height - 164;
  // 겹쳐 놓을 때는 영상이 앉았던 칸을 그대로 메운다 — 남는 띠 없이 화면이 이어진다.
  const fit = inline
    ? Math.max(0.01, Math.max(width / 940, boardHeight / 529))
    : Math.max(0.01, Math.min(width / 940, boardHeight / 529));
  const board = { w: 940 * fit, h: 529 * fit };
  board.x = (width - board.w) / 2;
  board.y = inline ? (boardHeight - board.h) / 2 : 58;
  const gap = 16;
  const dockWidth = holes.length * (size + gap) + gap;
  const dock = { x: (width - dockWidth) / 2, y: height - size - 20, w: dockWidth, h: size + 16 };
  const homes = holes.map((_, i) => ({ x: dock.x + gap + i * (size + gap), y: dock.y + 8 }));
  const targets = holes.map((h) => ({
    x: board.x + (h.x + h.w / 2) * fit - size / 2,
    y: board.y + (h.y + h.h / 2) * fit - size / 2,
  }));
  return { fit, board, size, dock, homes, targets, snap: clamp(64 * fit, 32, 72) };
}

// Find the nearest open slot before accepting a drop; nearby wrong slots must not count.
export function nearestWheelSlot(position, targets, placed, radius) {
  let nearest = -1;
  let distance = radius;
  targets.forEach((target, i) => {
    if (placed[i]) return;
    const d = Math.hypot(position.x - target.x, position.y - target.y);
    if (d < distance) { nearest = i; distance = d; }
  });
  return nearest;
}
