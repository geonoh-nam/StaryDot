// The star's world: what it can grow into, what it can wear, and where it can stand.

// The child's own star: quizzes earn food, feeding it makes the star grow.
// One candy is one percent, and the star changes shape at each checkpoint.
export const GROWTH_CHECKPOINTS = [0, 50, 100];

export const GROWTH_PER_CANDY = 20;

// Backdrops the child can switch between; drawn as a gradient so no art has to ship.
export const SCENES = [
  { id: 'space', label: '우주', sky: '#0d1b3e', ground: '#1b2f63', image: require('../assets/scenes/space.png') },
  { id: 'sky', label: '하늘', sky: '#7cc4f5', ground: '#d9eeff', image: require('../assets/scenes/sky.png') },
  { id: 'sea', label: '바다', sky: '#0a4f7a', ground: '#23a6c9', image: require('../assets/scenes/sea.png') },
  { id: 'forest', label: '숲', sky: '#1f5c3a', ground: '#69b06a', image: require('../assets/scenes/forest.png') },
  { id: 'room', label: '방', sky: '#f4e2c8', ground: '#d9b98d', image: require('../assets/scenes/room.png') },
];

// Fixed sprinkle, so the sky does not reshuffle on every render.
// What the closet holds: the outfit on its hanger, and who the star becomes wearing it.
export const COSTUMES = [
  { id: 1, icon: require('../assets/costumes/costume1.png'), dino: require('../assets/costumes/newdino1.png'), bunny: require('../assets/costumes/newbunny1.png') },
  { id: 2, icon: require('../assets/costumes/costume2.png'), dino: require('../assets/costumes/newdino2.png'), bunny: require('../assets/costumes/newbunny2.png') },
  { id: 3, icon: require('../assets/costumes/costume3.png'), dino: require('../assets/costumes/newdino3.png'), bunny: require('../assets/costumes/newbunny3.png') },
  { id: 4, icon: require('../assets/costumes/costume4.png'), dino: require('../assets/costumes/newdino4.png'), bunny: require('../assets/costumes/newbunny4.png') },
  { id: 5, icon: require('../assets/costumes/costume5.png'), dino: require('../assets/costumes/newdino5.png'), bunny: require('../assets/costumes/newbunny5.png') },
];

export const CANDY_ICON = require('../assets/scenes/candy.png');

export const CLOSET_ICON = require('../assets/scenes/closet.png');

export const STAR_FIELD = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 61) % 70,
  r: 1 + ((i * 7) % 3) * 0.7,
  o: 0.4 + ((i * 13) % 5) * 0.12,
}));

// The star the child starts with, and the two it can become once the bar is full.
export const STAGE1_ART = require('../assets/characters/stage1.png');

export const EVOLUTIONS = [
  { id: 'dino', label: '아기 공룡', art: require('../assets/characters/stage2-dino.png'), grown: require('../assets/characters/stage3-dino.png') },
  { id: 'bunny', label: '아기 토끼', art: require('../assets/characters/stage2-bunny.png'), grown: require('../assets/characters/stage3-bunny.png') },
];

// Two full bars: the first picks a path, the second grows that path up.
export const FULL_BAR = 100;

// The three faces the drawing screen and the growth chooser both draw.
// Growth stages: everyone starts as the star, then becomes the species the child picked.
export const CHARACTER_IMAGES = {
  star: require('../assets/characters/star.png'),
  rabbit: require('../assets/characters/rabbit2.png'),
  dino: require('../assets/characters/dino2.png'),
};
