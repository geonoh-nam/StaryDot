// oneshot 파이프라인이 내놓은 활동을 앱이 그릴 수 있는 payload 로 바꾼다.
//
// 파이프라인은 문제와 선택지 글자만 만든다. 화면 색은 만들지 않는다 — 파이프라인
// 스키마와 검증 가드를 화면 장식 때문에 고칠 이유가 없기 때문이다. 그래서 색은
// 여기서 붙인다.
//
// 계약은 docs/파이프라인_서버_접합_명세.md 참조.

// 선택지 배경으로 돌려 쓰는 팔레트. 글자 내용과 무관한 장식이다.
export const PALETTE = [
  { color: '#f0ae03', bg: '#fffaf0' },
  { color: '#9b5de5', bg: '#f6f0ff' },
  { color: '#00CFE9', bg: '#f1fdff' },
  { color: '#e24e9e', bg: '#fff4fa' },
];

// 색을 묻는 활동에서는 색이 장식이 아니라 문제 자체다. "노란색"이라고 적힌 선택지가
// 보라색으로 칠해지면 아이는 무엇을 고르라는 건지 알 수 없다. 그래서 이 유형만은
// 팔레트를 돌리지 않고 이름에 맞는 색을 쓴다.
//
// 이름 목록은 파이프라인이 쓰는 것과 같아야 한다 (oneshot 의 COLOR_PALETTE).
// 여기 없는 이름이 오면 조용히 넘어가지 않고 실패한다 — 틀린 색으로 칠한 문제를
// 아이에게 내보내는 것보다 활동 하나를 잃는 편이 낫다.
export const COLOR_SWATCHES = {
  빨간색: { color: '#e03131', bg: '#fff5f5' },
  주황색: { color: '#f76707', bg: '#fff4e6' },
  노란색: { color: '#f0ae03', bg: '#fffaf0' },
  초록색: { color: '#2f9e44', bg: '#f0fff4' },
  파란색: { color: '#1c7ed6', bg: '#f1f8ff' },
  보라색: { color: '#9b5de5', bg: '#f6f0ff' },
  분홍색: { color: '#e24e9e', bg: '#fff4fa' },
  갈색:   { color: '#8b5a2b', bg: '#faf5f0' },
  검은색: { color: '#343a40', bg: '#f4f4f5' },
  하얀색: { color: '#adb5bd', bg: '#ffffff' },
  회색:   { color: '#868e96', bg: '#f5f5f5' },
};

// 선택지 글자가 곧 색 이름인 활동. 늘어나면 여기 추가한다.
export const COLOR_TEMPLATES = new Set(['색_찾기']);

export function swatchFor(template, label, index) {
  if (!COLOR_TEMPLATES.has(template)) return PALETTE[index % PALETTE.length];
  const swatch = COLOR_SWATCHES[label];
  if (!swatch) {
    throw new Error(
      `${template}: 색 이름 "${label}" 에 맞는 색상값이 없습니다. ` +
      `server/activity-payload.js 의 COLOR_SWATCHES 에 추가하세요 ` +
      `(등록된 이름: ${Object.keys(COLOR_SWATCHES).join(', ')})`
    );
  }
  return swatch;
}

// oneshot 활동 하나 → DB activity 행 하나.
export function toActivityRow(activity) {
  const template = activity.activity_template;
  return {
    at_sec: Math.round(activity.timestamp_sec),
    type: 'quiz',
    payload: {
      activity_template: template,
      title: activity.question,
      options: activity.options.map((label, i) => ({ label, ...swatchFor(template, label, i) })),
      answer: activity.answer,
      audioUrl: null,
      scene_description: activity.scene_description ?? null,
      why_here: activity.why_here ?? null,
    },
  };
}
