// What the child can watch, and how each series dresses its screen.
// Art paths are relative to this folder, one level below the app root.

// Card art, colours and the character's line stay in the app; the server owns the episodes.
export const SERIES_ART = {
  teenieping: { voice: 'bunny', topics: ['나만의 티니핑'], style: 'high-quality 3D animation style: a two-to-three-heads-tall character with a big head on a small body, round soft shapes, a pastel palette led by pink, mint and sky blue, big sparkling eyes, smooth toy-like surfaces, soft lighting and gentle shadows, with a softly blurred pastel background behind the character. Not photorealistic, not a flat illustration', color: '#ff5fa2', tint: '#fff0f6', accent: '#e0327c', line: '“같이보자츄~”', thumb: require('../assets/characters/thumbs/thumb1.png') },
  tayo: { voice: 'dino', topics: ['타요', '버스', '소방차', '경찰차', '신호등'], style: 'bright 3D toy-vehicle cartoon style: rounded plastic surfaces, primary blues and yellows, clean even lighting, simple city background', color: '#2b7fd7', tint: '#eef5ff', accent: '#1b5fae', line: '“꼬마버스 타요, 출발합니다!”', thumb: require('../assets/characters/thumbs/thumb2.png') },
  bread: { topics: ['브레드', '내가 만든 빵', '이발소 친구들'], style: 'soft claymation-like 3D style: warm bakery browns and creams, doughy rounded shapes, cosy shop lighting', color: '#f5c33b', tint: '#fffaec', accent: '#a8760c', line: '“어서 오세요, 브레드이발소!”', thumb: require('../assets/characters/thumbs/thumb6.png') },
  shark: { topics: ['아기상어', '바닷속 친구들', '우리 가족'], style: 'flat vector cartoon style: bold clean outlines, saturated ocean blues and yellows, simple shapes, no gradients', color: '#7c5cff', tint: '#f3f0ff', accent: '#ffb703', line: '“아기 상어 뚜루루 뚜루~”', thumb: require('../assets/characters/thumbs/thumb4.png') },
  pororo: { topics: ['뽀로로', '눈사람', '내 친구 크롱'], style: 'rounded 3D CG cartoon style: chunky characters, snowy pastel palette, soft blue shadows on white snow', color: '#e5484d', tint: '#fff1f0', accent: '#1f6fd0', line: '“노는 게 제일 좋아!”', thumb: require('../assets/characters/thumbs/thumb5.png') },
};

// Whose voice speaks over the questions. The buddy on screen is the series hero, but the
// recordings are our two characters, so each series picks the one it sounds like.
export const voiceFor = (seriesId) => SERIES_ART[seriesId]?.voice || 'bunny';

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

// The stand-in video the demo falls back to when nothing has been picked.
export const DEMO_VIDEO = {
  title: '전설의 고래와 용기 이야기',
  duration: '1:30',
  captions: [
    '로미 곁엔 내가 있어 츄!',
    '너무 위험해',
    '한바탕해 볼까',
    '그 마음은 잃지 않았으면 좋겠어',
  ],
};

// 주제마다 그림체를 한 번 더 좁힌다. 시리즈 화풍만으로는 "소방차"가 그냥 빨간 차로 나온다.
// 캐릭터로 그려야 하는 주제. 자동차·눈사람 같은 사물은 아이 선을 그대로 다듬기만 해도
// 알아볼 수 있지만, 캐릭터는 얼굴·눈·비율이 맞아야 그 캐릭터로 보인다 — 선을 지키는 데만
// 매달리면 아이가 그린 낙서가 그대로 남는다.
export const CHARACTER_TOPICS = new Set([
  '타요', '나만의 티니핑', '하츄핑', '뽀로로', '내 친구 크롱',
  '아기상어', '바닷속 친구들', '브레드', '이발소 친구들',
]);

export const TOPIC_STYLE = {
  '타요': 'a friendly blue city bus with a big cartoon face on its windshield, round headlight eyes, number 120 on the front',
  '버스': 'a chunky cartoon city bus with a face on the windshield, bright primary paint, rounded toy proportions',
  '소방차': 'a bright red cartoon fire engine with a ladder on its roof, a face on the windshield, hoses and silver fittings',
  '경찰차': 'a white and blue cartoon police car with a light bar on the roof, a face on the windshield, clean rounded body',
  '신호등': 'a friendly cartoon traffic light standing on a pavement, three round lamps glowing red, yellow and green, simple city street behind',
  // 티니핑은 종마다 머리 장식과 몸 색만 다르고 몸매·눈·가슴 보석은 같은 틀을 쓴다.
  '하츄핑': 'a Teenieping creature: a chubby roly-poly body where the head is more than half the whole figure, no neck, short stubby arms and no visible legs, an enormous pair of round glossy eyes taking up most of the face with two or three white catchlights and a soft colour gradient in the iris, a very small simple mouth, faint blush on the cheeks, a small golden flame-shaped gem glowing on the chest. This one is Hearttsyping: soft pink body, a large curled pink heart-shaped tuft of hair on top of the head, long pink ears hanging down',
  // 공식 캐릭터를 보고 적었다. 한 번 "화풍과 겹친다"며 지웠더니 사람 아기가 나왔으므로
  // 목·몸통·눈 배치까지 남겨 둔다.
  '나만의 티니핑': 'a brand-new Teenieping — a palm-sized magical creature, NOT a human child and not a doll in clothes. Body: head and body are one smooth teardrop-shaped mass with no neck and no clothing, widest at the head and tapering gently to the bottom, in one soft pastel colour with a glossy vinyl sheen. Two tiny stubby arms with rounded ends and no fingers, and two very short rounded legs with simple rounded feet. Face: the eyes sit in the lower half of the head and are enormous — tall glossy ovals about a third of the head wide, with large warm irises, two or three big white catchlights and a few short lashes above them. A tiny dot of a nose between them. A small smiling mouth just below, pink inside when open. Soft round blush on the cheeks. Above the eyes is a wide empty forehead, and on top of the head one big soft ornament like ears, a ribbon or a curl. Take only the body colour and the shape of that head ornament from the child drawing',
  '뽀로로': 'a small round penguin in blue aviator goggles and a pilot cap, standing on snow',
  '눈사람': 'a plump snowman with a carrot nose and a knitted scarf, soft snowy light',
  '아기상어': 'a cheerful yellow baby shark with big friendly eyes, underwater with bubbles',
  '브레드': 'a slice of bread character with a face, standing in a cosy bakery',
};
