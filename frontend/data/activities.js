// The activity plan that ships with the app, used when the content server has nothing to say.
// Activity plans ship with the app too, so a tablet with no server still asks real questions.
export const OFFLINE_ACTIVITIES = require('../assets/activities.json');

// Announcement shown right before each activity starts.
export const ACT_MSG = {
  quiz: { text: '같이 퀴즈 풀어볼까?', emoji: '🧠' },
  puzzle: { text: '퍼즐 맞춰볼까?', emoji: '🧩' },
  wheels: { text: '같이 퍼즐 맞춰볼까?', emoji: '🧩' },
  traceword: { text: '같이 따라 써 보자!', emoji: '✏️' },
  findit: { text: '숨은 그림을 찾아보자!', emoji: '🔍' },
  drag: { text: '제자리로 옮겨볼까?', emoji: '📦' },
  count: { text: '몇 개인지 세어보자!', emoji: '🔢' },
  say: { text: '소리 내어 말해볼까?', emoji: '🗣️' },
};
