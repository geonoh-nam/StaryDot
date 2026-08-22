# 활동 중 캐릭터 상호작용 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영상 중간 활동을 캐릭터가 진행하게 만들고, 몸으로 참여하는 활동 4종(찾아 짚기·끌어다 놓기·세어보기·따라 말하기)을 넣는다.

**Architecture:** 공용 뼈대 `ActivityStage`가 캐릭터(`Buddy`)와 힌트 사다리를 소유하고, 활동 4종은 `buddy` 손잡이로 캐릭터에게 명령만 내린다. 판정·타이밍 같은 순수 로직은 RN을 import하지 않는 별도 모듈(`lines.js`, `rules.js`)로 빼서 node로 검증한다. 목소리 파일과 활동 콘텐츠가 없어도 전 구간이 동작한다.

**Tech Stack:** React Native (Expo SDK 54), react-native-gesture-handler, RN Animated, expo-audio 57, node:assert (Node 22)

## Global Constraints

- 좌표는 전부 **0~1 비율**. 픽셀 좌표를 payload나 컴포넌트 인터페이스에 쓰지 않는다.
- **목소리 파일이 하나도 없어도** 활동 4종이 끝까지 진행돼야 한다. 파일 없으면 말풍선 글자만 나간다.
- **오답 처리가 없다.** 빗나감은 무반응/제자리 복귀로만 표현하고, "틀렸어" 문구를 어디에도 쓰지 않는다.
- 힌트 사다리는 **8초 / 16초 / 24초**, 24초에서 캐릭터가 대신 풀고 성공 처리한다.
- 캐릭터는 활동 시작 시 `bunny`/`dino` 중 하나를 뽑고 **그 활동이 끝날 때까지 바꾸지 않는다.**
- 반응 멘트는 **직전에 쓴 것을 제외**하고 뽑는다.
- 터치 타깃 최소 **110px**.
- 순수 로직 모듈(`lines.js`, `rules.js`)은 `react`/`react-native`를 **import하지 않는다.** node에서 그대로 돌아야 한다.
- 테스트는 저장소 기존 방식을 따른다 — `node:assert/strict` + 손수 만든 러너, `node <file>`로 실행. jest 등 새 의존성 추가 금지.
- 기존 `QuizOverlay`(16종 퀴즈)는 **건드리지 않고 남긴다.**

## 데이터 미도착 대응

목소리 46개와 활동 콘텐츠가 아직 없다. 계획은 이 둘에 **한 번도 막히지 않게** 배치했다.

- 목소리: Task 1이 만드는 `voice-index.js`는 지금 **빈 맵**이다. 파일이 도착하면 폴더에 넣고 `node backend/server/tools/voice-index.mjs` 한 번 돌리면 끝이고, 앱 코드는 손대지 않는다.
- 활동 콘텐츠: Task 6·7·8·10이 티니핑 1화용 payload를 **직접 작성**한다. 파이프라인 확장은 이 계획 범위 밖이다.

## File Structure

| 파일 | 책임 |
|---|---|
| `frontend/activities/lines.js` | 멘트 뽑기(직전 제외). 순수 함수 |
| `frontend/activities/rules.js` | 힌트 단계, 명중 판정, 발화 판정. 순수 함수 |
| `frontend/activities/test.js` | 위 두 모듈의 테스트 |
| `frontend/activities/voice.js` | 멘트+음성 재생 글루. `lines.json`·`voice-index.js`·`sound.js`를 묶는다 |
| `frontend/activities/Buddy.js` | 캐릭터 하나. 이동·반응 애니메이션과 말풍선만 안다 |
| `frontend/activities/ActivityStage.js` | 공용 뼈대. 캐릭터 선택, 힌트 사다리, 활동 4종 분기 |
| `frontend/activities/FindIt.js` | ① 찾아 짚기 |
| `frontend/activities/DragMatch.js` | ② 끌어다 놓기 |
| `frontend/activities/CountIt.js` | ③ 세어보기 |
| `frontend/activities/SayIt.js` | ④ 따라 말하기 |
| `frontend/assets/lines.json` | 멘트 데이터 (캐릭터 공용) |
| `frontend/assets/voice-index.js` | 생성물. 캐릭터별 음성 모듈 맵 |
| `backend/server/tools/voice-index.mjs` | `assets/voice/*/`를 훑어 위 파일을 생성 |
| `backend/server/tools/puzzle-frames.mjs` | 수정. `findit` 타입 프레임도 뽑는다 |
| `frontend/sound.js` | 수정. `return;` 제거, `playVoice(module)` 추가 |
| `frontend/App.js` | 수정. 트리거 분기에서 `ActivityStage`를 띄운다 |

**스펙과 다른 점 하나:** 스펙은 `lines.js`가 멘트 뽑기와 음성 재생을 모두 맡는다고 썼다. 재생은 RN 의존이라 node에서 테스트할 수 없으므로 순수 `lines.js`와 글루 `voice.js`로 나눈다.

---

### Task 1: 멘트 데이터와 뽑기 로직

**Files:**
- Create: `frontend/activities/lines.js`
- Create: `frontend/activities/test.js`
- Create: `frontend/assets/lines.json`
- Create: `frontend/assets/voice-index.js`
- Create: `backend/server/tools/voice-index.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `pickLine(pool: string[], last: string | null) => string | null`
  - `assets/lines.json` — 키에서 문자열 배열로 가는 객체
  - `assets/voice-index.js` — `export default { bunny: { 'answer.right': [mod, …] }, dino: {…} }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/activities/test.js`:

```js
import assert from 'node:assert/strict';
import { pickLine } from './lines.js';

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('pickLine never repeats the previous line', () => {
  const pool = ['가', '나', '다'];
  for (let i = 0; i < 200; i += 1) {
    assert.notEqual(pickLine(pool, '가'), '가');
  }
});

test('pickLine returns the only line when the pool has one', () => {
  assert.equal(pickLine(['혼자'], '혼자'), '혼자');
});

test('pickLine handles an empty pool', () => {
  assert.equal(pickLine([], null), null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok  ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}\n  ${e.message}`); }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && node activities/test.js`
Expected: FAIL — `Cannot find module './lines.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`frontend/activities/lines.js`:

```js
// Which line the buddy says next. Never the one it just said — a three-line pool that
// repeats reads like a single line.
export function pickLine(pool, last) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const rest = pool.filter((line) => line !== last);
  return rest[Math.floor(Math.random() * rest.length)];
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && node activities/test.js`
Expected: `ok` 3줄, 종료 코드 0

- [ ] **Step 5: 멘트 데이터를 쓴다**

`frontend/assets/lines.json`:

```json
{
  "quiz.ask": ["이건 뭘까?", "우리 같이 맞혀볼까?", "음~ 뭐지?"],
  "answer.right": ["우와 맞았어!", "역시 대단해!", "딩동댕!"],
  "answer.again": ["음~ 다시 볼까?", "거의 다 왔어!", "한 번만 더!"],
  "count": ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉", "열"],
  "count.done": ["다 셌다!", "우와 많다!"],
  "speak.listen": ["따라 해볼까?", "네 차례야!"],
  "speak.quiet": ["안 들렸어~ 한 번 더!", "조금만 크게!"],
  "hint.solved": ["여기 있었네!", "찾았다, 같이 하니까 쉽네!"]
}
```

- [ ] **Step 6: 빈 음성 맵을 만든다**

`frontend/assets/voice-index.js`:

```js
// Generated by backend/server/tools/voice-index.mjs — do not edit by hand.
// Empty until voice files land in assets/voice/<character>/. The app reads text-only
// until then, so a missing file is never an error.
export default { bunny: {}, dino: {} };
```

- [ ] **Step 7: 생성 도구를 쓴다**

`backend/server/tools/voice-index.mjs`:

```js
// Turns whatever sits in frontend/assets/voice/<character>/ into a require map.
// Metro cannot require a path it computes at runtime, so the map has to be written out.
//   node backend/server/tools/voice-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const VOICE = path.join(ROOT, 'frontend/assets/voice');
const OUT = path.join(ROOT, 'frontend/assets/voice-index.js');
const CHARACTERS = ['bunny', 'dino'];

const body = CHARACTERS.map((who) => {
  const dir = path.join(VOICE, who);
  if (!fs.existsSync(dir)) return `  ${who}: {},`;
  const byKey = {};
  for (const file of fs.readdirSync(dir).sort()) {
    const m = file.match(/^(.+)\.(\d+)\.m4a$/);
    if (!m) continue;
    (byKey[m[1]] ||= []).push(`require('./voice/${who}/${file}')`);
  }
  const keys = Object.entries(byKey)
    .map(([key, mods]) => `    '${key}': [${mods.join(', ')}],`)
    .join('\n');
  return keys ? `  ${who}: {\n${keys}\n  },` : `  ${who}: {},`;
}).join('\n');

fs.writeFileSync(
  OUT,
  `// Generated by backend/server/tools/voice-index.mjs — do not edit by hand.\n` +
    `export default {\n${body}\n};\n`
);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
```

- [ ] **Step 8: 도구가 빈 폴더에서도 도는지 확인한다**

Run: `node backend/server/tools/voice-index.mjs && cat frontend/assets/voice-index.js`
Expected: `wrote frontend/assets/voice-index.js`, 내용은 `bunny: {}`, `dino: {}`

- [ ] **Step 9: 커밋**

```bash
git add frontend/activities/lines.js frontend/activities/test.js \
        frontend/assets/lines.json frontend/assets/voice-index.js \
        backend/server/tools/voice-index.mjs
git commit -m "feat: buddy line pool and generated voice index"
```

---

### Task 2: 판정 규칙

**Files:**
- Create: `frontend/activities/rules.js`
- Modify: `frontend/activities/test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `hintLevel(elapsedMs: number) => 0 | 1 | 2 | 3`
  - `isHit(point: {x, y}, target: {x, y, r}) => boolean` — 전부 0~1 비율
  - `speechPassed(samples: {db: number, atMs: number}[], opts?: {floor: number, holdMs: number}) => boolean`
  - `HINT_LOOK = 8000`, `HINT_HOP = 16000`, `HINT_SOLVE = 24000`

- [ ] **Step 1: 실패하는 테스트를 붙인다**

`frontend/activities/test.js`의 `import { pickLine } …` 아래에 import를 추가하고, 러너(`let failed = 0;`) **앞에** 테스트를 붙인다:

```js
import { hintLevel, isHit, speechPassed, HINT_SOLVE } from './rules.js';

test('hintLevel climbs at 8, 16 and 24 seconds', () => {
  assert.equal(hintLevel(0), 0);
  assert.equal(hintLevel(7999), 0);
  assert.equal(hintLevel(8000), 1);
  assert.equal(hintLevel(15999), 1);
  assert.equal(hintLevel(16000), 2);
  assert.equal(hintLevel(HINT_SOLVE), 3);
  assert.equal(hintLevel(99000), 3);
});

test('isHit accepts a touch inside the target circle', () => {
  const target = { x: 0.5, y: 0.5, r: 0.1 };
  assert.equal(isHit({ x: 0.5, y: 0.5 }, target), true);
  assert.equal(isHit({ x: 0.58, y: 0.5 }, target), true);
  assert.equal(isHit({ x: 0.7, y: 0.5 }, target), false);
});

test('speechPassed needs the level held above the floor long enough', () => {
  const loudBriefly = [
    { db: -50, atMs: 0 },
    { db: -12, atMs: 100 },
    { db: -50, atMs: 300 },
  ];
  assert.equal(speechPassed(loudBriefly), false);

  const loudHeld = [
    { db: -50, atMs: 0 },
    { db: -12, atMs: 100 },
    { db: -10, atMs: 300 },
    { db: -14, atMs: 600 },
  ];
  assert.equal(speechPassed(loudHeld), true);
});

test('speechPassed ignores a silent room', () => {
  const quiet = [{ db: -60, atMs: 0 }, { db: -58, atMs: 500 }, { db: -61, atMs: 1000 }];
  assert.equal(speechPassed(quiet), false);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd frontend && node activities/test.js`
Expected: FAIL — `Cannot find module './rules.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`frontend/activities/rules.js`:

```js
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
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd frontend && node activities/test.js`
Expected: `ok` 7줄, 종료 코드 0

- [ ] **Step 5: 커밋**

```bash
git add frontend/activities/rules.js frontend/activities/test.js
git commit -m "feat: hint ladder, hit test and speech gate"
```

---

### Task 3: 음성 재생 글루

**Files:**
- Create: `frontend/activities/voice.js`
- Modify: `frontend/sound.js:28-50`

**Interfaces:**
- Consumes: `pickLine` (Task 1), `assets/lines.json`, `assets/voice-index.js`
- Produces:
  - `sayLine(character: 'bunny'|'dino', key: string, last: string|null) => string | null`
  - `sayCount(character: 'bunny'|'dino', n: number) => string`
  - `sound.js`의 `playVoice(mod: number) => void`

- [ ] **Step 1: `sound.js`의 차단을 푼다**

`frontend/sound.js`의 `speak`와 `speakUrl` 첫 줄 `return; // voice lines disabled`를 지운다. 그리고 `stopSpeaking` 위에 추가:

```js
// A voice line that arrives as a bundled module rather than a fixed name. Players are made
// on demand and thrown away — only one line plays at a time.
export function playVoice(mod) {
  if (!mod) return;
  try {
    if (urlPlayer) urlPlayer.remove();
    urlPlayer = createAudioPlayer(mod);
    urlPlayer.play();
  } catch (e) {
    // ignore playback races
  }
}
```

- [ ] **Step 2: 글루를 쓴다**

`frontend/activities/voice.js`:

```js
import LINES from '../assets/lines.json';
import VOICE from '../assets/voice-index.js';
import { playVoice } from '../sound';
import { pickLine } from './lines';

// One line: the words for the bubble, and the recording if we happen to have one. A missing
// recording is the normal case until the files land, so it is silent, not an error.
export function sayLine(character, key, last) {
  const pool = LINES[key] || [];
  const text = pickLine(pool, last);
  if (text === null) return null;
  const clips = (VOICE[character] || {})[key] || [];
  if (clips.length) {
    const idx = pool.indexOf(text);
    playVoice(clips[idx >= 0 && idx < clips.length ? idx : 0]);
  }
  return text;
}

// The counting voice is indexed, not random: "셋" must be the third clip.
export function sayCount(character, n) {
  const text = (LINES.count || [])[n - 1] || String(n);
  const clips = (VOICE[character] || {}).count || [];
  if (clips[n - 1]) playVoice(clips[n - 1]);
  return text;
}
```

- [ ] **Step 3: 번들이 깨지지 않는지 확인한다**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('activities/voice.js',{presets:[require.resolve('babel-preset-expo')]});console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 4: 커밋**

```bash
git add frontend/activities/voice.js frontend/sound.js
git commit -m "feat: play buddy lines, silent when no recording exists"
```

---

### Task 4: 캐릭터 컴포넌트

**Files:**
- Create: `frontend/activities/Buddy.js`

**Interfaces:**
- Consumes: `sayLine`, `sayCount` (Task 3)
- Produces: `<Buddy ref={…} character="bunny" stage={{w, h}} />` — ref로 노출되는 명령 넷
  - `say(key: string) => void` — `'count.n:3'` 꼴이면 세는 목소리로 간다
  - `moveTo(point: {x, y}) => void` (0~1 비율)
  - `home() => void`
  - `react('right' | 'again') => void`

- [ ] **Step 1: 컴포넌트를 쓴다**

`frontend/activities/Buddy.js`:

```js
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { sayCount, sayLine } from './voice';

const ART = {
  bunny: require('../assets/characters/bunny.png'),
  dino: require('../assets/characters/dino.png'),
};

const SIZE = 130;

// The buddy knows how to move, bounce and speak. It knows nothing about any activity — an
// activity tells it where to go, never how to draw itself.
const Buddy = forwardRef(function Buddy({ character, stage }, ref) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const hop = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const [bubble, setBubble] = useState(null);
  const lastLine = useRef(null);

  // Home is the middle of the bottom edge — the B frame from the spec.
  const HOME = { x: 0.5, y: 0.9 };

  const goTo = (point) => {
    Animated.spring(pos, {
      toValue: { x: point.x * stage.w - SIZE / 2, y: point.y * stage.h - SIZE / 2 },
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    }).start();
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 220, easing: Easing.bounce, useNativeDriver: true }),
    ]).start();
  };

  useImperativeHandle(ref, () => ({
    say(key) {
      const text = key.startsWith('count.n:')
        ? sayCount(character, Number(key.slice('count.n:'.length)))
        : sayLine(character, key, lastLine.current);
      if (text === null) return;
      lastLine.current = text;
      setBubble(text);
    },
    moveTo: goTo,
    home: () => goTo(HOME),
    react(kind) {
      if (kind === 'right') {
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 140, useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
        ]).start();
      } else {
        Animated.sequence([
          Animated.timing(tilt, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -1, duration: 220, useNativeDriver: true }),
          Animated.timing(tilt, { toValue: 0, duration: 160, useNativeDriver: true }),
        ]).start();
      }
    },
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          transform: [
            ...pos.getTranslateTransform(),
            { translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) },
            { rotate: tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) },
          ],
        },
      ]}
    >
      {bubble ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{bubble}</Text>
        </View>
      ) : null}
      <Image source={ART[character] || ART.bunny} style={styles.art} resizeMode="contain" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    alignItems: 'center',
  },
  art: {
    width: SIZE,
    height: SIZE,
  },
  bubble: {
    marginBottom: 12,
    minWidth: 180,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#609EF5',
  },
  bubbleText: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#171d31',
  },
});

export default Buddy;
```

- [ ] **Step 2: 파싱을 확인한다**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('activities/Buddy.js',{presets:[require.resolve('babel-preset-expo')]});console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 3: 커밋**

```bash
git add frontend/activities/Buddy.js
git commit -m "feat: buddy that moves, hops and speaks on command"
```

---

### Task 5: 공용 뼈대

**Files:**
- Create: `frontend/activities/ActivityStage.js`
- Create: `frontend/activities/FindIt.js`, `DragMatch.js`, `CountIt.js`, `SayIt.js` (자리표시자)

**Interfaces:**
- Consumes: `Buddy` (Task 4), `hintLevel` (Task 2)
- Produces: `<ActivityStage activity={{type, payload}} onDone={(ok: boolean) => void} />`
  - 활동 컴포넌트가 받는 props: `{ payload, buddy, stage, onSolve, setHintAt }`
    - `buddy` — Task 4의 명령 넷 (`say`/`moveTo`/`home`/`react`)
    - `stage` — `{ w, h }` 픽셀
    - `onSolve() => void` — 활동이 끝났음을 알린다
    - `setHintAt(point: {x, y}) => void` — 정답 위치를 뼈대에 알린다 (0~1 비율)

- [ ] **Step 1: 자리표시자 넷을 만든다**

`frontend/activities/FindIt.js`, `DragMatch.js`, `CountIt.js`, `SayIt.js` 각각 같은 내용으로:

```js
import React from 'react';
import { View } from 'react-native';

export default function Placeholder() {
  return <View />;
}
```

- [ ] **Step 2: 뼈대를 쓴다**

`frontend/activities/ActivityStage.js`:

```js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import Buddy from './Buddy';
import CountIt from './CountIt';
import DragMatch from './DragMatch';
import FindIt from './FindIt';
import SayIt from './SayIt';
import { hintLevel } from './rules';

const KINDS = { findit: FindIt, drag: DragMatch, count: CountIt, say: SayIt };
const CHARACTERS = ['bunny', 'dino'];

// The frame every activity sits in. It owns the buddy and the hint ladder; the activity owns
// only its own board. One ladder in one place — four activities each running their own timer
// would drift apart.
export default function ActivityStage({ activity, onDone }) {
  const win = useWindowDimensions();
  const buddyRef = useRef(null);
  const hintAt = useRef(null);
  const settled = useRef(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [level, setLevel] = useState(0);

  // Picked once and kept for the whole activity: a voice that changes mid-sentence confuses
  // a three-year-old.
  const character = useMemo(
    () => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
    [activity]
  );

  const Body = KINDS[activity.type];

  const finish = (ok) => {
    if (settled.current) return;
    settled.current = true;
    onDone(ok);
  };

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (settled.current) return;
      const next = hintLevel(Date.now() - startedAt);
      setLevel((prev) => (prev === next ? prev : next));
      if (next >= 3) {
        // The buddy solves it and celebrates with the child rather than leaving them stuck.
        if (hintAt.current) buddyRef.current?.moveTo(hintAt.current);
        buddyRef.current?.say('hint.solved');
        buddyRef.current?.react('right');
        setTimeout(() => finish(true), 1800);
      }
    }, 500);
    return () => clearInterval(id);
  }, [activity]);

  // Level 2 hops next to the answer. Level 1 is the buddy simply looking that way, which the
  // art cannot express yet, so it is left silent on purpose.
  useEffect(() => {
    if (!hintAt.current || level !== 2) return;
    buddyRef.current?.moveTo({ x: hintAt.current.x, y: Math.max(0.12, hintAt.current.y - 0.18) });
    buddyRef.current?.react('right');
  }, [level]);

  if (!Body) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => finish(false)}
    >
      <View
        style={[styles.stage, { width: win.width, height: win.height }]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setStage({ w: width, h: height });
          buddyRef.current?.home();
        }}
      >
        {stage.w ? (
          <Body
            payload={activity.payload}
            buddy={buddyRef.current}
            stage={stage}
            onSolve={() => setTimeout(() => finish(true), 1400)}
            setHintAt={(point) => {
              hintAt.current = point;
            }}
          />
        ) : null}
        <Buddy ref={buddyRef} character={character} stage={stage} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
```

- [ ] **Step 3: 파싱을 확인한다**

Run: `cd frontend && node -e "for (const f of ['ActivityStage','FindIt','DragMatch','CountIt','SayIt']) require('@babel/core').transformFileSync('activities/'+f+'.js',{presets:[require.resolve('babel-preset-expo')]}); console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 4: 커밋**

```bash
git add frontend/activities/
git commit -m "feat: activity stage owning the buddy and the hint ladder"
```

---

### Task 6: 찾아 짚기

**Files:**
- Modify: `frontend/activities/FindIt.js` (Task 5의 자리표시자를 대체)
- Modify: `backend/server/tools/puzzle-frames.mjs`
- Modify: `frontend/assets/activities.json`

**Interfaces:**
- Consumes: `isHit` (Task 2), Task 5의 props 다섯
- Produces: `payload = { image: string, target: {x, y, r}, ask: string }`

- [ ] **Step 1: 활동을 쓴다**

`frontend/activities/FindIt.js`:

```js
import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { isHit } from './rules';

// Rewritten by backend/server/tools/puzzle-frames.mjs — keep the marker comments.
// FIND_IMAGES_START
const FIND_IMAGES = {};
// FIND_IMAGES_END

// Tap the picture to find something in it. A miss does nothing at all — no buzzer, no shake.
// The child keeps looking instead of learning they got it wrong.
export default function FindIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [found, setFound] = useState(false);

  useEffect(() => {
    setHintAt(payload.target);
    buddy?.say('quiz.ask');
  }, []);

  const onTap = (e) => {
    if (found) return;
    const point = {
      x: e.nativeEvent.locationX / stage.w,
      y: e.nativeEvent.locationY / stage.h,
    };
    if (!isHit(point, payload.target)) return;
    setFound(true);
    buddy?.moveTo({ x: payload.target.x, y: Math.max(0.12, payload.target.y - 0.2) });
    buddy?.say('answer.right');
    buddy?.react('right');
    onSolve();
  };

  const ring = payload.target.r * stage.w;

  return (
    <Pressable style={styles.board} onPress={onTap}>
      {FIND_IMAGES[payload.image] ? (
        <Image source={FIND_IMAGES[payload.image]} style={styles.art} resizeMode="cover" />
      ) : null}
      {found ? (
        <View
          style={[
            styles.ring,
            {
              left: payload.target.x * stage.w - ring,
              top: payload.target.y * stage.h - ring,
              width: ring * 2,
              height: ring * 2,
              borderRadius: ring,
            },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  art: {
    width: '100%',
    height: '100%',
  },
  ring: {
    position: 'absolute',
    borderWidth: 6,
    borderColor: '#609EF5',
  },
});
```

- [ ] **Step 2: 프레임 추출 도구를 넓힌다**

`backend/server/tools/puzzle-frames.mjs`에서:

`const OUT_DIR = …` 줄 아래에 추가:

```js
const FIND_DIR = path.join(ROOT, 'frontend/assets/finds');
const FINDIT = path.join(ROOT, 'frontend/activities/FindIt.js');
fs.mkdirSync(FIND_DIR, { recursive: true });
const findKeys = [];
```

루프 안 `if (a.type !== 'puzzle') continue;`를 다음으로 바꾼다:

```js
    if (a.type !== 'puzzle' && a.type !== 'findit') continue;
    const dir = a.type === 'puzzle' ? OUT_DIR : FIND_DIR;
```

`const file = path.join(OUT_DIR, …)`를 `const file = path.join(dir, …)`로 바꾸고, `keys.push(name);`를 다음으로 바꾼다:

```js
    if (a.type === 'puzzle') keys.push(name);
    else findKeys.push(name);
```

파일 끝, `PUZZLE_IMAGES` 맵을 다시 쓰는 코드 아래에 추가:

```js
// The find-it map lives in its own component, between the marker comments.
const findMap = `// FIND_IMAGES_START\nconst FIND_IMAGES = {\n${findKeys
  .map((k) => `  '${k}': require('../assets/finds/${k}.png'),`)
  .join('\n')}\n};\n// FIND_IMAGES_END`;
const findSrc = fs.readFileSync(FINDIT, 'utf8');
fs.writeFileSync(
  FINDIT,
  findSrc.replace(/\/\/ FIND_IMAGES_START[\s\S]*?\/\/ FIND_IMAGES_END/, findMap)
);
```

- [ ] **Step 3: 데모 payload를 넣는다**

`frontend/assets/activities.json`의 `teenieping-01` 배열에서 `at_sec`(또는 `at`)이 27인 항목을 다음으로 바꾼다:

```json
{ "type": "findit", "at_sec": 27,
  "payload": { "image": "teenieping-01-27",
               "target": { "x": 0.5, "y": 0.45, "r": 0.12 },
               "ask": "하츄핑 어디 있지?" } }
```

- [ ] **Step 4: 프레임을 뽑는다**

Run: `node backend/server/tools/puzzle-frames.mjs`
Expected: `teenieping-01 27s -> teenieping-01-27.png`, `frontend/assets/finds/teenieping-01-27.png` 생성, `FindIt.js`의 `FIND_IMAGES`에 항목 한 줄

- [ ] **Step 5: 좌표를 실제 그림에 맞춘다**

`frontend/assets/finds/teenieping-01-27.png`를 열어 찾을 대상의 중심 비율을 잰다. 그림 폭 940px에서 중심이 x=620px, y=190px(높이 529px)이면 `{ "x": 0.66, "y": 0.36, "r": 0.12 }`. Step 3의 `target`을 그 값으로 고친다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/activities/FindIt.js frontend/assets/finds \
        frontend/assets/activities.json backend/server/tools/puzzle-frames.mjs
git commit -m "feat: find-it activity built from the trigger frame"
```

---

### Task 7: 세어보기

**Files:**
- Modify: `frontend/activities/CountIt.js` (자리표시자를 대체)
- Modify: `frontend/assets/activities.json`

**Interfaces:**
- Consumes: Task 5의 props 다섯, `buddy.say('count.n:<숫자>')` (Task 4)
- Produces: `payload = { item: 'apple' | 'star', n: number }`

- [ ] **Step 1: 활동을 쓴다**

`frontend/activities/CountIt.js`:

```js
import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

const ITEM_ART = {
  apple: require('../assets/scenes/candy.png'),
  star: require('../assets/characters/star-buddy.png'),
};

const ROW_Y = 0.34;

// Counting is the activity — there is no number to pick. Each tap moves the buddy onto the
// thing just counted and it says the number out loud.
export default function CountIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [counted, setCounted] = useState(0);
  const slots = Array.from({ length: payload.n }, (_, i) => (i + 1) / (payload.n + 1));

  useEffect(() => {
    setHintAt({ x: slots[0], y: ROW_Y });
    buddy?.say('quiz.ask');
  }, []);

  const tap = (index) => {
    if (index !== counted) return; // out-of-order taps are ignored, not punished
    const next = counted + 1;
    setCounted(next);
    buddy?.moveTo({ x: slots[index], y: Math.max(0.12, ROW_Y - 0.16) });
    buddy?.say(`count.n:${next}`);
    if (next >= payload.n) {
      buddy?.say('count.done');
      buddy?.react('right');
      onSolve();
    } else {
      setHintAt({ x: slots[next], y: ROW_Y });
    }
  };

  return (
    <View style={styles.board} pointerEvents="box-none">
      {slots.map((x, i) => (
        <Pressable
          key={i}
          style={[
            styles.cell,
            { left: x * stage.w - 60, top: ROW_Y * stage.h - 60 },
            i < counted && styles.cellDone,
          ]}
          onPress={() => tap(i)}
        >
          <Image
            source={ITEM_ART[payload.item] || ITEM_ART.star}
            style={styles.art}
            resizeMode="contain"
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  cell: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  cellDone: {
    backgroundColor: '#e6f0ff',
  },
  art: {
    width: 96,
    height: 96,
  },
});
```

- [ ] **Step 2: 데모 payload를 넣는다**

`frontend/assets/activities.json`의 `teenieping-01`에서 `at_sec`이 136인 항목을 다음으로 바꾼다:

```json
{ "type": "count", "at_sec": 136, "payload": { "item": "apple", "n": 4 } }
```

- [ ] **Step 3: 파싱을 확인한다**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('activities/CountIt.js',{presets:[require.resolve('babel-preset-expo')]});console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 4: 커밋**

```bash
git add frontend/activities/CountIt.js frontend/assets/activities.json
git commit -m "feat: counting activity where the buddy counts along"
```

---

### Task 8: 끌어다 놓기

**Files:**
- Modify: `frontend/activities/DragMatch.js` (자리표시자를 대체)
- Modify: `frontend/assets/activities.json`

**Interfaces:**
- Consumes: Task 5의 props 다섯
- Produces: `payload = { item: 'candy' | 'hat', slot: string }`

- [ ] **Step 1: 활동을 쓴다**

`frontend/activities/DragMatch.js`:

```js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const ART = {
  hat: require('../assets/scenes/closet.png'),
  candy: require('../assets/scenes/candy.png'),
};

const ITEM_AT = { x: 0.26, y: 0.45 };
const SLOT_AT = { x: 0.68, y: 0.45 };
const SNAP_PX = 130;

// Carry the thing to where it belongs. Dropped short, it springs back — that reads as "not
// yet", where a buzzer would read as "you failed".
export default function DragMatch({ payload, buddy, stage, onSolve, setHintAt }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const placed = useRef(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    setHintAt(SLOT_AT);
    buddy?.say('quiz.ask');
    // The buddy waits on the far side of the slot so it never sits under the child's finger.
    buddy?.moveTo({ x: Math.min(0.92, SLOT_AT.x + 0.18), y: SLOT_AT.y });
  }, []);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate((e) => {
          if (placed.current) return;
          pos.setValue({ x: e.translationX, y: e.translationY });
        })
        .onEnd((e) => {
          if (placed.current) return;
          const dropX = ITEM_AT.x * stage.w + e.translationX;
          const dropY = ITEM_AT.y * stage.h + e.translationY;
          const near =
            Math.hypot(dropX - SLOT_AT.x * stage.w, dropY - SLOT_AT.y * stage.h) < SNAP_PX;
          if (!near) {
            Animated.spring(pos, { toValue: { x: 0, y: 0 }, friction: 7, useNativeDriver: true }).start();
            // "거의 다 왔어!" — an encouragement, never a verdict.
            buddy?.say('answer.again');
            buddy?.react('again');
            return;
          }
          placed.current = true;
          setFilled(true);
          Animated.spring(pos, {
            toValue: {
              x: (SLOT_AT.x - ITEM_AT.x) * stage.w,
              y: (SLOT_AT.y - ITEM_AT.y) * stage.h,
            },
            friction: 7,
            useNativeDriver: true,
          }).start();
          buddy?.say('answer.right');
          buddy?.react('right');
          onSolve();
        }),
    [stage.w, stage.h]
  );

  return (
    <View style={styles.board} pointerEvents="box-none">
      <View
        style={[
          styles.slot,
          { left: SLOT_AT.x * stage.w - 75, top: SLOT_AT.y * stage.h - 75 },
          filled && styles.slotFilled,
        ]}
      />
      <GestureDetector gesture={drag}>
        <Animated.View
          style={[
            styles.item,
            { left: ITEM_AT.x * stage.w - 60, top: ITEM_AT.y * stage.h - 60 },
            { transform: pos.getTranslateTransform() },
          ]}
        >
          <Image source={ART[payload.item] || ART.candy} style={styles.art} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  slot: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 28,
    borderWidth: 5,
    borderStyle: 'dashed',
    borderColor: '#b6c8e8',
  },
  slotFilled: {
    borderStyle: 'solid',
    borderColor: '#609EF5',
  },
  item: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    width: 110,
    height: 110,
  },
});
```

- [ ] **Step 2: 데모 payload를 넣는다**

`frontend/assets/activities.json`의 `teenieping-01`에서 `at_sec`이 55인 항목을 다음으로 바꾼다:

```json
{ "type": "drag", "at_sec": 55, "payload": { "item": "candy", "slot": "box" } }
```

- [ ] **Step 3: 파싱을 확인한다**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('activities/DragMatch.js',{presets:[require.resolve('babel-preset-expo')]});console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 4: 커밋**

```bash
git add frontend/activities/DragMatch.js frontend/assets/activities.json
git commit -m "feat: drag-and-place activity with snap and spring-back"
```

---

### Task 9: 앱 연결과 실기기 확인

**Files:**
- Modify: `frontend/App.js` — import 구역, 플레이어 컴포넌트의 상태 선언부, 트리거 `useEffect`(약 3106-3134행), 오버레이 렌더(약 3247행)

**Interfaces:**
- Consumes: `<ActivityStage>` (Task 5)
- Produces: 없음 — 이 계획의 마지막 소비자

- [ ] **Step 1: import를 추가한다**

`frontend/App.js`의 `import { playSound, speak, speakUrl, stopSpeaking } from './sound';` 아래에:

```js
import ActivityStage from './activities/ActivityStage';
```

- [ ] **Step 2: 상태를 추가한다**

같은 파일에서 `const [selected, setSelected] = useState(null);`가 있는 컴포넌트의 상태 선언부에 추가:

```js
  // The four participation activities live in their own stage; quiz and puzzle keep their old path.
  const [stageActivity, setStageActivity] = useState(null);
```

파일 상단, `const QUIZ_KINDS = {` 위에 추가:

```js
const STAGE_KINDS = new Set(['findit', 'drag', 'count', 'say']);
```

- [ ] **Step 3: 트리거 분기를 넓힌다**

트리거 `useEffect` 안, `if (a.type === 'quiz') { … }` 블록이 끝난 **직후**에 추가:

```js
          if (STAGE_KINDS.has(a.type)) setStageActivity({ type: a.type, payload: a.payload || {} });
```

- [ ] **Step 4: 오버레이를 렌더한다**

`{active === 'traceword' ? (` 바로 **위에** 추가:

```js
      {stageActivity ? (
        <ActivityStage
          activity={stageActivity}
          onDone={() => {
            setStageActivity(null);
            resume();
          }}
        />
      ) : null}
```

- [ ] **Step 5: 번들이 통과하는지 확인한다**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('App.js',{presets:[require.resolve('babel-preset-expo')]});console.log('parse OK')"`
Expected: `parse OK`

- [ ] **Step 6: 순수 로직 테스트를 다시 돌린다**

Run: `cd frontend && node activities/test.js`
Expected: `ok` 7줄, 종료 코드 0

- [ ] **Step 7: 실기기에서 확인한다**

Metro가 떠 있는 상태에서 태블릿 앱을 리로드하고 캐치 티니핑 1화를 연다. 확인할 것:

1. 27초 — 찾아 짚기. 빈 곳을 짚어도 아무 반응이 없고, 맞는 곳을 짚으면 동그라미가 뜨고 캐릭터가 날아간다
2. 55초 — 끌어다 놓기. 짧게 놓으면 제자리로 돌아온다
3. 136초 — 세어보기. 탭할 때마다 캐릭터가 옮겨가고 말풍선 숫자가 하나씩 오른다
4. 아무것도 안 하고 24초를 두면 캐릭터가 대신 풀고 다음으로 넘어간다
5. 한 활동 안에서 캐릭터가 바뀌지 않는다

Run: `adb -s <serial> logcat -d | grep -c "FATAL EXCEPTION"`
Expected: `0`

- [ ] **Step 8: 커밋**

```bash
git add frontend/App.js
git commit -m "feat: route the four participation activities to the new stage"
```

---

### Task 10: 따라 말하기 (재빌드 필요)

이 작업만 **네이티브 권한 추가**가 필요해 APK를 다시 말아야 한다. 그래서 마지막에 둔다. 앞의 아홉 작업은 Metro 리로드만으로 확인된다.

**Files:**
- Modify: `frontend/activities/SayIt.js` (자리표시자를 대체)
- Modify: `frontend/android/app/src/main/AndroidManifest.xml:2`
- Modify: `frontend/app.json`
- Modify: `frontend/assets/activities.json`

**Interfaces:**
- Consumes: `speechPassed` (Task 2), Task 5의 props 다섯
- Produces: `payload = { word: string, listenMs: number }`

- [ ] **Step 1: 마이크 권한을 넣는다**

`frontend/android/app/src/main/AndroidManifest.xml`의 `<uses-permission android:name="android.permission.INTERNET"/>` 아래에:

```xml
  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
```

`frontend/app.json`의 `expo.android` 객체 안에 (키가 없으면 만든다):

```json
"permissions": ["RECORD_AUDIO"]
```

- [ ] **Step 2: 활동을 쓴다**

`frontend/activities/SayIt.js`:

```js
import { AudioModule, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechPassed } from './rules';

const FLOOR = -35;

// Did the child speak? Not what they said. See the spec — scoring a three-year-old's
// pronunciation marks normal speech wrong.
export default function SayIt({ payload, buddy, onSolve, setHintAt }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const samples = useRef([]);
  const startedAt = useRef(0);
  const done = useRef(false);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    setHintAt({ x: 0.5, y: 0.42 });
    let alive = true;
    (async () => {
      const granted = await AudioModule.requestRecordingPermissionsAsync();
      if (!alive) return;
      buddy?.say('speak.listen');
      // No microphone, no problem: the buddy says the word and the turn passes anyway.
      if (!granted.granted) {
        setTimeout(() => onSolve(), 2500);
        return;
      }
      startedAt.current = Date.now();
      await recorder.prepareToRecordAsync();
      recorder.record();
    })();
    return () => {
      alive = false;
      try { recorder.stop(); } catch (e) { /* already stopped */ }
    };
  }, []);

  useEffect(() => {
    if (done.current || !state.isRecording) return;
    const db = state.metering ?? -60;
    setLevel(Math.max(0, Math.min(1, (db - FLOOR) / 25 + 0.3)));
    samples.current.push({ db, atMs: Date.now() - startedAt.current });

    if (speechPassed(samples.current, { floor: FLOOR, holdMs: 400 })) {
      done.current = true;
      try { recorder.stop(); } catch (e) { /* already stopped */ }
      buddy?.say('answer.right');
      buddy?.react('right');
      onSolve();
      return;
    }
    if (Date.now() - startedAt.current > (payload.listenMs || 5000)) {
      samples.current = [];
      startedAt.current = Date.now();
      buddy?.say('speak.quiet');
    }
  }, [state.metering, state.isRecording]);

  return (
    <View style={styles.board} pointerEvents="none">
      <View style={styles.mic}>
        <Text style={styles.word}>{payload.word}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '18%',
    alignItems: 'center',
    gap: 20,
  },
  mic: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6f0ff',
    borderWidth: 5,
    borderColor: '#609EF5',
  },
  word: {
    fontSize: 44,
    fontWeight: '900',
    color: '#171d31',
  },
  meterTrack: {
    width: 360,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#eef2fb',
    overflow: 'hidden',
  },
  meterFill: {
    height: 18,
    borderRadius: 9,
    backgroundColor: '#609EF5',
  },
});
```

- [ ] **Step 3: 데모 payload를 넣는다**

`frontend/assets/activities.json`의 `teenieping-01`에서 `at_sec`이 175인 항목을 다음으로 바꾼다:

```json
{ "type": "say", "at_sec": 175, "payload": { "word": "사과", "listenMs": 5000 } }
```

- [ ] **Step 4: 다시 빌드하고 설치한다**

```bash
cd frontend/android && JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home \
  ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleDebug -q
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
```

- [ ] **Step 5: 실기기에서 확인한다**

175초에서 마이크 권한을 묻고, 허용 후 소리를 내면 막대가 차오르며 통과한다. 조용히 5초를 두면 "안 들렸어~ 한 번 더!"가 나오고 다시 기다린다. 권한을 거부해도 활동이 멈추지 않고 넘어간다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/activities/SayIt.js frontend/app.json \
        frontend/android/app/src/main/AndroidManifest.xml frontend/assets/activities.json
git commit -m "feat: say-along activity gated on speaking, not on words"
```

---

## 목소리 파일이 도착하면

코드 변경 없음. 두 단계로 끝난다.

```bash
# 1. 파일을 넣는다 — 캐릭터당 23개
frontend/assets/voice/bunny/quiz.ask.1.m4a  …  answer.right.1.m4a  …  count.1.m4a … count.10.m4a
frontend/assets/voice/dino/quiz.ask.1.m4a   …

# 2. 맵을 다시 만든다
node backend/server/tools/voice-index.mjs
```

Metro를 리로드하면 그때부터 목소리가 나온다.
