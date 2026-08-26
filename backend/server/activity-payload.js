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
  // storydot 파이프라인(visual.py)은 접미사 없는 짧은 이름을 쓴다. 같은 색을 두 번
  // 적는 대신 위 항목을 가리키게 두면 한쪽만 고쳐지는 사고가 난다 — 아래에서 파생시킨다.
};

// 짧은 이름 → 위에서 이미 정한 색. 사람이 색을 고칠 자리는 위 표 하나뿐이다.
for (const [short, full] of Object.entries({
  빨강: '빨간색', 주황: '주황색', 노랑: '노란색', 초록: '초록색', 파랑: '파란색',
  보라: '보라색', 분홍: '분홍색', 검정: '검은색', 하양: '하얀색',
})) {
  COLOR_SWATCHES[short] = COLOR_SWATCHES[full];
}

// 선택지 글자가 곧 색 이름인 활동. 늘어나면 여기 추가한다.
export const COLOR_TEMPLATES = new Set(['색_찾기', '색깔 퀴즈']);

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

// ---------------------------------------------------------------- storydot 파이프라인

// storydot 의 generate3.py(`work/<작품>_final.json`)가 내놓는 마무리 활동 하나 → DB activity 행.
//
// generate3 은 **영상이 끝난 뒤** 화면과 함께 내는 문항을 만든다. 그래서 문항마다 프레임이
// 딸려 온다 — "이 그림에 버스가 몇 대 있나요?"는 그림이 없으면 풀 수 없는 문제다.
// framePath 가 없으면 만들지 않는다. 그림 없는 화면을 아이에게 내보내는 것보다 문항 하나를
// 잃는 편이 낫다.
export function toStorydotRow(activity, framePath) {
  if (!Array.isArray(activity.choices) || activity.choices.length < 2) {
    throw new Error(`${activity.fact_id}: 선택지가 없습니다 (창의 문항은 호출부가 먼저 걸러야 합니다)`);
  }
  if (activity.answer == null) {
    throw new Error(`${activity.fact_id}: 정답이 없습니다 (창의 문항은 호출부가 먼저 걸러야 합니다)`);
  }
  if (!activity.choices.includes(activity.answer)) {
    throw new Error(`${activity.fact_id}: 정답 "${activity.answer}" 이 선택지에 없습니다`);
  }
  if (!framePath) {
    throw new Error(`${activity.fact_id}: 프레임이 없습니다`);
  }

  const row = toActivityRow({
    activity_template: activity.type,
    question: activity.prompt,
    options: activity.choices,
    answer: activity.answer,
    timestamp_sec: activity.t,
    why_here: activity.curriculum ?? null,
  });
  // 문항이 근거로 삼은 화면. 브레이크 화면이 문제와 같이 띄운다.
  row.payload.framePath = framePath;
  // 보호자 리포트가 "무엇을 길렀는가"를 말할 수 있게 누리과정 영역·연령을 함께 남긴다.
  row.payload.domain = activity.domain ?? null;
  row.payload.age = activity.age ?? null;
  row.payload.fact_id = activity.fact_id ?? null;
  return row;
}
