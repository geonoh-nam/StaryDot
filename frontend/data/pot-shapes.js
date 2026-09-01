// Native coordinates in the unmodified 1920x1080 frame at 285.77s.
// One contour defines both the empty slot and the draggable image clip.
export const POT_SHAPES = [
  {
    id: 'lilac',
    crop: { x: 720, y: 370, w: 90, h: 65 },
    outline: 'M6 5 Q45 -1 84 6 C90 10 85 49 80 62 Q45 65 8 62 C3 43 0 13 6 5 Z',
  },
  {
    id: 'white',
    crop: { x: 609, y: 670, w: 95, h: 101 },
    outline: 'M1 5 Q47 -1 93 5 L89 19 L81 98 Q46 102 13 98 L5 21 Z',
  },
  {
    id: 'bowl',
    crop: { x: 1706, y: 690, w: 127, h: 85 },
    outline: 'M3 6 Q60 -1 124 5 C130 24 119 60 103 75 Q65 89 31 77 C12 65 -1 25 3 6 Z',
  },
].map((hole) => ({
  ...hole,
  x: hole.crop.x * 940 / 1920,
  y: hole.crop.y * 529 / 1080,
  w: hole.crop.w * 940 / 1920,
  h: hole.crop.h * 529 / 1080,
}));
