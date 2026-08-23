// What the child can watch, and how each series dresses its screen.
// Art paths are relative to this folder, one level below the app root.

// Card art, colours and the character's line stay in the app; the server owns the episodes.
export const SERIES_ART = {
  teenieping: { topic: '내가 좋아하는 티니핑', color: '#ff5fa2', tint: '#fff0f6', accent: '#e0327c', line: '“같이보자츄~”', thumb: require('../assets/characters/thumbs/thumb1.png') },
  tayo: { topic: '내가 타고 싶은 자동차', color: '#2b7fd7', tint: '#eef5ff', accent: '#1b5fae', line: '“꼬마버스 타요, 출발합니다!”', thumb: require('../assets/characters/thumbs/thumb2.png') },
  bread: { topic: '맛있는 빵', color: '#f5c33b', tint: '#fffaec', accent: '#a8760c', line: '“어서 오세요, 브레드이발소!”', thumb: require('../assets/characters/thumbs/thumb6.png') },
  shark: { topic: '바다 친구들', color: '#7c5cff', tint: '#f3f0ff', accent: '#ffb703', line: '“아기 상어 뚜루루 뚜루~”', thumb: require('../assets/characters/thumbs/thumb4.png') },
  pororo: { topic: '눈 내리는 날', color: '#e5484d', tint: '#fff1f0', accent: '#1f6fd0', line: '“노는 게 제일 좋아!”', thumb: require('../assets/characters/thumbs/thumb5.png') },
};

// Thumbnail frames (from the demo video for now; per-video thumbnails come with the DB).
export const THUMBS = [
  require('../assets/thumbs/t1.jpg'),
  require('../assets/thumbs/t2.jpg'),
  require('../assets/thumbs/t3.jpg'),
  require('../assets/thumbs/t4.jpg'),
  require('../assets/thumbs/t5.jpg'),
  require('../assets/thumbs/t6.jpg'),
  require('../assets/thumbs/t7.jpg'),
  require('../assets/thumbs/t8.jpg'),
];

// Mock video library. Shaped for a later DB swap: replace this array with a fetch
// that returns the same { id, label, videos:[{ id, title, duration, emoji, color }] }.
export const LIBRARY = [
  {
    id: 'popular',
    label: '인기',
    videos: [
      // Each series carries its own palette: card colour, the tint its screen washes over, and the
      // accent used for chips and headings, so the mood changes with the character.
      { id: 'pop-teenieping', title: '캐치 티니핑', duration: '4기 베리 하츄핑', color: '#ff5fa2', tint: '#fff0f6', accent: '#e0327c', line: '“같이보자츄~”', thumb: require('../assets/characters/thumbs/thumb1.png') },
      { id: 'pop-tayo', title: '꼬마버스 타요', duration: '용감한 소방차 이야기', color: '#2b7fd7', tint: '#eef5ff', accent: '#1b5fae', line: '“꼬마버스 타요, 출발합니다!”', thumb: require('../assets/characters/thumbs/thumb2.png') },
      { id: 'pop-bread', title: '브레드이발소', duration: '오늘도 손님이 와요', color: '#f2a65a', tint: '#fff6ec', accent: '#a55b1e', line: '“어서 오세요, 브레드이발소!”', artScale: 0.86, thumb: require('../assets/characters/thumbs/thumb6.png') },
      { id: 'pop-shark', title: '핑크퐁 아기상어', duration: '상어 가족과 노래해요', color: '#7c5cff', tint: '#f3f0ff', accent: '#ffb703', line: '“아기 상어 뚜루루 뚜루~”', thumb: require('../assets/characters/thumbs/thumb4.png') },
      { id: 'pop-pororo', title: '뽀롱뽀롱 뽀로로', duration: '뽀로로 인기 에피소드', color: '#e5484d', tint: '#fff1f0', accent: '#1f6fd0', line: '“노는 게 제일 좋아!”', thumb: require('../assets/characters/thumbs/thumb5.png') },
    ],
  },
  {
    id: 'story',
    label: '동화',
    videos: [
      { id: 'story-hachu-whale', title: '사랑의 하츄핑: 고래보석의 전설', duration: '5:00', emoji: '🐳', color: '#dbeafe' },
      { id: 'story-rabbit-moon', title: '달나라로 간 토끼', duration: '4:20', emoji: '🌙', color: '#ede9fe' },
      { id: 'story-three-pigs', title: '아기 돼지 삼형제', duration: '6:10', emoji: '🐷', color: '#ffe4ef' },
      { id: 'story-red-hood', title: '빨간 모자와 늑대', duration: '5:40', emoji: '🧺', color: '#fee2e2' },
      { id: 'story-golden-axe', title: '금도끼 은도끼', duration: '3:50', emoji: '🪓', color: '#fef3c7' },
    ],
  },
  {
    id: 'animal',
    label: '자연·동물',
    videos: [
      { id: 'animal-baby-shark', title: '아기 상어와 바다 친구들', duration: '3:20', emoji: '🦈', color: '#609EF5' },
      { id: 'animal-zoo-trip', title: '동물원 나들이', duration: '4:00', emoji: '🦁', color: '#fff0b8' },
      { id: 'animal-forest-friends', title: '숲속 친구들의 하루', duration: '5:15', emoji: '🦊', color: '#dcfce7' },
      { id: 'animal-penguin-ice', title: '펭귄의 남극 모험', duration: '4:45', emoji: '🐧', color: '#e0f2fe' },
    ],
  },
  {
    id: 'song',
    label: '노래·율동',
    videos: [
      { id: 'song-rainbow-play', title: '무지개 색깔 놀이', duration: '2:50', emoji: '🌈', color: '#ffe4ef' },
      { id: 'song-clap-hands', title: '손뼉 치며 노래해요', duration: '2:30', emoji: '👏', color: '#fef3c7' },
      { id: 'song-twinkle-star', title: '반짝반짝 작은 별', duration: '3:10', emoji: '⭐', color: '#e0e7ff' },
      { id: 'song-bus-wheels', title: '빙글빙글 버스 바퀴', duration: '2:40', emoji: '🚌', color: '#dbeafe' },
      { id: 'song-dino-dance', title: '아기 공룡 율동 대회', duration: '3:30', emoji: '🦕', color: '#dcfce7' },
    ],
  },
  {
    id: 'learn',
    label: '숫자·한글',
    videos: [
      { id: 'learn-number-quest', title: '숫자 세기 모험', duration: '4:10', emoji: '🔢', color: '#e0f2fe' },
      { id: 'learn-hangul-start', title: '가나다 첫걸음', duration: '5:00', emoji: '🔤', color: '#ede9fe' },
      { id: 'learn-shape-hunt', title: '동그라미 세모 네모', duration: '3:40', emoji: '🔺', color: '#fef3c7' },
      { id: 'learn-color-name', title: '색깔 이름 배우기', duration: '3:00', emoji: '🎨', color: '#ffe4ef' },
    ],
  },
  {
    id: 'play',
    label: '놀이',
    videos: [
      { id: 'play-hide-seek', title: '숨바꼭질 놀이터', duration: '4:30', emoji: '🙈', color: '#fff0b8' },
      { id: 'play-block-castle', title: '블록으로 성 쌓기', duration: '5:20', emoji: '🧱', color: '#dbeafe' },
      { id: 'play-clay-friends', title: '점토로 친구 만들기', duration: '4:00', emoji: '🧸', color: '#ffe4ef' },
      { id: 'play-water-splash', title: '물놀이 첨벙첨벙', duration: '3:50', emoji: '💦', color: '#609EF5' },
    ],
  },
];
