// The grown-up's report. These numbers are mock until the server computes them; the shape
// is what a real one will fill.

// The grown-up's view: a month of weeks down the left, what happened in the middle, and what the
// child kept coming back to on the right.
export const PARENT_WEEKS = ['1주 주간 리포트', '2주 주간 리포트', '3주 주간 리포트', '4주 주간 리포트'];

// Pictures for the topics the pipeline surfaces most often.
// The three pictures the "moments" cards wear, one per kind of growth.
export const MOMENT_ART = {
  puzzle: require('../assets/scenes/moment-puzzle.png'),
  talk: require('../assets/scenes/moment-talk.png'),
  paint: require('../assets/scenes/moment-paint.png'),
};

export const STAT_ART = {
  book: require('../assets/scenes/stat-book.png'),
  quiz: require('../assets/scenes/stat-quiz.png'),
  puzzle: require('../assets/scenes/stat-puzzle.png'),
  paint: require('../assets/scenes/stat-paint.png'),
};

export const INTEREST_ART = {
  '공룡': require('../assets/scenes/interest-dino.png'),
  '요리': require('../assets/scenes/interest-cook.png'),
  '우주 · 행성': require('../assets/scenes/interest-planet.png'),
};

export const MOCK_REPORT = [
  {
    minutes: [12, 26, 18, 31, 15, 34, 25],
    stats: { stories: 10, quiz: 16, puzzle: 7, drawing: 4 },
    deltas: { stories: 2, quiz: 5, puzzle: 4, drawing: -2 },
    interests: ['공룡', '요리', '우주 · 행성'],
    moments: [
      { tag: '퍼즐 완주 횟수 증가', lead: '끈기 있게 끝까지', head: ' 도전했어요',
        body: '포기하지 않고 퍼즐을 끝까지 완료한 비율이\n지난주보다 올랐어요', art: MOMENT_ART.puzzle },
      { tag: '이야기 설명 비중 증가', lead: '이유를 설명하는 표현', head: '이 늘었어요',
        body: "이번 주 이야기 속에서 '왜냐하면'처럼 이유를\n설명하는 말이 지난주보다 늘었어요", art: MOMENT_ART.talk },
      { tag: '그림 활동 창의성 및 탐구 증가', lead: '다양하게', head: ' 표현했어요',
        body: '그림에 사용한 색이나 모양의 종류가\n지난주보다 훨씬 다양해졌어요', art: MOMENT_ART.paint },
    ],
    sessions: [
      { from: 10.3, to: 11, span: '10:20 - 11:00', title: '사랑의 하츄핑', words: ['테올데굴', '따뜻하다'] },
      { from: 4.5, to: 5, span: '4:30 - 5:00', title: '아기상어', words: ['아푸어푸'] },
    ],
  },
  {
    minutes: [20, 14, 28, 9, 33, 27, 18],
    stats: { stories: 8, quiz: 21, puzzle: 5, drawing: 6 },
    deltas: { stories: -2, quiz: 5, puzzle: -2, drawing: 2 },
    interests: ['바다 생물', '공룡', '색깔'],
    moments: null,
    sessions: [
      { from: 9.5, to: 10.2, span: '9:30 - 10:10', title: '꼬마버스 타요', words: ['부릉부릉', '신호등'] },
      { from: 7, to: 7.5, span: '7:00 - 7:30', title: '브레드이발소', words: ['말랑말랑'] },
    ],
  },
  {
    minutes: [16, 22, 11, 24, 29, 13, 30],
    stats: { stories: 12, quiz: 18, puzzle: 9, drawing: 3 },
    deltas: { stories: 4, quiz: -3, puzzle: 4, drawing: -3 },
    interests: ['숫자', '동물 친구', '노래'],
    moments: null,
    sessions: [
      { from: 11, to: 11.5, span: '11:00 - 11:30', title: '핑크퐁 아기상어', words: ['뚜루루'] },
      { from: 5, to: 5.7, span: '5:00 - 5:40', title: '뽀롱뽀롱 뽀로로', words: ['미끄럼틀', '눈사람'] },
    ],
  },
  {
    minutes: [9, 19, 25, 17, 21, 36, 28],
    stats: { stories: 11, quiz: 24, puzzle: 6, drawing: 5 },
    deltas: { stories: -1, quiz: 6, puzzle: -3, drawing: 2 },
    interests: ['우주 · 행성', '요리', '탈것'],
    moments: null,
    sessions: [
      { from: 10, to: 10.6, span: '10:00 - 10:35', title: '캐치 티니핑', words: ['반짝반짝', '모자'] },
      { from: 6.5, to: 7, span: '6:30 - 7:00', title: '꼬마버스 타요', words: ['출발'] },
    ],
  },
];
