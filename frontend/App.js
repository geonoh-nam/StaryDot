import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text, TextInput } from './Typography';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Defs, G, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { AlphaType, Canvas, ColorType, Group, Image as SkiaImage, Path as SkiaPath, Skia, useFont, useImage } from '@shopify/react-native-skia';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Rea, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  makeMutable,
  withDecay,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView, PointerType } from 'react-native-gesture-handler';
import getStroke from 'perfect-freehand';
import PuzzleScreen from './Puzzle';
import { playSound, speak, speakUrl, stopSpeaking } from './sound';
import ActivityStage from './activities/ActivityStage';
import IntroScreen from './Intro';
import * as ImagePicker from 'expo-image-picker';


// The content server runs beside the dev server, so its host is the one we are bundling from.
const CONTENT_PORT = 5056;
// Videos pushed to the app's own folder play without any storage permission, and without a server.
const LOCAL_VIDEO_DIR = 'file:///sdcard/Android/data/com.flyai.patti/files/video/';
const OFFLINE_LIBRARY = require('./assets/library.json');
// Activity plans ship with the app too, so a tablet with no server still asks real questions.
const OFFLINE_ACTIVITIES = require('./assets/activities.json');
// Frames grabbed at each puzzle's own timestamp, keyed by the name the activity payload carries.
const PUZZLE_IMAGES = {
  'teenieping-01-90': require('./assets/puzzles/teenieping-01-90.png'),
};
function contentBase() {
  const hostUri = Constants.expoConfig?.hostUri || '';
  const host = Platform.OS === 'android' ? hostUri.split(':')[0] || 'localhost' : 'localhost';
  return `http://${host}:${CONTENT_PORT}`;
}

function GradientRim({ radius = 34, width = 6 }) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="rimTheme" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#609EF5" />
          <Stop offset="0.55" stopColor="#00CFE9" />
          <Stop offset="1" stopColor="#ffffff" />
        </LinearGradient>
      </Defs>
      {/* Drawn on the edge at double width so the outer half clips away, leaving an inner rim. */}
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill="none" stroke="url(#rimTheme)" strokeWidth={width * 2} />
    </Svg>
  );
}

// One place that talks to the content server. Failures are swallowed: a missing server must
// never stop a child from watching, it only means today's records are not kept.
async function api(path, options) {
  try {
    const r = await fetch(contentBase() + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// Card art, colours and the character's line stay in the app; the server owns the episodes.
const SERIES_ART = {
  teenieping: { topic: '내가 좋아하는 티니핑', color: '#ff5fa2', tint: '#fff0f6', accent: '#e0327c', line: '“같이보자츄~”', thumb: require('./assets/characters/thumbs/thumb1.png') },
  tayo: { topic: '내가 타고 싶은 자동차', color: '#2b7fd7', tint: '#eef5ff', accent: '#1b5fae', line: '“꼬마버스 타요, 출발합니다!”', thumb: require('./assets/characters/thumbs/thumb2.png') },
  bread: { topic: '맛있는 빵', color: '#f5c33b', tint: '#fffaec', accent: '#a8760c', line: '“어서 오세요, 브레드이발소!”', thumb: require('./assets/characters/thumbs/thumb6.png') },
  shark: { topic: '바다 친구들', color: '#7c5cff', tint: '#f3f0ff', accent: '#ffb703', line: '“아기 상어 뚜루루 뚜루~”', thumb: require('./assets/characters/thumbs/thumb4.png') },
  pororo: { topic: '눈 내리는 날', color: '#e5484d', tint: '#fff1f0', accent: '#1f6fd0', line: '“노는 게 제일 좋아!”', thumb: require('./assets/characters/thumbs/thumb5.png') },
};

// Turn one /library category into the shape the screens already expect.
function toSeries(cat, base) {
  const art = SERIES_ART[cat.id];
  if (!art) return null;
  return {
    ...art,
    id: cat.id,
    title: cat.label,
    duration: `동영상 ${cat.videos.length}개`,
    episodes: cat.videos.map((v) => ({
      id: v.id,
      title: v.title,
      duration: mmss(v.duration_sec),
      color: v.color || art.color,
      still: base && v.thumbPath ? { uri: base + v.thumbPath } : null,
      // Local copy first: it plays with the laptop off, and never buffers over wifi.
      source: { uri: `${LOCAL_VIDEO_DIR}${v.id}.mp4` },
    })),
  };
}
// Thumbnail frames (from the demo video for now; per-video thumbnails come with the DB).
const THUMBS = [
  require('./assets/thumbs/t1.jpg'),
  require('./assets/thumbs/t2.jpg'),
  require('./assets/thumbs/t3.jpg'),
  require('./assets/thumbs/t4.jpg'),
  require('./assets/thumbs/t5.jpg'),
  require('./assets/thumbs/t6.jpg'),
  require('./assets/thumbs/t7.jpg'),
  require('./assets/thumbs/t8.jpg'),
];
const TRACE_LINEART = require('./assets/trace_lineart_v2.png');

const BG = '#08113D';
const SURFACE = '#122055';
const TEXT_ON_DARK = '#171d31';
const TEXT_MUTED_ON_DARK = '#5b6b8c';

const COLORS = {
  ink: '#171d31',
  muted: '#748198',
  blue: '#00CFE9',
  blueDark: '#00CFE9',
  blueSoft: '#edf4ff',
  sky: '#00CFE9',
  pink: '#ffe4ef',
  pinkHot: '#f45aa2',
  yellow: '#fff0b8',
  purple: '#efe7ff',
  mint: '#dffaf2',
  line: '#dfe8f7',
  card: '#ffffff',
  stage: '#ffffff',
  dark: '#101828',
};

const video = {
  title: '전설의 고래와 용기 이야기',
  duration: '1:30',
  captions: [
    '로미 곁엔 내가 있어 츄!',
    '너무 위험해',
    '한바탕해 볼까',
    '그 마음은 잃지 않았으면 좋겠어',
  ],
};

// Mock video library. Shaped for a later DB swap: replace this array with a fetch
// that returns the same { id, label, videos:[{ id, title, duration, emoji, color }] }.
const LIBRARY = [
  {
    id: 'popular',
    label: '인기',
    videos: [
      // Each series carries its own palette: card colour, the tint its screen washes over, and the
      // accent used for chips and headings, so the mood changes with the character.
      { id: 'pop-teenieping', title: '캐치 티니핑', duration: '4기 베리 하츄핑', color: '#ff5fa2', tint: '#fff0f6', accent: '#e0327c', line: '“같이보자츄~”', thumb: require('./assets/characters/thumbs/thumb1.png') },
      { id: 'pop-tayo', title: '꼬마버스 타요', duration: '용감한 소방차 이야기', color: '#2b7fd7', tint: '#eef5ff', accent: '#1b5fae', line: '“꼬마버스 타요, 출발합니다!”', thumb: require('./assets/characters/thumbs/thumb2.png') },
      { id: 'pop-bread', title: '브레드이발소', duration: '오늘도 손님이 와요', color: '#f2a65a', tint: '#fff6ec', accent: '#a55b1e', line: '“어서 오세요, 브레드이발소!”', artScale: 0.86, thumb: require('./assets/characters/thumbs/thumb6.png') },
      { id: 'pop-shark', title: '핑크퐁 아기상어', duration: '상어 가족과 노래해요', color: '#7c5cff', tint: '#f3f0ff', accent: '#ffb703', line: '“아기 상어 뚜루루 뚜루~”', thumb: require('./assets/characters/thumbs/thumb4.png') },
      { id: 'pop-pororo', title: '뽀롱뽀롱 뽀로로', duration: '뽀로로 인기 에피소드', color: '#e5484d', tint: '#fff1f0', accent: '#1f6fd0', line: '“노는 게 제일 좋아!”', thumb: require('./assets/characters/thumbs/thumb5.png') },
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
      { id: 'animal-baby-shark', title: '아기 상어와 바다 친구들', duration: '3:20', emoji: '🦈', color: '#00CFE9' },
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
      { id: 'play-water-splash', title: '물놀이 첨벙첨벙', duration: '3:50', emoji: '💦', color: '#00CFE9' },
    ],
  },
];

const STAGE_KINDS = new Set(['findit', 'drag', 'count', 'say']);

// Question kinds the content pipeline can author. The screen only needs `type` to label them;
// everything else is the same four-option shape.
const QUIZ_KINDS = {
  // Keys match oneshot/schemas.py exactly, so a DB row needs no translation on the way in.
  그림_속_대상_찾기: '그림 속 대상 찾기',
  이야기_되새기기: '이야기 되새기기',
  흉내_내는_말_이해: '흉내 내는 말 이해',
  올바른_낱말_찾기: '올바른 낱말 찾기',
  감정_추론: '감정 추론',
  원인과_결과: '원인과 결과',
  사물_첫글자_찾기: '사물 첫글자 찾기',
  그림과_낱말_연결: '그림과 낱말 연결',
  반대말_찾기: '반대말 찾기',
  빠진_글자_완성: '빠진 글자 완성',
  이야기_핵심_주제: '이야기 핵심 주제',
  같은_글자로_시작하는_낱말: '같은 글자로 시작하는 낱말',
  두_낱말_합치기: '두 낱말 합치기',
  사건의_순서_파악: '사건의 순서 파악',
  색_찾기: '색 찾기',
  수량_확인: '수량 확인',
};


// Demo questions until the pipeline fills the activity table: one per template, so the variety
// the pipeline will produce is visible today. Keys match oneshot/schemas.py.
const opt = (label, color, bg, meaning, example) => ({ label, color, bg, meaning, example });
const C = {
  yellow: ['#f0ae03', '#fffaf0'],
  purple: ['#9b5de5', '#f6f0ff'],
  sky: ['#00CFE9', '#f1fdff'],
  pink: ['#e24e9e', '#fff4fa'],
  green: ['#2fa96b', '#eefaf2'],
  blue: ['#5b8def', '#f0f5ff'],
  orange: ['#e07a3c', '#fff5ee'],
  grey: ['#8a97b1', '#f4f7fe'],
};

const QUIZ_POOL = [
  {
    kind: '색_찾기', title: '우아핑의 색깔은?', answer: '하늘색',
    options: [
      opt('노랑색', ...C.yellow, '병아리처럼 밝고 환한 색이에요.', '노랑색 우산을 쓰고 나갔어요.'),
      opt('보라색', ...C.purple, '포도처럼 진하고 신비로운 색이에요.', '보라색 꽃이 활짝 폈어요.'),
      opt('하늘색', ...C.sky, '맑은 날 하늘처럼 시원한 색이에요.', '하늘색 크레파스로 바다를 그렸어요.'),
      opt('핑크색', ...C.pink, '복숭아처럼 부드럽고 달콤한 색이에요.', '핑크색 리본을 머리에 달았어요.'),
    ],
  },
  {
    kind: '감정_추론', title: '친구가 넘어졌을 때 어떤 마음일까?', answer: '속상해요',
    options: [
      opt('속상해요', ...C.blue, '마음이 아프고 서운한 기분이에요.', '장난감이 부서져서 속상해요.'),
      opt('신나요', ...C.yellow, '즐겁고 들뜬 기분이에요.', '소풍 가는 날이라 신나요.'),
      opt('무서워요', ...C.purple, '겁이 나고 조마조마해요.', '천둥 소리가 무서워요.'),
      opt('배고파요', ...C.orange, '먹고 싶은 마음이 들어요.', '점심시간이라 배고파요.'),
    ],
  },
  {
    kind: '반대말_찾기', title: "'크다'의 반대말은?", answer: '작다',
    options: [
      opt('작다', ...C.green, '크기가 크지 않아요.', '개미는 아주 작다.'),
      opt('높다', ...C.blue, '위로 많이 올라가 있어요.', '산이 정말 높다.'),
      opt('빠르다', ...C.pink, '움직임이 아주 빨라요.', '치타는 빠르다.'),
      opt('무겁다', ...C.grey, '들기 힘들 만큼 무게가 나가요.', '가방이 무겁다.'),
    ],
  },
  {
    kind: '수량_확인', title: '화면에 사과가 몇 개 있을까?', answer: '3개',
    options: [
      opt('1개', ...C.yellow, '하나예요.', '사탕이 1개 남았어요.'),
      opt('2개', ...C.green, '둘이에요.', '신발은 2개가 한 켤레예요.'),
      opt('3개', ...C.pink, '셋이에요.', '풍선을 3개 들었어요.'),
      opt('5개', ...C.blue, '다섯이에요.', '손가락은 한 손에 5개예요.'),
    ],
  },
  {
    kind: '사물_첫글자_찾기', title: "'바나나'는 어떤 글자로 시작할까?", answer: '바',
    options: [
      opt('바', ...C.yellow, "'바나나'의 첫 글자예요.", '바나나는 노랗다.'),
      opt('가', ...C.green, "'가방'의 첫 글자예요.", '가방을 메고 갔어요.'),
      opt('다', ...C.sky, "'다리'의 첫 글자예요.", '다리를 건넜어요.'),
      opt('마', ...C.pink, "'마차'의 첫 글자예요.", '마차가 지나가요.'),
    ],
  },
  {
    kind: '같은_글자로_시작하는_낱말', title: "'구름'과 같은 글자로 시작하는 낱말은?", answer: '구두',
    options: [
      opt('구두', ...C.grey, '발에 신는 신발이에요.', '아빠가 구두를 신었어요.'),
      opt('사과', ...C.pink, '빨갛고 달콤한 과일이에요.', '사과를 한 입 먹었어요.'),
      opt('나무', ...C.green, '잎이 자라는 큰 식물이에요.', '나무 그늘에서 쉬었어요.'),
      opt('바다', ...C.sky, '넓고 푸른 물이에요.', '바다에서 헤엄쳤어요.'),
    ],
  },
  {
    kind: '그림_속_대상_찾기', title: '화면에 있었던 것은?', answer: '풍선',
    options: [
      opt('풍선', ...C.pink, '바람을 넣어 둥글게 만든 놀잇감이에요.', '풍선이 하늘로 날아갔어요.'),
      opt('자전거', ...C.blue, '두 바퀴로 타는 탈것이에요.', '자전거를 타고 공원에 갔어요.'),
      opt('우산', ...C.purple, '비를 막아주는 물건이에요.', '비가 와서 우산을 폈어요.'),
      opt('의자', ...C.orange, '앉을 때 쓰는 가구예요.', '의자에 앉아 밥을 먹었어요.'),
    ],
  },
  {
    kind: '그림과_낱말_연결', title: '이 그림의 이름은 무엇일까?', answer: '토끼',
    options: [
      opt('토끼', ...C.pink, '귀가 길고 깡충 뛰는 동물이에요.', '토끼가 당근을 먹어요.'),
      opt('거북', ...C.green, '단단한 등딱지가 있는 동물이에요.', '거북이 천천히 걸어요.'),
      opt('여우', ...C.orange, '꼬리가 복슬복슬한 동물이에요.', '여우가 숲으로 갔어요.'),
      opt('오리', ...C.yellow, '물에서 헤엄치는 새예요.', '오리가 연못에서 헤엄쳐요.'),
    ],
  },
  {
    kind: '빠진_글자_완성', title: "호□이 - 빠진 글자는?", answer: '랑',
    options: [
      opt('랑', ...C.orange, "'호랑이'가 완성돼요.", '호랑이가 어흥 하고 울어요.'),
      opt('두', ...C.grey, "'호두'가 되는 글자예요.", '호두를 깨서 먹었어요.'),
      opt('수', ...C.sky, "'호수'가 되는 글자예요.", '호수에 오리가 있어요.'),
      opt('박', ...C.green, "'호박'이 되는 글자예요.", '호박죽을 먹었어요.'),
    ],
  },
  {
    kind: '올바른_낱말_찾기', title: '바르게 쓴 낱말은?', answer: '깨끗이',
    options: [
      opt('깨끗이', ...C.sky, '먼지 없이 말끔하게라는 뜻이에요.', '손을 깨끗이 씻었어요.'),
      opt('깨끄시', ...C.grey, '틀린 표기예요.', '바르게는 깨끗이라고 써요.'),
      opt('깻끗이', ...C.grey, '틀린 표기예요.', '바르게는 깨끗이라고 써요.'),
      opt('깨끗히', ...C.grey, '틀린 표기예요.', '바르게는 깨끗이라고 써요.'),
    ],
  },
  {
    kind: '두_낱말_합치기', title: "'꽃' + '병' 을 합치면?", answer: '꽃병',
    options: [
      opt('꽃병', ...C.pink, '꽃을 꽂아 두는 병이에요.', '꽃병에 장미를 꽂았어요.'),
      opt('병꽃', ...C.grey, '거꾸로 붙인 말이에요.', '바른 말은 꽃병이에요.'),
      opt('꽃집', ...C.green, '꽃을 파는 가게예요.', '꽃집에서 꽃을 샀어요.'),
      opt('물병', ...C.sky, '물을 담는 병이에요.', '물병에 물을 채웠어요.'),
    ],
  },
  {
    kind: '흉내_내는_말_이해', title: '비가 내리는 소리는?', answer: '주룩주룩',
    options: [
      opt('주룩주룩', ...C.sky, '비가 세차게 내리는 소리예요.', '비가 주룩주룩 내려요.'),
      opt('사각사각', ...C.green, '연필로 쓰는 소리예요.', '연필이 사각사각 소리를 내요.'),
      opt('데굴데굴', ...C.orange, '공이 구르는 모습이에요.', '공이 데굴데굴 굴러가요.'),
      opt('반짝반짝', ...C.yellow, '빛나는 모습이에요.', '별이 반짝반짝 빛나요.'),
    ],
  },
  {
    kind: '이야기_되새기기', title: '주인공이 하려던 일은?', answer: '친구 찾기',
    options: [
      opt('친구 찾기', ...C.blue, '잃어버린 친구를 찾는 일이에요.', '숲에서 친구를 찾았어요.'),
      opt('밥 짓기', ...C.orange, '밥을 만드는 일이에요.', '엄마가 밥을 지었어요.'),
      opt('그림 그리기', ...C.pink, '종이에 그림을 그리는 일이에요.', '바다를 그렸어요.'),
      opt('잠자기', ...C.purple, '눈을 감고 쉬는 일이에요.', '일찍 잠자러 갔어요.'),
    ],
  },
  {
    kind: '원인과_결과', title: '우산을 쓴 까닭은?', answer: '비가 와서',
    options: [
      opt('비가 와서', ...C.sky, '비를 맞지 않으려고 우산을 써요.', '비가 와서 우산을 폈어요.'),
      opt('배가 고파서', ...C.orange, '먹고 싶을 때 하는 말이에요.', '배가 고파서 밥을 먹었어요.'),
      opt('졸려서', ...C.purple, '잠이 올 때 하는 말이에요.', '졸려서 하품이 나요.'),
      opt('심심해서', ...C.grey, '할 일이 없을 때 하는 말이에요.', '심심해서 그림을 그렸어요.'),
    ],
  },
  {
    kind: '사건의_순서_파악', title: '가장 먼저 일어난 일은?', answer: '집을 나섰어요',
    options: [
      opt('집을 나섰어요', ...C.green, '밖으로 나가는 일이에요.', '아침에 집을 나섰어요.'),
      opt('버스를 탔어요', ...C.blue, '버스에 오르는 일이에요.', '정류장에서 버스를 탔어요.'),
      opt('학교에 왔어요', ...C.yellow, '학교에 도착한 일이에요.', '드디어 학교에 왔어요.'),
      opt('밥을 먹었어요', ...C.orange, '음식을 먹는 일이에요.', '점심에 밥을 먹었어요.'),
    ],
  },
  {
    kind: '이야기_핵심_주제', title: '이 이야기가 알려주는 것은?', answer: '친구를 도와요',
    options: [
      opt('친구를 도와요', ...C.pink, '어려운 친구를 돕는 마음이에요.', '넘어진 친구를 도와줬어요.'),
      opt('빨리 달려요', ...C.blue, '속도를 내는 일이에요.', '운동장을 빨리 달렸어요.'),
      opt('혼자 놀아요', ...C.grey, '혼자서 노는 일이에요.', '방에서 혼자 놀았어요.'),
      opt('많이 먹어요', ...C.orange, '음식을 많이 먹는 일이에요.', '밥을 많이 먹었어요.'),
    ],
  },
].map((q) => ({ ...q, audioUrl: null }));

// Which questions this episode asks. Ported from oneshot/plan_types.py: kinds the child gets
// wrong come up more often, but only after enough attempts to tell a stumble from a pattern.
const MIN_ATTEMPTS = 3;
const MAX_BOOST = 2.0;

function pickQuizzes(history, count) {
  const attempts = {};
  const wrong = {};
  for (const h of history || []) {
    attempts[h.kind] = (attempts[h.kind] || 0) + 1;
    if (!h.correct) wrong[h.kind] = (wrong[h.kind] || 0) + 1;
  }
  const weightOf = (kind) => {
    const n = attempts[kind] || 0;
    if (n < MIN_ATTEMPTS) return 1;
    return 1 + MAX_BOOST * ((wrong[kind] || 0) / n);
  };

  const remaining = QUIZ_POOL.map((q, i) => i);
  const picks = [];
  while (picks.length < count && remaining.length) {
    const weights = remaining.map((i) => weightOf(QUIZ_POOL[i].kind));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let at = 0;
    while (at < weights.length - 1 && roll > weights[at]) { roll -= weights[at]; at += 1; }
    picks.push(remaining[at]);
    remaining.splice(at, 1);
  }
  return picks;
}

// Button that dips slightly when pressed for tactile feedback.
function TapScale({ style, onPress, children, activeScale = 0.94 }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, friction: 7, tension: 200, useNativeDriver: true }).start();
  return (
    <Pressable onPressIn={() => to(activeScale)} onPressOut={() => to(1)} onPress={onPress}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Soft fade+rise on every screen change so navigation never hard-cuts.
function ScreenFade({ screenKey, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [screenKey]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View style={{ flex: 1, opacity: anim, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

const STORE_KEY = 'patti.profile.v1';
const DEFAULT_PROFILE = { name: '', birth: { y: new Date().getFullYear() - 5, m: 1, d: 1 }, tone: 'blue', species: 'star', level: 1 };
const DEFAULT_SETTINGS = {
  dailyLimit: 30,
  activities: { quiz: true, trace: true, puzzle: true },
  sound: true,
  consent: false,
};

export default function App() {
  // First run walks the grown-up through setup, then the intro animation hands over to the child.
  // The opening animation is parked for now — Intro.js stays, it just is not entered.
  const [screen, setScreen] = useState('welcome');
  const [childProfile, setChildProfile] = useState(DEFAULT_PROFILE);
  const [guardianSettings, setGuardianSettings] = useState(DEFAULT_SETTINGS);
  // Until the saved profile is read back, onboarding must not flash on an returning child's tablet.
  const [restored, setRestored] = useState(false);

  // Opening a video: ask the server for its activity plan and open a session to record against.
  const startWatching = (video) => {
    setPicks(pickQuizzes(quizHistory, 3));
    setPlan([]);
    sessionId.current = null;
    if (video?.id) {
      const bundled = OFFLINE_ACTIVITIES[video.id] || [];
      setPlan(bundled);
      api(`/videos/${video.id}`).then((v) => {
        if (!v?.activities?.length) return;
        const ours = bundled.filter((a) => a.type !== 'quiz');
        setPlan([...v.activities, ...ours].sort((a, b) => (a.at_sec ?? a.at) - (b.at_sec ?? b.at)));
      });
      if (childId) {
        api('/sessions', { method: 'POST', body: { child_id: childId, video_id: video.id } })
          .then((res) => { sessionId.current = res?.id || null; });
      }
    }
    setScreen('watch');
  };
  // A returning child still watches the intro; only the setup steps are skipped.
  const [onboarded, setOnboarded] = useState(false);
  const [introDone, setIntroDone] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [series, setSeries] = useState(LIBRARY[0].videos);
  const [contentUp, setContentUp] = useState(false);
  const [childId, setChildId] = useState(null);
  const sessionId = useRef(null);
  // Server-authored activity plan for the video being watched; empty means use the built-in one.
  const [plan, setPlan] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [picks, setPicks] = useState([0, 1, 2]);
  const [seekTo, setSeekTo] = useState(null);
  const [drawStrokes, setDrawStrokes] = useState([]);
  const [savedDrawing, setSavedDrawing] = useState(null);
  const drawTopic = (selectedSeries && selectedSeries.topic) || SERIES_ART[selectedSeries?.id]?.topic || '내가 좋아하는 것';
  const [words, setWords] = useState([]);
  const [drawCanvasSize, setDrawCanvasSize] = useState({ width: 620, height: 380 });
  const [doodleStrokes, setDoodleStrokes] = useState([]);
  const [doodleCanvasSize, setDoodleCanvasSize] = useState({ width: 620, height: 380 });
  const [characterImage, setCharacterImage] = useState(null);
  const [characterStatus, setCharacterStatus] = useState('idle');
  const [characterError, setCharacterError] = useState('');
  const [quizDone, setQuizDone] = useState(false);
  const [log, setLog] = useState({ quiz: 0, drawing: 0, skip: 0 });
  const [quizCorrectCount, setQuizCorrectCount] = useState(__DEV__ ? 1000 : 0);
  const [fedCount, setFedCount] = useState(0);
  // Which question the child is answering, so the word book stores that question's options.
  const quizAsked = useRef(0);
  const lastQuiz = useRef(null);
  const [tab, setTab] = useState('library');
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [evolving, setEvolving] = useState(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  useEffect(() => {
    const base = contentBase();
    fetch(`${base}/library`)
      .then((r) => r.json())
      .then((cats) => {
        const built = cats.map((c) => toSeries(c, base)).filter(Boolean);
        // Keep the built-in row when the server is unreachable or still empty.
        if (built.length) setSeries(built);
        setContentUp(built.length > 0);
      })
      .catch(() => {
        // No server: fall back to the library shipped with the app, playing the local video files.
        const built = OFFLINE_LIBRARY.map((c) => toSeries(c, '')).filter(Boolean);
        if (built.length) setSeries(built);
        setContentUp(false);
      });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.profile) setChildProfile({ ...DEFAULT_PROFILE, ...saved.profile });
        if (saved.settings) setGuardianSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
        if (saved.words) setWords(saved.words);
        if (saved.childId) setChildId(saved.childId);
        if (saved.quizHistory) setQuizHistory(saved.quizHistory);
        // Setup already done on this tablet: go straight to the child's screen.
        if (saved.settings?.consent) setOnboarded(true);
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);

  useEffect(() => {
    // Waits for the saved profile, so a slow read never drops a returning child into onboarding.
    if (!introDone || !restored) return;
    setScreen(onboarded ? 'main' : 'welcome');
  }, [introDone, restored, onboarded]);

  useEffect(() => {
    if (!restored) return; // never write the defaults over a saved profile before it is read
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ profile: childProfile, settings: guardianSettings, words, childId, quizHistory })).catch(() => {});
  }, [restored, childProfile, guardianSettings, words, childId, quizHistory]);

  // The tablet's own back gesture should walk the app back, not drop the child out of it.
  useEffect(() => {
    const back = {
      welcome: 'intro',
      profile: 'welcome',
      guardian: 'profile',
      home: 'main',
      detail: 'home',
      watch: 'detail',
      activities: 'main',
      drawing: 'activities',
      report: 'main',
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const target = back[screen];
      if (!target) return false; // on the main screen, let Android leave the app
      setScreen(target);
      return true;
    });
    return () => sub.remove();
  }, [screen]);

  const CHARACTER_API = 'https://storydot-character.falai.workers.dev/generate-character';

  const strokesToPng = (strokes, canvasSize) => {
    const w = Math.max(1, Math.round(canvasSize.width));
    const h = Math.max(1, Math.round(canvasSize.height));
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('#ffffff'));
    for (const stroke of strokes) {
      const pts = stroke.points || stroke;
      if (!pts || pts.length < 2) continue;
      const path = Skia.Path.Make();
      pts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(stroke.color || '#111111'));
      paint.setStyle(1); // stroke
      paint.setStrokeWidth(stroke.thickness || 8);
      paint.setStrokeCap(1); // round
      paint.setStrokeJoin(1);
      paint.setAntiAlias(true);
      canvas.drawPath(path, paint);
    }
    return surface.makeImageSnapshot().encodeToBase64();
  };

  const runGeneration = async (strokes, canvasSize, topic) => {
    setCharacterError('');
    setCharacterStatus('loading');
    try {
      if (!strokes || !strokes.length) {
        throw new Error('먼저 그림을 그려주세요.');
      }
      const imageBase64 = strokesToPng(strokes, canvasSize);
      if (!imageBase64) {
        throw new Error('그림을 이미지로 만들지 못했어요.');
      }
      // Without this the fetch hangs forever on an unreachable host and the screen looks frozen.
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 90000);
      let response;
      try {
        response = await fetch(CHARACTER_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({ imageBase64, topic }),
        });
      } finally {
        clearTimeout(timeout);
      }
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || '캐릭터 생성에 실패했어요.');
      }
      setCharacterImage(`data:${payload.mimeType};base64,${payload.imageBase64}`);
      setCharacterStatus('done');
      playSound('fanfare');
      return true;
    } catch (error) {
      const msg = error.message || String(error);
      const friendly = /429|quota|RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg)
        ? 'AI 변환 사용량이 많아요. 잠시 후 다시 시도해줘! (무료 한도 초과)'
        : /402|Insufficient credit/i.test(msg)
        ? '변환 서비스 크레딧이 떨어졌어요. 충전이 필요해요.'
        : /Aborted|aborted|timeout/i.test(msg)
        ? '변환 서버 응답이 없어요. 서버와 같은 wifi인지 확인해줘.'
        : /connect to the server|Network|fetch failed/i.test(msg)
          ? '변환 서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해줘.'
          : msg;
      setCharacterStatus('error');
      setCharacterError(friendly);
      return false;
    }
  };

  const goDrawing = () => {
    setDrawStrokes([]);
    setCharacterStatus('idle');
    setCharacterError('');
    setScreen('drawing');
  };

  const completeDrawing = () => {
    setLog((prev) => ({ ...prev, drawing: Math.max(prev.drawing, 1) }));
    setScreen('report');
  };

  const report = useMemo(
    () => ({
      quiz: log.quiz,
      drawing: log.drawing,
      skip: log.skip,
      watched: selectedVideo?.title || video.title,
      interests: ['고래', '용기', '친구', '색깔'],
    }),
    [log, selectedVideo]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <ExpoStatusBar style="dark" />
        <StatusBar hidden />
        <View style={styles.outer}>
        <View style={styles.tablet}>
          {screen !== 'intro' && screen !== 'welcome' && screen !== 'profile' && screen !== 'guardian' && screen !== 'main' && (
            <TabletHeader
              rightLabel={screen === 'report' ? '오늘 활동 집계' : '더보기'}
              onHome={() => setScreen('main')}
              onReport={() => setScreen('report')}
              // 영상 is the main screen's carousel; the other tabs live on the list screen.
              onTab={(key) => { setSelectedSeries(null); setTab(key); setScreen(key === 'library' ? 'main' : 'home'); }}
            />
          )}
          <ScreenFade screenKey={screen}>
          {screen === 'intro' && <IntroScreen onDone={() => setIntroDone(true)} logo={<StaryLogo size={54} textColor="#ffffff" />} />}
          {screen === 'welcome' && <OnboardIntroScreen onNext={() => setScreen('profile')} />}
          {screen === 'profile' && (
            <ChildProfileScreen profile={childProfile} onChange={setChildProfile} onNext={() => setScreen('guardian')} />
          )}
          {screen === 'guardian' && (
            <GuardianSetupScreen
              settings={guardianSettings}
              onChange={setGuardianSettings}
              onBack={() => setScreen('profile')}
              onDone={() => {
                const months = ageInMonths(childProfile.birth);
                api('/children', {
                  method: 'POST',
                  body: {
                    name: childProfile.name || '친구',
                    age: months == null ? 5 : Math.floor(months / 12),
                    daily_limit_min: guardianSettings.dailyLimit,
                  },
                }).then((res) => res?.id && setChildId(res.id));
                setScreen('main');
              }}
            />
          )}
          {screen === 'main' && (
            <MainScreen
              series={series}
              profile={childProfile}
              onStart={(v) => { setSelectedSeries(v || null); setScreen('home'); }}
              onMenu={(key) => { setSelectedSeries(null); setTab(key); setScreen('home'); }}
              onJump={(key) => { if (key === 'detail' || key === 'watch') setSelectedVideo(series[0]?.episodes?.[0] || LIBRARY[1].videos[0]); setScreen(key); }}
              contentUp={contentUp}
              onReset={() => {
                AsyncStorage.removeItem(STORE_KEY).catch(() => {});
                setChildProfile(DEFAULT_PROFILE);
                setGuardianSettings(DEFAULT_SETTINGS);
                setWords([]);
                setFedCount(0);
                setQuizCorrectCount(__DEV__ ? 1000 : 0);
                setOnboarded(false);
                setIntroDone(false);
                setScreen('intro');
              }}
            />
          )}
          {screen === 'home' && selectedSeries && (
            <SeriesScreen
              series={selectedSeries}
              onBack={() => setScreen('main')}
              onStart={(v) => { setSelectedVideo(v || null); setScreen('detail'); }}
            />
          )}
          {screen === 'home' && !selectedSeries && (
            <HomeScreen
              characterImage={characterImage}
              profile={childProfile}
              series={selectedSeries}
              tab={tab}
              onTab={setTab}
              onBack={() => setScreen('main')}
              onJumpMoment={(videoId, at) => {
                const all = series.flatMap((c) => c.episodes || []);
                const video = all.find((v) => v.id === videoId) || all[0];
                setSelectedVideo(video || null);
                setSeekTo(Math.max(0, at - 4));
                startWatching(video);
              }}
              settings={guardianSettings}
              onSettings={setGuardianSettings}
              words={words}
              report={report}
              feed={quizCorrectCount}
              fed={fedCount}
              onFeed={() => setFedCount((n) => n + 1)}
              onEditProfile={() => setScreen('profile')}
              onStart={(v) => { setSelectedVideo(v || null); startWatching(v); }}
            />
          )}
          {screen === 'detail' && selectedVideo && (
            <VideoDetailScreen
              video={selectedVideo}
              series={selectedSeries}
              onClose={() => setScreen('home')}
              onStart={() => startWatching(selectedVideo)}
            />
          )}
          {screen === 'watch' && (
            <WatchScreen
              source={selectedVideo?.source}
              quizDone={quizDone}
              onQuizAsk={(i, asked) => { quizAsked.current = i; lastQuiz.current = asked || null; }}
              onQuizCorrect={() => {
                setQuizDone(true);
                setWords((prev) => {
                  const seen = new Set(prev.map((w) => w.word));
                  const q = lastQuiz.current || QUIZ_POOL[quizAsked.current] || QUIZ_POOL[0];
                  const fresh = q.options
                    .filter((o) => !seen.has(o.label))
                    .map((o) => ({ word: o.label, meaning: o.meaning || '', example: o.example || '', color: o.color, answer: o.label === q.answer }));
                  return [...fresh, ...prev];
                });
                setLog((prev) => ({ ...prev, quiz: Math.max(prev.quiz, 1) }));
                // Demo growth rule: three correct answers and the star becomes a friend.
                setQuizCorrectCount((n) => {
                  const next = n + 1;
                  if (next >= EVOLVE_AT && childProfile.level < 2) setEvolving(true);
                  return next;
                });
              }}
              onQuizSkip={() => setLog((prev) => ({ ...prev, skip: prev.skip + 1 }))}
              plan={plan}
              picks={picks}
              seekTo={seekTo}
              onResult={(activityId, result, kind) => {
                if (kind) setQuizHistory((prev) => [...prev.slice(-99), { kind, correct: result === 'correct' }]);
                if (!sessionId.current || !activityId) return;
                api('/activity-results', { method: 'POST', body: { session_id: sessionId.current, activity_id: activityId, result } });
              }}
              onWatched={(sec) => {
                if (!sessionId.current) return;
                api(`/sessions/${sessionId.current}`, { method: 'PATCH', body: { watched_sec: sec } });
              }}
              onFinish={() => setScreen('activities')}
              onBack={() => setScreen('home')}
              onHome={() => setScreen('main')}
              onReport={() => setScreen('report')}
            />
          )}
          {screen === 'activities' && (
            <ActivitiesScreen
              characterImage={characterImage}
              onDrawing={goDrawing}
              onFinish={() => setScreen('report')}
            />
          )}
          {screen === 'drawing' && (
            <DrawingScreen
              topic={drawTopic}
              strokes={drawStrokes}
              status={characterStatus}
              error={characterError}
              characterImage={characterImage}
              onChangeStrokes={setDrawStrokes}
              onCanvasSize={setDrawCanvasSize}
              onConvert={() => runGeneration(drawStrokes, drawCanvasSize, drawTopic)}
              onSave={() => { setSavedDrawing({ strokes: drawStrokes, size: drawCanvasSize }); completeDrawing(); }}
              onDone={completeDrawing}
              onSkip={() => {
                setLog((prev) => ({ ...prev, skip: prev.skip + 1 }));
                setScreen('activities');
              }}
            />
          )}
          {evolving ? (
            <EvolvePopup
              onPick={(species) => {
                setChildProfile((p) => ({ ...p, species, level: 2 }));
                setEvolving(false);
                playSound('fanfare');
              }}
            />
          ) : null}
          {screen === 'report' && (
            <ReportScreen
              report={report}
              characterImage={characterImage}
              savedDrawing={savedDrawing}
              onReplay={() => setScreen('watch')}
              onOtherVideos={() => { setSelectedSeries(null); setTab('library'); setScreen('main'); }}
              onCharacter={() => { setSelectedSeries(null); setTab('character'); setScreen('home'); }}
            />
          )}
          </ScreenFade>
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Distance from a Text box's top edge down to the cap line, as a share of font size.
const CAP_TOP_RATIO = -0.11;

// Wordmark: "Story" with a ringed star riding as a superscript — ring and star share the brand blue.
function StaryLogo({ size = 26, color = '#609EF5', textColor = TEXT_ON_DARK }) {
  const mark = size * 0.5;
  return (
    <View style={styles.logoRow}>
      <Text style={[styles.logoWord, { fontSize: size, color: textColor }]}>Story</Text>
      <Text style={[styles.logoWord, { fontSize: size, color, marginLeft: size * 0.16 }]}>Dot</Text>
      <Svg width={mark} height={mark} viewBox="0 0 32 32" // The text box starts above the cap line, so nudge the mark down to sit level with the S.
        style={{ marginLeft: size * 0.06, marginTop: size * CAP_TOP_RATIO }}>
        <Circle cx={16} cy={16} r={16} fill={color} />
        <Polygon
          points="16,5.6 19.1,12.4 26.5,13.2 20.9,18.2 22.5,25.5 16,21.8 9.5,25.5 11.1,18.2 5.5,13.2 12.9,12.4"
          fill="#ffffff"
        />
      </Svg>
    </View>
  );
}

function TabletHeader({ rightLabel, onHome, onReport, onTab }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onHome}>
        <StaryLogo size={20} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.headerMenu} onPress={() => (onTab ? setOpen((v) => !v) : onReport())} accessibilityLabel={rightLabel}>
        <View style={styles.headerMenuLine} />
        <View style={styles.headerMenuLine} />
        <View style={styles.headerMenuLine} />
      </TouchableOpacity>

      {open ? (
        <>
          <Pressable style={styles.headerSheetBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.headerSheet}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={styles.headerSheetItem}
                onPress={() => { setOpen(false); playSound('pop'); onTab(t.key); }}
              >
                <Text style={styles.headerSheetIcon}>{t.icon}</Text>
                <Text style={styles.headerSheetText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.headerSheetDivider} />
            <TouchableOpacity style={styles.headerSheetItem} onPress={() => { setOpen(false); onReport(); }}>
              <Text style={styles.headerSheetIcon}>▤</Text>
              <Text style={styles.headerSheetText}>활동 리포트</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );
}

const TABS = [
  { key: 'library', label: '영상', icon: '▶' },
  { key: 'parent', label: '부모 리포트', icon: '▤' },
  { key: 'character', label: '캐릭터', icon: '★' },
  { key: 'words', label: '단어장', icon: '가' },
  { key: 'settings', label: '설정', icon: '⚙' },
];


// Cards wear a lighter ring of their own colour, like the mockup.
function lighten(hex, amount) {
  const rgb = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return rgbToHex(rgb);
}

const CARD_W = 300;
const CARD_H = 420;
const CARD_GAP = 18;
const CARD_RADIUS = 26;
const CARD_BORDER = 3.5;
const CARD_OVERLAP = 58;

// The cards ride the rim of one big circle whose centre sits far below the screen: they keep
// facing the viewer, the middle one rides highest and largest, the outer ones sink along the arc.
const RING_RADIUS = 1500;
const RING_ANGLE = 9; // degrees between neighbouring cards
const RING_SAMPLES = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const ringFacet = () => {
  const rad = (deg) => (deg * Math.PI) / 180;
  return {
    translateY: RING_SAMPLES.map((d) => RING_RADIUS * (1 - Math.cos(rad(d * RING_ANGLE)))),
    scale: RING_SAMPLES.map((d) => Math.max(0.6, Math.cos(rad(d * RING_ANGLE)) ** 3 * 1.06)),
    opacity: RING_SAMPLES.map((d) => (Math.abs(d) > 2.5 ? 0 : 1)),
  };
};

// A light wash over the flat card colour, plus a gradient rim — svg keeps it dependency-free.
// React Native borders take a single colour, so the rim is drawn rather than set as a border.
function CardSheen({ color }) {
  const rim = 'rim-' + color.slice(1);
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.45" />
        </LinearGradient>
        <LinearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} />
          <Stop offset="1" stopColor={lighten(color, 0.8)} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={CARD_RADIUS} fill="url(#sheen)" />
      {/* Drawn on the edge at double width so the outer half clips away: the rim then follows
          whatever size the card is, instead of the main screen's fixed card. */}
      <Rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={CARD_RADIUS}
        fill="none"
        stroke={`url(#${rim})`}
        strokeWidth={CARD_BORDER * 2}
      />
    </Svg>
  );
}

const VideoCard = React.memo(function VideoCard({ video, onPress }) {
  return (
    <TapScale style={[styles.card, { backgroundColor: video.color }]} onPress={() => { playSound('pop'); onPress(video); }}>
      <CardSheen color={video.color} />
      <Text style={styles.cardTitle} numberOfLines={2}>{video.title}</Text>
      <Text style={styles.cardSub} numberOfLines={1}>{video.duration}</Text>
      <View style={styles.cardBadge}><Text style={styles.cardBadgeText}>!</Text></View>
      {/* Some art fills its PNG edge to edge; artScale pulls those back in line with the rest. */}
      <Image source={video.thumb} style={[styles.cardArt, video.artScale ? { height: 260 * video.artScale } : null]} resizeMode="contain" />
    </TapScale>
  );
});

const STAR_BUDDY = require('./assets/characters/star-buddy.png');

const BUDDY_MENU = [
  { key: 'character', label: '캐릭터', icon: '★' },
  { key: 'parent', label: '부모 리포트', icon: '▤' },
  { key: 'words', label: '단어장', icon: '가' },
  { key: 'settings', label: '설정', icon: '⚙' },
];

// The star drifts and twinkles; tapping it opens the menu bubble that the screen owns, so the
// bubble can live in the free space bottom-right instead of being clipped beside the greeting.
function StarBuddy({ onPress }) {
  const float = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const tap = () => {
    playSound('pop');
    Animated.sequence([
      Animated.timing(press, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 14 }),
    ]).start();
    onPress();
  };

  return (
    <Pressable onPress={tap}>
      <Animated.Image
        source={STAR_BUDDY}
        resizeMode="contain"
        style={{
          width: 190,
          height: 190,
          transform: [
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
            { rotate: float.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '4deg'] }) },
            { scale: press },
          ],
        }}
      />
    </Pressable>
  );
}

// Landing screen, per the mockup: wordmark, a greeting with the child's name highlighted,
// and the video cards fanned out underneath.
// Dev-only shortcut: every screen is one tap away while the flow is being built.
const DEBUG_SCREENS = [
  ['intro', '인트로'],
  ['welcome', '온보딩 안내'],
  ['profile', '아이 프로필'],
  ['guardian', '보호자 설정'],
  ['main', '메인'],
  ['home', '영상 목록'],
  ['detail', '영상 상세'],
  ['watch', '영상 재생'],
  ['activities', '활동 선택'],
  ['drawing', '그림 그리기'],
  ['report', '활동 리포트'],
];

const DEBUG_TABS = [
  ['quizdebug', '문제 목록'],
  ['character', '캐릭터'],
  ['words', '단어장'],
  ['settings', '설정'],
];

const DEBUG_ACTIVITIES = [
  ['찾아 짚기', { type: 'findit', payload: { image: 'teenieping-01-27', target: { x: 0.62, y: 0.53, r: 0.15 }, ask: '하츄핑 어디 있지?' } }],
  ['끌어다 놓기', { type: 'drag', payload: { item: 'candy', slot: 'box' } }],
  ['세어보기', { type: 'count', payload: { item: 'apple', n: 4 } }],
  ['따라 말하기', { type: 'say', payload: { word: '사과', listenMs: 5000 } }],
];

function DebugJump({ onJump, onTab, onReset, contentUp }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  if (!__DEV__) return null;
  return (
    <View style={styles.debugWrap}>
      <TouchableOpacity style={styles.debugBtn} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.debugBtnText}>{open ? '✕' : '⚙'}</Text>
      </TouchableOpacity>
      {open ? (
        <>
          <Pressable style={styles.debugBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.debugPanel}>
            {/* Whether the content server answered tells us at a glance why the library is empty. */}
            <View style={styles.debugStatus}>
              <View style={[styles.debugDot, { backgroundColor: contentUp ? '#2fa96b' : '#e5484d' }]} />
              <Text style={styles.debugStatusText}>콘텐츠 서버 {contentUp ? '연결됨' : '끊김'}</Text>
            </View>

            <Text style={styles.debugGroup}>화면</Text>
            <View style={styles.debugChips}>
              {DEBUG_SCREENS.map(([key, label]) => (
                <TouchableOpacity key={key} style={styles.debugChip} onPress={() => { setOpen(false); onJump(key); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>탭</Text>
            <View style={styles.debugChips}>
              {DEBUG_TABS.map(([key, label]) => (
                <TouchableOpacity key={key} style={styles.debugChip} onPress={() => { setOpen(false); onTab(key); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>활동</Text>
            <View style={styles.debugChips}>
              {DEBUG_ACTIVITIES.map(([label, activity]) => (
                <TouchableOpacity key={activity.type} style={styles.debugChip} onPress={() => { setOpen(false); setPreview(activity); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>데이터</Text>
            <TouchableOpacity style={[styles.debugChip, styles.debugDanger]} onPress={() => { setOpen(false); onReset(); }}>
              <Text style={styles.debugDangerText}>저장 데이터 지우고 온보딩부터</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
      {preview ? <ActivityStage activity={preview} onDone={() => setPreview(null)} /> : null}
    </View>
  );
}

function MainScreen({ series, profile, onStart, onMenu, onJump, onReset, contentUp }) {
  const win = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const bubble = useRef(new Animated.Value(0)).current;
  const toggleMenu = (next) => {
    setMenuOpen(next);
    Animated.spring(bubble, { toValue: next ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
  };
  const base = series;
  // Cards overlap, so one step is narrower than a card.
  const step = CARD_W - CARD_OVERLAP;
  const total = base.length * step;
  // Scroll position in pixels, unbounded: the ring wraps it, so there is no end to hit.
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // Stacking cannot be animated, so the settled index is tracked to lift the front card.
  const [focus, setFocus] = useState(0);

  const ring = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragStart.value = offset.value;
        })
        .onUpdate((e) => {
          offset.value = dragStart.value - e.translationX;
        })
        .onEnd((e) => {
          // Fling, then settle: one continuous motion on the UI thread, so nothing hitches.
          offset.value = withDecay({ velocity: -e.velocityX, deceleration: 0.9985 }, () => {
            const snapped = Math.round(offset.value / step) * step;
            offset.value = withSpring(snapped, { damping: 18, stiffness: 90, mass: 0.5 });
            runOnJS(setFocus)((((snapped / step) % base.length) + base.length) % base.length);
          });
        }),
    [step, base.length]
  );

  return (
    <View style={styles.mainScreen}>
      <DebugJump onJump={onJump} onTab={onMenu} onReset={onReset} contentUp={contentUp} />
      {/* Whose tablet this is: the child's own photo and name, top-left. */}
      <View style={styles.mainWho}>
        {profile.photo ? (
          <Image source={{ uri: profile.photo }} style={styles.mainWhoPhoto} />
        ) : (
          <View style={[styles.mainWhoPhoto, styles.mainWhoBlank]}>
            <Image source={STAR_BUDDY} style={styles.mainWhoStar} resizeMode="contain" />
          </View>
        )}
        <Text style={styles.mainWhoName} numberOfLines={1}>{profile.name || '친구'}</Text>
      </View>
      <StaryLogo size={30} textColor={BG} />

      <View style={styles.mainGreetRow}>
      <View style={styles.buddySpacer} />
      <View style={styles.mainGreetBlock}>
        <View style={styles.mainGreetLine}>
          <Text style={styles.mainGreeting}>안녕! </Text>
          <View>
            <Text style={styles.mainGreeting}>{profile.name || '친구'}!</Text>
            <View style={styles.mainUnderline} />
          </View>
        </View>
        <Text style={styles.mainGreeting}>오늘은 우리 뭐 할까?</Text>
      </View>
      <View style={styles.buddyAnchor} collapsable={false}>
        <StarBuddy onPress={() => toggleMenu(!menuOpen)} />
        {menuOpen ? (
          <Animated.View
            style={[
              styles.buddyBubble,
              {
                opacity: bubble,
                transform: [
                  { translateX: bubble.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
                  { scale: bubble },
                ],
              },
            ]}
          >
            <View style={styles.buddyTail} />
            <Text style={styles.buddyText}>어디로 갈까?</Text>
            <View style={styles.buddyMenu}>
              {BUDDY_MENU.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={styles.buddyMenuItem}
                  onPress={() => { toggleMenu(false); playSound('pop'); onMenu(m.key); }}
                >
                  <Text style={styles.buddyMenuIcon}>{m.icon}</Text>
                  <Text style={styles.buddyMenuText}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        ) : null}
      </View>
      </View>

      <GestureDetector gesture={ring}>
        <View style={styles.carousel} collapsable={false}>
          {base.map((v, i) => (
            <RingCard
              key={v.id}
              video={v}
              index={i}
              offset={offset}
              step={step}
              total={total}
              centerX={(win.width - CARD_W) / 2}
              focused={i === focus}
              onPress={onStart}
            />
          ))}
        </View>
      </GestureDetector>

    </View>
  );
}

function RingCard({ video, index, offset, step, total, centerX, focused, onPress }) {
  const facet = ringFacet();
  const style = useAnimatedStyle(() => {
    const half = total / 2;
    const raw = index * step - offset.value;
    // Wrap into [-half, half): every card is always shown on its nearest side of the ring.
    const d = (((raw + half) % total) + total) % total - half;
    const k = d / step;
    return {
      opacity: interpolate(k, RING_SAMPLES, facet.opacity, Extrapolation.CLAMP),
      transform: [
        { translateX: centerX + d },
        { translateY: interpolate(k, RING_SAMPLES, facet.translateY, Extrapolation.CLAMP) },
        { scale: interpolate(k, RING_SAMPLES, facet.scale, Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Rea.View
      pointerEvents={focused ? 'auto' : 'none'}
      style={[styles.ringCard, { zIndex: focused ? 20 : 1, elevation: focused ? 12 : 0 }, style]}
    >
      <VideoCard video={video} onPress={onPress} />
    </Rea.View>
  );
}

const SERIES_HERO_W = 330;

// What the child sees after picking an episode: a big still, one start button, and what waits inside.
function VideoDetailScreen({ video, series, onClose, onStart }) {
  const accent = (series && series.accent) || '#00CFE9';
  return (
    <View style={[styles.detailScreen, { backgroundColor: (series && series.tint) || '#f5f8ff' }]}>
      <TouchableOpacity style={styles.detailClose} onPress={onClose}>
        <Text style={styles.detailCloseText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.detailThumb}>
        <GradientRim radius={24} width={6} />
        {/* Until per-video stills exist, frames pulled from the demo video stand in. */}
        <Image source={video.still || THUMBS[0]} style={styles.detailThumbImg} resizeMode="cover" />
        {/* Absolute overlay, so the button centres on the still instead of being pushed below it. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.detailOverlay}>
            <TapScale style={styles.detailStart} onPress={() => { playSound('pop'); onStart(video); }}>
              <View style={[styles.detailPlay, { backgroundColor: accent }]}>
                <Text style={styles.detailPlayGlyph}>▶</Text>
              </View>
              <Text style={styles.detailStartText}>시작하기</Text>
            </TapScale>
          </View>
        </View>
      </View>

      <Text style={styles.detailTitle}>
        {video.title}
        <Text style={styles.detailMeta}>  {video.duration} · 만 5~6세</Text>
      </Text>
      {/* ponytail: fixed counts until activities are authored per video. */}
      <Text style={styles.detailCounts}>질문 1개 · 퍼즐 1개 · 그림 1개</Text>
    </View>
  );
}

// Any character image, breathing and squashing on tap — the same feel as the mascot.
function BouncyCharacter({ source, size = 200 }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }),
    ]).start();
    playSound('pop');
  };
  return (
    <Pressable onPress={tap}>
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={{
          width: size,
          height: size,
          transform: [
            { translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
            { scale },
          ],
        }}
      />
    </Pressable>
  );
}

// Series screen: the character sits on the left inviting the child, episodes fill the grid.
function SeriesScreen({ series, onBack, onStart }) {
  // Percentage basis was letting a fourth item squeeze in, so the width is measured.
  const win = useWindowDimensions();
  // 3 per row: screen padding, the hero column, the body gap and the two grid gaps come off first.
  const episodeW = Math.floor((win.width - 48 - SERIES_HERO_W - 24 - 32) / 3);
  const episodes = series.episodes || [];
  return (
    <View style={styles.seriesScreen}>
      <View style={styles.seriesHeader}>
        <TouchableOpacity style={styles.seriesBack} onPress={onBack}>
          <Text style={styles.seriesBackText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.seriesTitle}>{series.title}</Text>
        <Text style={styles.seriesCount}>동영상 {episodes.length}개</Text>
      </View>

      <View style={styles.seriesBody}>
        <View style={[styles.seriesHero, { backgroundColor: series.color }]}>
          <CardSheen color={series.color} />
          {/* Line sits on the floor of the card; the character takes every pixel left above it. */}
          <View style={styles.seriesHeroArt}>
            <BouncyCharacter source={series.thumb} size={SERIES_HERO_W - 40} />
          </View>
          <Text style={styles.seriesHeroLine}>{series.line || '“나랑 같이 놀자”'}</Text>
        </View>

        <View style={styles.seriesRight}>
          <ScrollView contentContainerStyle={styles.seriesGrid} showsVerticalScrollIndicator={false}>
            {episodes.map((v, i) => (
              <TapScale key={v.id} style={[styles.episode, { width: episodeW }]} onPress={() => { playSound('pop'); onStart(v); }}>
                <View style={[styles.episodeThumb, { backgroundColor: v.color || series.color }]}>
                  <Image source={v.still || THUMBS[i % THUMBS.length]} style={styles.episodeImg} resizeMode="cover" />
                </View>
                <Text style={styles.episodeTitle} numberOfLines={1}>{v.title}</Text>
              </TapScale>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

// The child's own star: quizzes earn food, feeding it makes the star grow.
// One candy is one percent, and the star changes shape at each checkpoint.
const GROWTH_CHECKPOINTS = [0, 50, 100];
const GROWTH_PER_CANDY = 20;

// Backdrops the child can switch between; drawn as a gradient so no art has to ship.
const SCENES = [
  { id: 'space', label: '우주', sky: '#0d1b3e', ground: '#1b2f63', image: require('./assets/scenes/space.png') },
  { id: 'sky', label: '하늘', sky: '#7cc4f5', ground: '#d9eeff', image: require('./assets/scenes/sky.png') },
  { id: 'sea', label: '바다', sky: '#0a4f7a', ground: '#23a6c9', image: require('./assets/scenes/sea.png') },
  { id: 'forest', label: '숲', sky: '#1f5c3a', ground: '#69b06a', image: require('./assets/scenes/forest.png') },
  { id: 'room', label: '방', sky: '#f4e2c8', ground: '#d9b98d', image: require('./assets/scenes/room.png') },
];

// Fixed sprinkle, so the sky does not reshuffle on every render.
// What the closet holds: the outfit on its hanger, and who the star becomes wearing it.
const COSTUMES = [
  { id: 1, icon: require('./assets/costumes/costume1.png'), dino: require('./assets/costumes/newdino1.png'), bunny: require('./assets/costumes/newbunny1.png') },
  { id: 2, icon: require('./assets/costumes/costume2.png'), dino: require('./assets/costumes/newdino2.png'), bunny: require('./assets/costumes/newbunny2.png') },
  { id: 3, icon: require('./assets/costumes/costume3.png'), dino: require('./assets/costumes/newdino3.png'), bunny: require('./assets/costumes/newbunny3.png') },
  { id: 4, icon: require('./assets/costumes/costume4.png'), dino: require('./assets/costumes/newdino4.png'), bunny: require('./assets/costumes/newbunny4.png') },
  { id: 5, icon: require('./assets/costumes/costume5.png'), dino: require('./assets/costumes/newdino5.png'), bunny: require('./assets/costumes/newbunny5.png') },
];

const CANDY_ICON = require('./assets/scenes/candy.png');
const CLOSET_ICON = require('./assets/scenes/closet.png');

const STAR_FIELD = Array.from({ length: 46 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 61) % 70,
  r: 1 + ((i * 7) % 3) * 0.7,
  o: 0.4 + ((i * 13) % 5) * 0.12,
}));

// The star the child starts with, and the two it can become once the bar is full.
const STAGE1_ART = require('./assets/characters/stage1.png');
const EVOLUTIONS = [
  { id: 'dino', label: '아기 공룡', art: require('./assets/characters/stage2-dino.png'), grown: require('./assets/characters/stage3-dino.png') },
  { id: 'bunny', label: '아기 토끼', art: require('./assets/characters/stage2-bunny.png'), grown: require('./assets/characters/stage3-bunny.png') },
];

// Two full bars: the first picks a path, the second grows that path up.
const FULL_BAR = 100;

const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  angle: (i / 10) * Math.PI * 2,
  delay: i * 45,
}));

// The star glows harder as it fills, flashes when a form is chosen, and the new character springs
// out of the light. Everything runs on the UI thread so it stays smooth while the panel re-renders.
// Idle float lives outside React: nothing that happens in a render can restart it, so the star
// keeps drifting on its own clock however often the panel re-renders.
const IDLE = makeMutable(0);
let idleStarted = false;

const StarStage = React.memo(function StarStage({ art, ready, evolved, feedTick = 0, tapTick = 0 }) {
  const pulse = useSharedValue(0);
  const flash = useSharedValue(0);
  const pop = useSharedValue(1);
  const burst = useSharedValue(0);
  const nibble = useSharedValue(0);
  const hop = useSharedValue(0);
  const idle = IDLE;

  useEffect(() => {
    if (idleStarted) return;
    idleStarted = true;
    IDLE.value = withRepeat(withTiming(1, { duration: 1700 }), -1, true);
  }, []);

  useEffect(() => {
    if (ready && !evolved) {
      pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    } else {
      pulse.value = withTiming(0, { duration: 500 });
    }
  }, [ready, evolved]);

  // A quick squash on every candy: feedback that lands on the star, not a number floating away.
  useEffect(() => {
    if (!feedTick) return;
    nibble.value = withSequence(
      withTiming(1, { duration: 130 }),
      withSpring(0, { damping: 8, stiffness: 180 })
    );
  }, [feedTick]);

  // Poke the star and it hops — the reward for touching it at all.
  useEffect(() => {
    if (!tapTick) return;
    hop.value = withSequence(
      withTiming(1, { duration: 170 }),
      withSpring(0, { damping: 7, stiffness: 150 })
    );
  }, [tapTick]);

  useEffect(() => {
    if (!evolved) return;
    // Flash white, throw sparks, then let the new shape settle.
    flash.value = withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 620 }));
    burst.value = withSequence(withTiming(1, { duration: 620 }), withTiming(0, { duration: 0 }));
    pop.value = withSequence(
      withTiming(0.35, { duration: 0 }),
      withDelay(140, withSpring(1.12, { damping: 7, stiffness: 130 })),
      withSpring(1, { damping: 12, stiffness: 140 })
    );
  }, [evolved]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0.35 + pulse.value * 0.5, flash.value),
    transform: [{ scale: 0.85 + pulse.value * 0.22 + flash.value * 0.5 }],
  }));

  // One clean ring travelling outward at the moment of change.
  const ringStyle = useAnimatedStyle(() => ({
    opacity: burst.value > 0 ? (1 - burst.value) * 0.8 : 0,
    transform: [{ scale: 0.5 + burst.value * 1.6 }],
  }));

  const artStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -10 * idle.value - 34 * hop.value },
      { rotate: `${-2.5 + idle.value * 5 + hop.value * 6}deg` },
      { scaleX: pop.value * (1 + idle.value * 0.02) * (1 + nibble.value * 0.14) * (1 - hop.value * 0.06) },
      { scaleY: pop.value * (1 + idle.value * 0.02) * (1 - nibble.value * 0.1) * (1 + hop.value * 0.08) },
    ],
    opacity: 1 - flash.value * 0.65,
  }));

  return (
    <View style={styles.starWrap}>
      {/* Soft halo: a radial gradient, not a flat white disc — a hard circle reads as cheap. */}
      <Rea.View pointerEvents="none" style={[styles.starGlow, glowStyle]}>
        <Svg width={360} height={360}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <Stop offset="0.45" stopColor="#cfe4ff" stopOpacity="0.45" />
              <Stop offset="1" stopColor="#8bb8ff" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={180} cy={180} r={180} fill="url(#halo)" />
        </Svg>
      </Rea.View>
      <Rea.View pointerEvents="none" style={[styles.starRing, ringStyle]} />
      {SPARKS.map((sp, i) => (
        <Spark key={i} spark={sp} burst={burst} />
      ))}
      <Rea.View style={artStyle}>
        <Image source={art} style={styles.starArt} resizeMode="contain" />
      </Rea.View>
    </View>
  );
});

function Spark({ spark, burst }) {
  const style = useAnimatedStyle(() => {
    const t = burst.value;
    const distance = 60 + t * 130;
    return {
      opacity: t > 0 ? 1 - t : 0,
      transform: [
        { translateX: Math.cos(spark.angle) * distance },
        { translateY: Math.sin(spark.angle) * distance },
        { scale: 0.4 + (1 - t) * 0.9 },
      ],
    };
  });
  return <Rea.View pointerEvents="none" style={[styles.spark, style]} />;
}

// How much speed a thrown star keeps off a wall, and how fast it coasts to a stop.
const WALL_BOUNCE = 0.5;
const FLING_FRICTION = 0.94;

// How long the star waits before dozing off, and how close a candy has to land to be eaten.
const SLEEP_AFTER_MS = 12000;
const FEED_REACH = 150;

// One heart from a stroke: floats up out of the star's fur and fades.
function Heart({ dx, dy }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, { toValue: 1, duration: 900, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.strokeHeart,
        {
          left: 115 + dx,
          top: 120 + dy,
          opacity: rise.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -70] }) }],
        },
      ]}
    >
      ♥
    </Animated.Text>
  );
}

function CharacterScreen({ profile, food, fed, onFeed }) {
  const [scene, setScene] = useState('space');
  const [panel, setPanel] = useState(false);
  const [closet, setCloset] = useState(false);
  const [costume, setCostume] = useState(null);
  // A white flash covers the swap, so the star never visibly pops from one body to another.
  const flash = useRef(new Animated.Value(0)).current;

  const wearCostume = (item) => {
    setCloset(false);
    playSound('fanfare');
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.delay(120),
      Animated.timing(flash, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setCostume(item), 300);
  };

  const [evolved, setEvolved] = useState(null);
  const [evolvedAt, setEvolvedAt] = useState(null);
  const current = SCENES.find((sc) => sc.id === scene) || SCENES[0];
  const total = fed * GROWTH_PER_CANDY;
  const chosenAt = evolvedAt ?? 0;
  // Before choosing, the bar fills to 100; after, it starts again from the moment of the choice.
  const percent = evolved ? Math.min(FULL_BAR, total - chosenAt) : Math.min(FULL_BAR, total);
  const grownUp = evolved && percent >= FULL_BAR;
  const stage = evolved ? (grownUp ? 3 : 2) : 1;

  // The star can be dragged anywhere on its stage and stays where the child drops it.
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Limits live in a ref: a new gesture object would remount the star and restart its idle bounce.
  const limit = useRef({ x: 0, y: 0 });
  const STAR_SIZE = 230;
  // Offset-based drag: each move is measured from where the finger went down, so nothing drifts.
  const [tapTick, setTapTick] = useState(0);

  // Left alone the star dozes off; any touch wakes it up again.
  const [asleep, setAsleep] = useState(false);
  const sleepTimer = useRef(null);
  const wake = () => {
    setAsleep(false);
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
  };
  useEffect(() => {
    wake();
    return () => sleepTimer.current && clearTimeout(sleepTimer.current);
  }, []);

  // Stroking leaves a short trail of hearts behind the finger.
  const [hearts, setHearts] = useState([]);
  const heartId = useRef(0);
  const strokeRun = useRef(0);
  const dropHeart = () => {
    const id = (heartId.current += 1);
    setHearts((hs) => [...hs.slice(-4), { id, dx: (Math.random() - 0.5) * 110, dy: (Math.random() - 0.5) * 70 }]);
    setTimeout(() => setHearts((hs) => hs.filter((h) => h.id !== id)), 900);
  };

  // Where the stage and the candy button sit, so a dropped candy can be matched to the star.
  const stageSize = useRef({ w: 0, h: 0 });
  const dockBox = useRef({ x: 0, y: 0 });
  const candyBox = useRef({ x: 0, y: 0, w: 66, h: 66 });
  const candyPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;


  // Let go mid-swing and the star keeps flying, bouncing off the edges of its stage until it
  // runs out of speed. Animated.decay cannot bounce, so the throw is stepped by hand.
  const fling = useRef(null);
  const stopFling = () => {
    if (fling.current) cancelAnimationFrame(fling.current);
    fling.current = null;
  };
  useEffect(() => stopFling, []);

  const throwStar = (vx, vy) => {
    let x = pos.x.__getValue();
    let y = pos.y.__getValue();
    let last = null;
    const step = (now) => {
      if (last === null) last = now;
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      x += vx * dt;
      y += vy * dt;
      const { x: lx, y: ly } = limit.current;
      let hit = 0;
      if (x > lx || x < -lx) {
        x = x > 0 ? lx : -lx;
        hit = Math.abs(vx);
        vx = -vx * WALL_BOUNCE;
      }
      if (y > ly || y < -ly) {
        y = y > 0 ? ly : -ly;
        hit = Math.max(hit, Math.abs(vy));
        vy = -vy * WALL_BOUNCE;
      }
      if (hit > 400) playSound('pop');
      const damp = Math.pow(FLING_FRICTION, dt * 60);
      vx *= damp;
      vy *= damp;
      pos.setValue({ x, y });
      fling.current = Math.hypot(vx, vy) > 40 ? requestAnimationFrame(step) : null;
    };
    fling.current = requestAnimationFrame(step);
  };

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(() => {
          stopFling();
          pos.extractOffset();
          strokeRun.current = 0;
          wake();
        })
        .onUpdate((e) => {
          pos.setValue({ x: e.translationX, y: e.translationY });
          strokeRun.current += Math.abs(e.changeX || 0) + Math.abs(e.changeY || 0);
          if (strokeRun.current > 70) {
            strokeRun.current = 0;
            dropHeart();
          }
        })
        .onEnd((e) => {
          pos.flattenOffset();
          const clamp = (v, max) => Math.max(-max, Math.min(max, v));
          pos.setValue({
            x: clamp(pos.x.__getValue(), limit.current.x),
            y: clamp(pos.y.__getValue(), limit.current.y),
          });
          if (Math.hypot(e.velocityX, e.velocityY) > 200) throwStar(e.velocityX * 0.7, e.velocityY * 0.7);
        }),
    []
  );

  // Two fingers resize the character; the pan keeps working at the same time.
  const scale = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(1);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .simultaneousWithExternalGesture(drag)
        .onUpdate((e) => {
          scale.setValue(Math.max(0.2, Math.min(3, baseScale.current * e.scale)));
        })
        .onEnd(() => {
          baseScale.current = scale.__getValue();
        }),
    [drag]
  );

  const full = percent >= FULL_BAR;
  const chosen = EVOLUTIONS.find((e) => e.id === evolved);

  // Rebuilt only when the character itself changes — never when candy or scene state moves.
  // No memo here: re-creating this element remounts the star and restarts its float — that is the
  // tick. The gesture object is already stable, so plain rendering is safe.



  // Every feed floats a "+1" above the star, then clears itself.
  // Tapping fast used to stack separate "+1" badges on top of each other. One badge that counts
  // up, and keeps its own timer, reads like the star swallowing a handful of candy.
  const [combo, setCombo] = useState(0);
  const comboFade = useRef(new Animated.Value(0)).current;
  const comboTimer = useRef(null);
  const [feedTick, setFeedTick] = useState(0);

  const feedStar = () => {
    if (food <= 0) return;
    wake();
    playSound('pop');
    onFeed();
    setFeedTick((n) => n + 1);
    setCombo((n) => n + 1);
    comboFade.stopAnimation();
    comboFade.setValue(1);
    if (comboTimer.current) clearTimeout(comboTimer.current);
    comboTimer.current = setTimeout(() => {
      Animated.timing(comboFade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setCombo(0));
    }, 700);
  };

  useEffect(() => () => comboTimer.current && clearTimeout(comboTimer.current), []);

  // Carrying a candy to the star feeds it; the gesture reads the latest feedStar through a ref
  // so the candy count it checks is never a stale one.
  const feedRef = useRef(feedStar);
  feedRef.current = feedStar;
  const candyDrag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate((ev) => {
          candyPos.setValue({ x: ev.translationX, y: ev.translationY });
        })
        .onEnd((ev) => {
          const cx = dockBox.current.x + candyBox.current.x + candyBox.current.w / 2 + ev.translationX;
          const cy = dockBox.current.y + candyBox.current.y + candyBox.current.h / 2 + ev.translationY;
          const sx = stageSize.current.w / 2 + pos.x.__getValue();
          const sy = stageSize.current.h / 2 + pos.y.__getValue();
          if (Math.hypot(cx - sx, cy - sy) < FEED_REACH) feedRef.current();
          Animated.spring(candyPos, { toValue: { x: 0, y: 0 }, useNativeDriver: true, friction: 7 }).start();
        }),
    []
  );

  const stageBlock = (
    <GestureDetector gesture={drag}>
      <Animated.View style={{ transform: [...pos.getTranslateTransform(), { scale }] }}>
        {/* Pan claims the touch before a Tap gesture can settle, so a Pressable catches the quick
            taps; the pan still wins once the finger actually moves. */}
        <Pressable onPress={() => { wake(); playSound('pop'); setTapTick((n) => n + 1); }}>
          <StarStage
            art={costume ? costume[chosen?.id || 'dino'] : chosen ? (grownUp ? chosen.grown : chosen.art) : STAGE1_ART}
            ready={full && !chosen}
            evolved={costume ? `${chosen?.id || 'dino'}-costume-${costume.id}` : chosen ? `${chosen.id}-${grownUp ? 3 : 2}` : null}
            feedTick={feedTick}
            tapTick={tapTick}
          />
        </Pressable>
        {hearts.map((h) => (
          <Heart key={h.id} dx={h.dx} dy={h.dy} />
        ))}
        {asleep ? <Text style={styles.sleepZ} pointerEvents="none">zZZ</Text> : null}
        {combo ? (
          <Animated.Text
            pointerEvents="none"
            style={[
              styles.charPopText,
              {
                opacity: comboFade,
                transform: [{ scale: comboFade.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
              },
            ]}
          >
            +{combo}
          </Animated.Text>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );

  return (
    <View style={styles.charScreen}>
      <GestureDetector gesture={pinch}>
      <View
        style={[styles.charStage, { backgroundColor: current.sky }]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          stageSize.current = { w: width, h: height };
          limit.current = { x: Math.max(0, (width - STAR_SIZE) / 2), y: Math.max(0, (height - STAR_SIZE) / 2) };
        }}
      >
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="scene" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={current.sky} />
              <Stop offset="1" stopColor={current.ground} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#scene)" />
          {current.stars
            ? STAR_FIELD.map((st, i) => (
                <Circle key={i} cx={`${st.x}%`} cy={`${st.y}%`} r={st.r} fill="#ffffff" opacity={st.o} />
              ))
            : null}
        </Svg>
        {/* Painted backdrops sit over the gradient; the gradient is the fallback for the rest. */}
        {current.image ? (
          <Image source={current.image} style={styles.sceneImage} resizeMode="cover" pointerEvents="none" />
        ) : null}

        <View style={styles.starLayer} pointerEvents="box-none">
          {stageBlock}
        </View>

        {full && !chosen ? (
          <View style={styles.evolveWrap}>
            <Text style={styles.evolveTitle}>어떤 모습으로 자랄까?</Text>
            <View style={styles.evolveRow}>
              {EVOLUTIONS.map((e) => (
                <TouchableOpacity
                  key={e.id}
                  style={styles.evolveCard}
                  onPress={() => { playSound('fanfare'); setEvolved(e.id); setEvolvedAt(fed * GROWTH_PER_CANDY); }}
                >
                  <Image source={e.art} style={styles.evolveArt} resizeMode="contain" />
                  <Text style={styles.evolveLabel}>{e.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* Candy and closet live in the scene itself, as pictures with a count on them. */}
        <View
          style={styles.charDock}
          pointerEvents="box-none"
          onLayout={(e) => {
            dockBox.current = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y };
          }}
        >
          <TouchableOpacity
            style={styles.charPanelBtn}
            onPress={() => { playSound('pop'); setPanel((v) => !v); }}
          >
            <Text style={styles.charPanelBtnText}>{panel ? '✕' : '⚙'}</Text>
          </TouchableOpacity>
          <GestureDetector gesture={candyDrag}>
            <Animated.View
              style={{ transform: candyPos.getTranslateTransform(), zIndex: 6 }}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                candyBox.current = { x, y, w: width, h: height };
              }}
            >
              <TouchableOpacity style={[styles.charDockBtn, food <= 0 && styles.charItemOff]} onPress={feedStar}>
                <Image source={CANDY_ICON} style={styles.charDockArt} resizeMode="contain" />
                <View style={styles.charDockBadge}><Text style={styles.charDockBadgeText}>{food}</Text></View>
              </TouchableOpacity>
            </Animated.View>
          </GestureDetector>
          <TouchableOpacity style={styles.charDockBtn} onPress={() => { playSound('pop'); setCloset(true); }}>
            <Image source={CLOSET_ICON} style={styles.charDockArt} resizeMode="contain" />
            <View style={styles.charDockBadge}><Text style={styles.charDockBadgeText}>{COSTUMES.length}</Text></View>
          </TouchableOpacity>
        </View>

        {closet ? (
          <View style={styles.evolveWrap}>
            <Text style={styles.evolveTitle}>오늘은 뭘 입을까?</Text>
            <View style={styles.costumeRow}>
              {COSTUMES.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.costumeCard, costume?.id === item.id && styles.costumeCardOn]}
                  onPress={() => wearCostume(item)}
                >
                  <Image source={item.icon} style={styles.costumeArt} resizeMode="contain" />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.costumeClose} onPress={() => setCloset(false)}>
              <Text style={styles.costumeCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Animated.View style={[styles.charFlash, { opacity: flash }]} pointerEvents="none" />

        {panel ? (
          <View style={styles.charPanel}>
            <Text style={styles.charCardTitle}>성장도</Text>
            <View style={styles.charBarTrack}>
              <View style={[styles.charBarFill, { width: `${percent}%` }]} />
              {GROWTH_CHECKPOINTS.map((c) => (
                <View
                  key={c}
                  style={[
                    styles.charCheck,
                    { left: `${c}%`, marginLeft: c === 0 ? 0 : c === 100 ? -14 : -7 },
                    percent >= c && styles.charCheckOn,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.charGrowthValue}>{stage}단계 · {percent}%</Text>
            <View style={styles.charPanelLine} />
            <Text style={styles.charCardTitle}>배경 바꾸기</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneStrip}>
              {SCENES.map((sc) => (
                <TouchableOpacity key={sc.id} style={styles.sceneCell} onPress={() => { playSound('pop'); setScene(sc.id); }}>
                  <Image source={sc.image} style={[styles.sceneThumb, scene === sc.id && styles.sceneThumbOn]} resizeMode="cover" />
                  <Text style={[styles.sceneLabel, scene === sc.id && styles.sceneLabelOn]}>{sc.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
      </GestureDetector>
    </View>
  );
}

// The grown-up's view: a month of weeks down the left, what happened in the middle, and what the
// child kept coming back to on the right.
const PARENT_WEEKS = ['1주 주간 리포트', '2주 주간 리포트', '3주 주간 리포트', '4주 주간 리포트'];

// Pictures for the topics the pipeline surfaces most often.
const STAT_ART = {
  book: require('./assets/scenes/stat-book.png'),
  quiz: require('./assets/scenes/stat-quiz.png'),
  puzzle: require('./assets/scenes/stat-puzzle.png'),
  paint: require('./assets/scenes/stat-paint.png'),
};

const INTEREST_ART = {
  '공룡': require('./assets/scenes/interest-dino.png'),
  '요리': require('./assets/scenes/interest-cook.png'),
  '우주 · 행성': require('./assets/scenes/interest-planet.png'),
};

const MOCK_REPORT = [
  {
    minutes: [12, 26, 18, 31, 15, 34, 25],
    stats: { stories: 10, quiz: 16, puzzle: 7, drawing: 4 },
    deltas: { stories: 2, quiz: 5, puzzle: 4, drawing: -2 },
    interests: ['공룡', '요리', '우주 · 행성'],
    moments: [
      { tag: '퍼즐 완주 횟수 증가', lead: '끈기 있게 끝까지', head: ' 도전했어요',
        body: '포기하지 않고 퍼즐을 끝까지 완료한 비율이\n지난주보다 올랐어요', art: STAT_ART.puzzle },
      { tag: '이야기 설명 비중 증가', lead: '이유를 설명하는 표현', head: '이 늘었어요',
        body: "이번 주 이야기 속에서 '왜냐하면'처럼 이유를\n설명하는 말이 지난주보다 늘었어요", art: STAT_ART.book },
      { tag: '그림 활동 창의성 및 탐구 증가', lead: '다양하게', head: ' 표현했어요',
        body: '그림에 사용한 색이나 모양의 종류가\n지난주보다 훨씬 다양해졌어요', art: STAT_ART.paint },
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
// Bars rise from this offset; the average line and its badge hang off the same base.

// The rim is a gradient, so it has to be drawn — and a drawn rim needs the chip's real size.
function InterestChip({ label }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <View style={styles.parentChip} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {box.width ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={`chipRim-${label}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#609EF5" />
              <Stop offset="0.5" stopColor="#BADAFF" />
              <Stop offset="1" stopColor="#609EF5" />
            </LinearGradient>
          </Defs>
          <Rect
            x={0.8}
            y={0.8}
            width={box.width - 1.6}
            height={box.height - 1.6}
            rx={(box.height - 1.6) / 2}
            fill="none"
            stroke={`url(#chipRim-${label})`}
            strokeWidth={1.6}
          />
        </Svg>
      ) : null}
      {INTEREST_ART[label] ? <Image source={INTEREST_ART[label]} style={styles.parentChipArt} resizeMode="contain" /> : null}
      <Text style={styles.parentChipText}>{label}</Text>
    </View>
  );
}

// Content check without watching a video to the right second: every authored question, openable.
function QuizDebugScreen({ onPlay }) {
  return (
    <ScrollView contentContainerStyle={styles.qdBody} showsVerticalScrollIndicator={false}>
      {Object.entries(OFFLINE_ACTIVITIES).map(([videoId, activities]) => (
        <View key={videoId} style={styles.qdGroup}>
          <Text style={styles.qdVideo}>{videoId} · {activities.length}개</Text>
          {activities.map((a) => {
            const payload = typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {};
            return (
              <TouchableOpacity
                key={a.id}
                style={styles.qdRow}
                onPress={() => onPlay({ ...payload, kind: payload.activity_template }, videoId, a.at ?? a.at_sec)}
              >
                <Text style={styles.qdAt}>{a.at ?? a.at_sec}s</Text>
                <View style={styles.qdText}>
                  <Text style={styles.qdKind}>{payload.activity_template || a.type}</Text>
                  <Text style={styles.qdTitle} numberOfLines={1}>{payload.title || '(퍼즐)'}</Text>
                </View>
                <Text style={styles.qdAnswer}>{payload.answer || ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <Text style={styles.qdVideo}>데모 문제 · {QUIZ_POOL.length}개</Text>
      {QUIZ_POOL.map((q, i) => (
        <TouchableOpacity key={q.kind + i} style={styles.qdRow} onPress={() => onPlay(q)}>
          <Text style={styles.qdAt}>데모</Text>
          <View style={styles.qdText}>
            <Text style={styles.qdKind}>{QUIZ_KINDS[q.kind] || q.kind}</Text>
            <Text style={styles.qdTitle} numberOfLines={1}>{q.title}</Text>
          </View>
          <Text style={styles.qdAnswer}>{q.answer}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function ParentReportScreen({ profile, report, words }) {
  const [week, setWeek] = useState(0);
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const monthRef = useRef(null);
  // Minutes per day. Real numbers land here once sessions are recorded server-side; the week
  // selector shifts them so the screen behaves like the finished thing.
  const data = MOCK_REPORT[week];
  const newWords = words.slice(0, 4);
  const childName = profile?.name || '우리 아이';
  const moments = data.moments || MOCK_REPORT[0].moments;

  const stats = [
    { art: STAT_ART.book, value: data.stats.stories, unit: '편', label: '완성한 이야기', delta: data.deltas.stories },
    { art: STAT_ART.quiz, value: data.stats.quiz, unit: '개', label: '완료한 퀴즈', delta: data.deltas.quiz },
    { art: STAT_ART.puzzle, value: data.stats.puzzle, unit: '개', label: '완성한 퍼즐', delta: data.deltas.puzzle },
    { art: STAT_ART.paint, value: data.stats.drawing, unit: '개', label: '완료한 그림', delta: data.deltas.drawing },
  ];


  return (
    <View style={styles.parentScroll}>
      <View style={styles.parentBody}>
      <View style={styles.parentCol}>
        <Text style={styles.parentTitle}>부모 리포트</Text>
        <Text style={styles.parentSub}>이번 달 아이 학습에 대한 분석을 살펴보세요.</Text>

        <View style={styles.parentMonthWrap}>
          <TouchableOpacity style={styles.parentMonthNav} onPress={() => setMonth((m) => Math.max(1, m - 1))}>
            <Text style={styles.parentMonthArrow}>‹</Text>
          </TouchableOpacity>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.parentMonthRow}
            ref={monthRef}
            onLayout={() => monthRef.current?.scrollToEnd({ animated: false })}
          >
          {Array.from({ length: today.getMonth() + 1 }, (_, i) => i + 1).map((m) => (
            <TouchableOpacity key={m} onPress={() => { playSound('pop'); setMonth(m); }}>
              <View style={[styles.parentMonth, month !== m && styles.parentMonthOff]}>
                {month === m ? (
                  <Svg style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id="monthGrad" x1="0" y1="0" x2="0.6" y2="1">
                        <Stop offset="0" stopColor="#7db4ff" />
                        <Stop offset="1" stopColor="#2f62c4" />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="100%" height="100%" rx={42} fill="url(#monthGrad)" />
                  </Svg>
                ) : null}
                <Text style={[styles.parentMonthYear, month !== m && styles.parentMonthYearOff]}>{today.getFullYear()}</Text>
                <Text style={[styles.parentMonthNum, month !== m && styles.parentMonthNumOff]}>{m}</Text>
              </View>
            </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.parentMonthNav} onPress={() => setMonth((m) => Math.min(today.getMonth() + 1, m + 1))}>
            <Text style={styles.parentMonthArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {PARENT_WEEKS.map((label, i) => (
          <TouchableOpacity
            key={label}
            style={[styles.parentWeek, week === i && styles.parentWeekOn]}
            onPress={() => setWeek(i)}
          >
            <Text style={[styles.parentWeekText, week === i && styles.parentWeekTextOn]}>{month}월 {label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.parentDivider} />

      <View style={styles.parentColWide}>
        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>{childName}이가 자란 순간들</Text></View>
        <Text style={styles.parentHint}>이번 주 {childName}이가 <Text style={styles.parentHintOn}>스스로 해낸 순간들</Text>을 모아봤어요</Text>
        {moments.map((mo) => (
          <View key={mo.tag} style={styles.momentCard}>
            <Image source={mo.art} style={styles.momentArt} resizeMode="contain" />
            <Text style={styles.momentTag}>{mo.tag}</Text>
            <Text style={styles.momentHead}>
              <Text style={styles.momentHeadOn}>{mo.lead}</Text>{mo.head}
            </Text>
            <Text style={styles.momentBody}>{mo.body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.parentDivider} />

      <View style={styles.parentColRight}>
        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>숨은 관심사</Text></View>
        <Text style={styles.parentHint}>최근 2주 시청기록에서 반복적으로 등장한 주제 중심으로 3개 보여드려요</Text>
        <View style={styles.parentChips}>
          {data.interests.map((t) => (
            <InterestChip key={t} label={t} />
          ))}
        </View>

        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>이번 주 활동 요약</Text></View>
        <View style={styles.parentStatGrid}>
          {stats.map((st) => (
            <View key={st.label} style={styles.parentStat}>
              <View style={styles.parentStatHead}>
                <Image source={st.art} style={styles.parentStatArt} resizeMode="contain" />
                <Text style={styles.parentStatValue}>{st.value}</Text>
                <Text style={styles.parentStatUnit}>{st.unit}</Text>
              </View>
              <Text style={styles.parentStatLabel}>{st.label}</Text>
              <Text style={[styles.parentStatDelta, st.delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                지난주 대비 {Math.abs(st.delta)}{st.unit} {st.delta >= 0 ? '▲' : '▼'}
              </Text>
            </View>
          ))}
        </View>
      </View>
      </View>
    </View>
  );
}

// Every word the child met in a quiz, kept with its meaning and a sentence to say it in.
function WordsScreen({ words }) {
  if (!words.length) {
    return (
      <View style={styles.tabPlaceholder}>
        <Text style={styles.mainGreetingSub}>퀴즈를 풀면 단어가 모여요</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.wordGrid} showsVerticalScrollIndicator={false}>
      {words.map((w) => (
        <View key={w.word} style={styles.wordCard}>
          <View style={styles.wordHead}>
            <View style={[styles.wordDot, { backgroundColor: w.color || '#00CFE9' }]} />
            <Text style={styles.wordText}>{w.word}</Text>
            {w.answer ? <Text style={styles.wordBadge}>정답</Text> : null}
          </View>
          <Text style={styles.wordMeaning}>{w.meaning}</Text>
          <Text style={styles.wordExample}>“{w.example}”</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// The grown-ups' screen: what the child is allowed to do, and for how long.
function SettingsScreen({ profile, settings, onChange, onEditProfile }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const act = (key) => set({ activities: { ...settings.activities, [key]: !settings.activities[key] } });
  return (
    <ScrollView contentContainerStyle={styles.settingsBody} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>아이 정보</Text>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>이름</Text>
          <Text style={styles.settingsValue}>{profile.name || '친구'}</Text>
        </View>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>나이</Text>
          <Text style={styles.settingsValue}>{ageLabel(profile.birth) || '-'}</Text>
        </View>
        <TouchableOpacity style={styles.settingsEdit} onPress={onEditProfile}>
          <Text style={styles.settingsEditText}>프로필 수정</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>하루 사용 시간</Text>
        <DailyLimitPicker value={settings.dailyLimit} onSelect={(dailyLimit) => set({ dailyLimit })} />
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>활동</Text>
        {[
          ['quiz', '퀴즈', '영상 중간에 질문을 물어봐요'],
          ['trace', '그림', '영상이 끝나면 그림을 그려요'],
          ['puzzle', '퍼즐', '영상 중간에 퍼즐을 맞춰요'],
        ].map(([key, label, hint]) => (
          <TouchableOpacity key={key} style={styles.settingsRow} onPress={() => act(key)}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsLabel}>{label}</Text>
              <Text style={styles.settingsHint}>{hint}</Text>
            </View>
            <View style={[styles.toggle, settings.activities[key] && styles.toggleOn]}>
              <View style={[styles.toggleKnob, settings.activities[key] && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>소리</Text>
        <TouchableOpacity style={styles.settingsRow} onPress={() => set({ sound: !settings.sound })}>
          <View style={styles.settingsRowText}>
            <Text style={styles.settingsLabel}>효과음</Text>
            <Text style={styles.settingsHint}>버튼과 정답 소리를 켜요</Text>
          </View>
          <View style={[styles.toggle, settings.sound && styles.toggleOn]}>
            <View style={[styles.toggleKnob, settings.sound && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function HomeScreen({ characterImage, onStart, profile, tab = 'library', onTab, onBack, series, settings, onSettings, onEditProfile, words = [], feed = 0, fed = 0, onFeed, report = {}, onJumpMoment }) {
  const [focus, setFocus] = useState(0);
  const [previewQuiz, setPreviewQuiz] = useState(null);
  const [previewPick, setPreviewPick] = useState(null);
  // A card on the main screen opens that series; without one, fall back to the popular row.
  const category = series ? { videos: series.episodes || [] } : LIBRARY[0];

  return (
    <View style={styles.screen}>
      {previewQuiz ? (
        <QuizOverlay
          quiz={previewQuiz}
          selected={previewPick}
          tries={previewPick && previewPick !== previewQuiz.answer ? 1 : 0}
          onAnswer={setPreviewPick}
          onRetry={() => setPreviewPick(null)}
          onResume={() => { setPreviewQuiz(null); setPreviewPick(null); }}
          onSkip={() => { setPreviewQuiz(null); setPreviewPick(null); }}
        />
      ) : null}
      {tab !== 'library' ? (
        <View style={styles.tabScreen}>
          <View style={styles.tabHead}>
            <TouchableOpacity style={styles.backChip} onPress={onBack}>
              <Text style={styles.backChipText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.tabHeadTitle}>{(TABS.find((t) => t.key === tab) || {}).label}</Text>
          </View>
          {tab === 'quizdebug' ? (
            <QuizDebugScreen
              onPlay={(q, videoId, at) => {
                // Seeing it in place beats seeing it alone: play the video from just before the cue.
                if (videoId && onJumpMoment) onJumpMoment(videoId, at);
                else { setPreviewQuiz(q); setPreviewPick(null); }
              }}
            />
          ) : tab === 'parent' ? (
            <ParentReportScreen profile={profile} report={report} words={words} />
          ) : tab === 'character' ? (
            <CharacterScreen profile={profile} food={feed - fed} fed={fed} onFeed={onFeed} />
          ) : tab === 'words' ? (
            <WordsScreen words={words} />
          ) : tab === 'settings' ? (
            <SettingsScreen profile={profile} settings={settings} onChange={onSettings} onEditProfile={onEditProfile} />
          ) : (
            <View style={styles.tabPlaceholder}>
              <Text style={styles.mainGreetingSub}>{(TABS.find((t) => t.key === tab) || {}).label} 화면은 준비 중이에요</Text>
            </View>
          )}
        </View>
      ) : (
      <>
      <View style={styles.libHeader}>
        {onBack ? (
          <TouchableOpacity style={styles.backChip} onPress={onBack}>
            <Text style={styles.backChipText}>‹</Text>
          </TouchableOpacity>
        ) : null}
        <PattiCharacter species={profile?.species} level={profile?.level} size={0.86} />
        <View style={styles.libGreetText}>
          <Text style={styles.libTitle}>{series ? series.title : '오늘은 뭐 볼까?'}</Text>
          <Text style={styles.libSubtitle}>{series ? series.duration : '보고 싶은 영상을 골라봐'}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_W + CARD_GAP}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => setFocus(Math.round(e.nativeEvent.contentOffset.x / (CARD_W + CARD_GAP)))}
        contentContainerStyle={styles.carouselContent}
      >
        {category.videos.map((v, i) => (
          <TapScale
            key={v.id}
            style={[styles.card, { backgroundColor: v.color }, i === focus && styles.cardFocused]}
            onPress={() => { playSound('pop'); onStart(v); }}
          >
            <CardSheen color={v.color} />
            <Text style={styles.cardTitle} numberOfLines={2}>{v.title}</Text>
            <Text style={styles.cardSub} numberOfLines={1}>{v.duration}</Text>
            <Image source={v.thumb || THUMBS[i % THUMBS.length]} style={styles.cardArt} resizeMode="contain" />
          </TapScale>
        ))}
      </ScrollView>
      </>
      )}
    </View>
  );
}

// Demo stand-in for the pre-generated content schedule. Later: load per video_id from the
// analysis pipeline's activities.json — same shape { at: seconds, type }.
const ACTIVITY_SLOTS = [
  { at: 10, type: 'quiz', pick: 0 },
  { at: 20, type: 'quiz', pick: 1, then: 'traceword' },
  { at: 30, type: 'puzzle' },
  { at: 40, type: 'quiz', pick: 2 },
];

// Trace a word over its own outline: the guide letters are a real glyph path, so "did the child
// stay on the letters?" is answered by asking the path, not by eyeballing a picture.
const TRACE_FONT = require('./assets/fonts/Pretendard-Bold.otf');
const TRACE_SIZE = 150;
const TRACE_TOLERANCE = 26; // a five-year-old's hand wobbles; count near-misses as on the letter
const TRACE_GRID = 18;

function judgeTrace(glyph, points) {
  if (!glyph || points.length < 12) return null;
  const near = (x, y) => {
    if (glyph.contains(x, y)) return true;
    for (let a = 0; a < 8; a += 1) {
      const t = (a * Math.PI) / 4;
      if (glyph.contains(x + Math.cos(t) * TRACE_TOLERANCE, y + Math.sin(t) * TRACE_TOLERANCE)) return true;
    }
    return false;
  };

  // How much of the writing landed on the letters.
  let on = 0;
  for (const p of points) if (near(p.x, p.y)) on += 1;
  const onRatio = on / points.length;

  // How much of the letters got written over: one scribble in a corner must not pass.
  const b = glyph.getBounds();
  let cells = 0;
  let covered = 0;
  for (let x = b.x; x < b.x + b.width; x += TRACE_GRID) {
    for (let y = b.y; y < b.y + b.height; y += TRACE_GRID) {
      if (!glyph.contains(x, y)) continue;
      cells += 1;
      if (points.some((p) => Math.abs(p.x - x) < TRACE_GRID * 1.6 && Math.abs(p.y - y) < TRACE_GRID * 1.6)) covered += 1;
    }
  }
  const coverRatio = cells ? covered / cells : 0;
  return { onRatio, coverRatio, pass: onRatio >= 0.7 && coverRatio >= 0.45 };
}

function TraceWordOverlay({ word, onDone }) {
  const font = useFont(TRACE_FONT, TRACE_SIZE);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState([]);
  const [live, setLive] = useState([]);
  const [verdict, setVerdict] = useState(null);

  const glyph = useMemo(() => {
    if (!font || !box.width) return null;
    const w = font.measureText(word).width;
    return Skia.Path.MakeFromText(word, (box.width - w) / 2, box.height / 2 + TRACE_SIZE * 0.35, font);
  }, [font, box.width, box.height, word]);

  const pen = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => setLive([{ x: e.x, y: e.y }]))
        .onUpdate((e) => setLive((prev) => [...prev, { x: e.x, y: e.y }]))
        .onEnd(() => {
          setLive((prev) => {
            if (prev.length) setStrokes((all) => [...all, prev]);
            return [];
          });
        }),
    []
  );

  const toPath = (pts) => {
    const p = Skia.Path.Make();
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    return p;
  };

  const check = () => {
    const result = judgeTrace(glyph, strokes.flat());
    if (!result) return;
    setVerdict(result);
    if (result.pass) {
      playSound('success');
      speak('correct');
    } else {
      playSound('wrong');
      speak('retry');
    }
  };

  return (
    <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={onDone}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={styles.traceWordScrim}>
    <View style={styles.traceWord}>
      <Text style={styles.traceWordTitle}>{verdict ? (verdict.pass ? '잘 썼어요!' : '조금만 더 또박또박!') : `'${word}' 를 따라 써 볼까?`}</Text>

      <GestureDetector gesture={pen}>
        <View style={styles.traceWordPad} onLayout={(e) => setBox(e.nativeEvent.layout)} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill}>
            {glyph ? <SkiaPath path={glyph} color="#dfe6f5" /> : null}
            {strokes.map((st, i) => (
              <SkiaPath key={i} path={toPath(st)} color="#171d31" style="stroke" strokeWidth={12} strokeCap="round" strokeJoin="round" />
            ))}
            {live.length ? (
              <SkiaPath path={toPath(live)} color="#171d31" style="stroke" strokeWidth={12} strokeCap="round" strokeJoin="round" />
            ) : null}
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.traceWordActions}>
        <TouchableOpacity style={styles.lightButton} onPress={() => { setStrokes([]); setVerdict(null); }}>
          <Text style={styles.lightButtonText}>지우고 다시</Text>
        </TouchableOpacity>
        {verdict?.pass ? (
          <TapScale style={styles.darkButton} onPress={() => { playSound('pop'); onDone(); }}>
            <Text style={styles.darkButtonText}>영상 이어보기</Text>
          </TapScale>
        ) : (
          <TapScale style={styles.blueButton} onPress={check}>
            <Text style={styles.blueButtonText}>다 썼어요</Text>
          </TapScale>
        )}
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.traceWordSkip}>건너뛰기</Text>
        </TouchableOpacity>
      </View>
    </View>
    </View>
    </GestureHandlerRootView>
    </Modal>
  );
}

// Announcement shown right before each activity starts.
const ACT_MSG = {
  quiz: { text: '같이 퀴즈 풀어보자!', emoji: '🧠' },
  puzzle: { text: '퍼즐 맞춰볼까?', emoji: '🧩' },
  traceword: { text: '같이 따라 써 보자!', emoji: '✏️' },
  findit: { text: '숨은 그림을 찾아보자!', emoji: '🔍' },
  drag: { text: '제자리로 옮겨볼까?', emoji: '📦' },
  count: { text: '몇 개인지 세어보자!', emoji: '🔢' },
  say: { text: '소리 내어 말해볼까?', emoji: '🗣️' },
};

// Toss-style center popup with a spring pop-in. Self-animates on mount.
// Development differs month to month at this age, so the profile takes a birth date, not a year.
function ageInMonths(birth) {
  if (!birth || !birth.y || !birth.m || !birth.d) return null;
  const now = new Date();
  const months = (now.getFullYear() - birth.y) * 12 + (now.getMonth() + 1 - birth.m);
  return now.getDate() < birth.d ? months - 1 : months;
}

// Tap a field, pick from a scrolling list — the pattern grown-ups expect from a date field.
function BirthDropdown({ values, value, unit, onSelect }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);
  const index = Math.max(0, values.indexOf(value));
  return (
    <>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(true)}>
        <Text style={styles.dropdownValue}>{value != null ? `${value}${unit}` : `-${unit}`}</Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)} supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet}>
            <ScrollView
              ref={listRef}
              showsVerticalScrollIndicator={false}
              onLayout={() => listRef.current?.scrollTo({ y: Math.max(0, (index - 2) * 48), animated: false })}
            >
              {values.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.dropdownOption, v === value && styles.dropdownOptionOn]}
                  onPress={() => { onSelect(v); setOpen(false); }}
                >
                  <Text style={[styles.dropdownOptionText, v === value && styles.dropdownOptionTextOn]}>{v}{unit}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const THIS_YEAR = new Date().getFullYear();

function ageLabel(birth) {
  const months = ageInMonths(birth);
  if (months == null || months < 0 || months > 300) return '';
  return `만 ${Math.floor(months / 12)}세 ${months % 12}개월`;
}
// 10 to 180 minutes. Too many values for a chip row, hence the scrolling picker below.
const DAILY_LIMITS = Array.from({ length: 18 }, (_, i) => (i + 1) * 10);
const LIMIT_ITEM_W = 88;
const LIMIT_TRACK_W = 440;
const LIMIT_PAD = (LIMIT_TRACK_W - LIMIT_ITEM_W) / 2;

// Toss-style opener: one promise, one button, nothing to decide yet.
function OnboardIntroScreen({ onNext }) {
  return (
    <View style={styles.welcomeScreen}>
      <View style={styles.welcomeBody}>
        <Text style={styles.welcomeBadge}>시작하기 전에</Text>
        <Text style={styles.welcomeTitle}>아이에 대해 알아봐요!</Text>
        <Text style={styles.welcomeCopy}>
          이름과 나이를 알려주시면 아이에게 맞는 활동을 준비해요.{'\n'}
          사용 시간과 활동은 보호자가 정할 수 있어요.
        </Text>
      </View>
      <TapScale style={styles.welcomeButton} onPress={onNext}>
        <Text style={styles.welcomeButtonText}>시작하기</Text>
      </TapScale>
    </View>
  );
}

// First run, step 1: who is drawing today.
// Tap the circle to shoot a profile photo; the character stands in until there is one.
function ProfilePhotoPicker({ photo, tone, onPick }) {
  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('카메라 권한 필요', '설정에서 카메라 권한을 허용하면 사진을 찍을 수 있어요.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!shot.canceled) onPick(shot.assets[0].uri);
  };

  return (
    <TouchableOpacity
      style={styles.photoCircle}
      onPress={take}
      accessibilityRole="button"
      accessibilityLabel={photo ? '프로필 사진 다시 찍기' : '프로필 사진 찍기'}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photoImage} />
      ) : (
        <PattiCharacter tone={tone} size={0.85} />
      )}
      <View style={styles.photoBadge}>
        <Text style={styles.photoBadgeText}>📷</Text>
      </View>
    </TouchableOpacity>
  );
}

function ChildProfileScreen({ profile, onChange, onNext }) {
  const ready = profile.name.trim().length > 0 && ageInMonths(profile.birth) != null;
  return (
    <View style={styles.onboardScreen}>
      <View style={styles.onboardHeader}>
        <Text style={styles.onboardStep}>1 / 2</Text>
        <Text style={styles.onboardTitle}>아이 프로필</Text>
        <Text style={styles.onboardCopy}>이름과 나이를 알려주면 맞춤 활동을 준비해요.</Text>
      </View>

      <View style={styles.onboardBody}>
        <ProfilePhotoPicker
          photo={profile.photo}
          tone={profile.tone}
          onPick={(photo) => onChange({ ...profile, photo })}
        />
        <View style={styles.onboardFields}>
          <Text style={styles.onboardLabel}>닉네임</Text>
          <TextInput
            style={styles.onboardInput}
            value={profile.name}
            onChangeText={(name) => onChange({ ...profile, name })}
            placeholder="예: 하늘"
            placeholderTextColor="#a8b2c8"
            maxLength={10}
          />

          <Text style={styles.onboardLabel}>생년월일</Text>
          <View style={styles.birthRow}>
            <BirthDropdown
              values={range(THIS_YEAR - 8, THIS_YEAR)}
              value={profile.birth?.y}
              unit="년"
              onSelect={(y) => onChange({ ...profile, birth: { ...profile.birth, y } })}
            />
            <BirthDropdown
              values={range(1, 12)}
              value={profile.birth?.m}
              unit="월"
              onSelect={(m) => onChange({ ...profile, birth: { ...profile.birth, m } })}
            />
            <BirthDropdown
              values={range(1, 31)}
              value={profile.birth?.d}
              unit="일"
              onSelect={(d) => onChange({ ...profile, birth: { ...profile.birth, d } })}
            />
          </View>
          {ageLabel(profile.birth) ? <Text style={styles.birthAge}>{ageLabel(profile.birth)}</Text> : null}

        </View>
      </View>

      <TapScale style={[styles.darkButton, !ready && styles.buttonDisabled]} onPress={() => ready && onNext()}>
        <Text style={styles.darkButtonText}>다음</Text>
      </TapScale>
    </View>
  );
}

// First run, step 2: the grown-up rules for the session.
// Each card is a vertical wheel: the number under the middle of the card is the selection.
const WHEEL_ITEM_H = 62;

function StepperCard({ values, value, label, onChange }) {
  const ref = useRef(null);
  const index = Math.max(0, values.indexOf(value));
  return (
    <View style={styles.stepperCol}>
      <View style={styles.stepperCard}>
        <Text style={styles.stepperArrowText}>⌃</Text>
        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_ITEM_H}
          decelerationRate="fast"
          style={styles.stepperViewport}
          onLayout={() => ref.current?.scrollTo({ y: index * WHEEL_ITEM_H, animated: false })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
            const next = values[Math.min(values.length - 1, Math.max(0, i))];
            if (next !== value) { playSound('pop'); onChange(next); }
          }}
        >
          {values.map((v) => (
            <View key={v} style={styles.stepperItem}>
              <Text style={styles.stepperValue}>{String(v).padStart(2, '0')}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={[styles.stepperArrowText, styles.stepperArrowDown]}>⌄</Text>
      </View>
      <Text style={styles.stepperLabel}>{label}</Text>
    </View>
  );
}

const HOUR_VALUES = [0, 1, 2, 3, 4, 5, 6];
const MINUTE_VALUES = [0, 10, 20, 30, 40, 50];

function DailyLimitPicker({ value, onSelect }) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return (
    <View style={styles.stepperRow}>
      <StepperCard
        values={HOUR_VALUES}
        value={hours}
        label="시간"
        onChange={(h) => onSelect(Math.max(10, h * 60 + minutes))}
      />
      <Text style={styles.stepperColon}>:</Text>
      <StepperCard
        values={MINUTE_VALUES}
        value={minutes}
        label="분"
        onChange={(m) => onSelect(Math.max(10, hours * 60 + m))}
      />
    </View>
  );
}

function GuardianSetupScreen({ settings, onChange, onBack, onDone }) {
  return (
    <View style={styles.onboardScreen}>
      <View style={styles.onboardHeader}>
        <Text style={styles.onboardStep}>2 / 2</Text>
        <Text style={styles.onboardTitle}>보호자 설정</Text>
        <Text style={styles.onboardCopy}>사용 시간과 활동은 언제든 보호자 설정에서 바꿀 수 있어요.</Text>
      </View>

      <View style={[styles.onboardFields, styles.guardianFields]}>
        <Text style={styles.onboardLabel}>하루 사용 시간</Text>
        <DailyLimitPicker
          value={settings.dailyLimit}
          onSelect={(dailyLimit) => onChange({ ...settings, dailyLimit })}
        />

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => onChange({ ...settings, consent: !settings.consent })}
        >
          <View style={[styles.checkbox, settings.consent && styles.checkboxOn]}>
            <Text style={styles.checkboxMark}>{settings.consent ? '✓' : ''}</Text>
          </View>
          <View style={styles.consentTextWrap}>
            <Text style={styles.consentText}>
              <Text style={styles.consentRequired}>(필수) </Text>
              아이의 활동 기록·그림 데이터 수집 및 이용
            </Text>
            <Text style={styles.consentSub}>활동 응답과 그림은 보호자 리포트를 만드는 데만 쓰여요.</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.onboardActions}>
        <TouchableOpacity style={styles.lightButton} onPress={onBack}>
          <Text style={styles.lightButtonText}>이전</Text>
        </TouchableOpacity>
        <TapScale style={[styles.darkButton, !settings.consent && styles.buttonDisabled]} onPress={() => settings.consent && onDone()}>
          <Text style={styles.darkButtonText}>시작하기</Text>
        </TapScale>
      </View>
    </View>
  );
}

const EVOLVE_AT = 3;

// The one moment the child picks a species: the star has grown and becomes a friend.
function EvolvePopup({ onPick }) {
  return (
    <Modal transparent visible animationType="fade" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      <View style={styles.evolveBackdrop}>
        <View style={styles.evolveCard}>
          <Text style={styles.evolveTitle}>별이 자랐어요!</Text>
          <Text style={styles.evolveCopy}>어떤 친구가 될까?</Text>
          <View style={styles.evolveRow}>
            {[{ key: 'rabbit', label: '토끼' }, { key: 'dino', label: '공룡' }].map((c) => (
              <TouchableOpacity key={c.key} style={styles.evolveChoice} onPress={() => onPick(c.key)}>
                <Image source={CHARACTER_IMAGES[c.key]} style={styles.evolveImage} resizeMode="contain" />
                <Text style={styles.chipText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Speech bubble with the buddy leaning in from the left, per the mockup.
const POPUP_BUDDY = require('./assets/characters/dino.png');

function CenterPopup({ text, emoji = '✨' }) {
  const a = useRef(new Animated.Value(0)).current;
  const win = useWindowDimensions();
  useEffect(() => {
    Animated.spring(a, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  }, []);
  return (
    <Modal transparent visible animationType="fade" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ width: win.width, height: win.height, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        <View style={styles.praiseScrim} />
        <Animated.View
          style={[styles.praiseRow, { opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
        >
          <Image source={POPUP_BUDDY} style={styles.praiseBuddy} resizeMode="contain" />
          <View style={styles.praiseCard}>
            <Text style={styles.praiseText}>{text}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function WatchScreen({ source, plan = [], picks = [0, 1, 2], seekTo, onResult, onWatched, quizDone, onQuizAsk, onQuizCorrect, onQuizSkip, onFinish, onBack, onHome, onReport }) {
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const [selected, setSelected] = useState(null);
  // The four participation activities live in their own stage; quiz and puzzle keep their old path.
  const [stageActivity, setStageActivity] = useState(null);
  const [answered, setAnswered] = useState(quizDone);
  const [countdown, setCountdown] = useState(null);
  const [active, setActive] = useState(null); // current activity type: 'quiz' | 'puzzle' | null
  const [quizIndex, setQuizIndex] = useState(0);
  const [serverQuiz, setServerQuiz] = useState(null);
  const [tries, setTries] = useState(0);
  const [puzzleImage, setPuzzleImage] = useState(null);
  const quiz = serverQuiz || QUIZ_POOL[quizIndex];
  const activityId = useRef(null);
  const followUp = useRef(null);
  // Server plan wins; the built-in schedule is the demo fallback.
  const schedule = useMemo(() => {
    if (!plan.length) return ACTIVITY_SLOTS.map((a) => ({ ...a, quiz: picks[a.pick] ?? 0 }));
    return plan.map((a) => {
      let payload = {};
      try {
        payload = typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {};
      } catch (e) {
        payload = {};
      }
      return { at: a.at_sec ?? a.at, type: a.type, activityId: a.id, payload };
    });
  }, [plan, picks]);
  const [announce, setAnnounce] = useState(null); // activity type being announced before it opens
  const [celebrate, setCelebrate] = useState(false); // "잘했어요" popup between an activity and resuming the video
  const firedRef = useRef(new Set());

  // Brief "잘했어요" celebration, then resume the video.
  useEffect(() => {
    if (!celebrate) return undefined;
    playSound('fanfare');
    const id = setTimeout(() => {
      setCelebrate(false);
      player.play();
    }, 1600);
    return () => clearTimeout(id);
  }, [celebrate]);
  const cdAnim = useRef(new Animated.Value(1)).current;

  // Show the "같이 ~ 해보자" popup for a moment, then open the activity.
  useEffect(() => {
    if (!announce) return undefined;
    speak(announce);
    const id = setTimeout(() => {
      setActive(announce);
      setAnnounce(null);
    }, 1600);
    return () => clearTimeout(id);
  }, [announce]);

  // Pop each countdown number so the 3-2-1 feels intentional, not a static flash.
  useEffect(() => {
    if (countdown == null) return;
    cdAnim.setValue(0.5);
    Animated.spring(cdAnim, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [countdown]);

  // Drive triggers off the ACTIVITIES schedule: 3s countdown, then pause + show the activity.
  useEffect(() => {
    const id = setInterval(() => {
      const t = player.currentTime || 0;
      let cd = null;
      for (const a of schedule) {
        if (!firedRef.current.has(a.at) && t >= a.at - 3 && t < a.at) { cd = Math.ceil(a.at - t); break; }
      }
      setCountdown((prev) => (prev === cd ? prev : cd));
      for (const a of schedule) {
        if (!firedRef.current.has(a.at) && t >= a.at && t < a.at + 10) {
          firedRef.current.add(a.at);
          player.pause();
          if (a.type === 'quiz') {
            setSelected(null);
            // A pipeline question arrives whole in the payload; the demo pool is the fallback.
            const authored = a.payload && Array.isArray(a.payload.options) ? { ...a.payload, kind: a.payload.activity_template } : null;
            setServerQuiz(authored);
            setQuizIndex(a.quiz || 0);
            if (onQuizAsk) onQuizAsk(a.quiz || 0, authored);
          }
          if (STAGE_KINDS.has(a.type)) setStageActivity({ type: a.type, payload: a.payload || {} });
          followUp.current = a.then || null;
          setPuzzleImage(a.payload?.image ? PUZZLE_IMAGES[a.payload.image] : null);
          activityId.current = a.activityId || null;
          setAnnounce(a.type);
          break;
        }
      }
    }, 350);
    return () => clearInterval(id);
  }, [player, schedule]);

  // Debug jump: start just before the question we want to look at.
  useEffect(() => {
    if (seekTo == null) return;
    const id = setTimeout(() => {
      try {
        player.currentTime = seekTo;
        player.play();
      } catch (e) {
        // player not ready yet; the schedule still runs from the start
      }
    }, 600);
    return () => clearTimeout(id);
  }, [seekTo, player]);

  // When the video finishes, move to the final activities page.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      if (onWatched) onWatched(Math.round(player.currentTime || 0));
      onFinish();
    });
    return () => sub.remove();
  }, [player]);

  // Some slots chain: the question is answered first, then its answer word is traced.
  const resume = () => {
    if (followUp.current) {
      const next = followUp.current;
      followUp.current = null;
      setActive(next);
      return;
    }
    setActive(null);
    player.play();
  };
  const resumeTrace = resume;
  // Puzzle finished → show "잘했어요" popup, then the effect resumes the video.
  // Only a finished puzzle earns the praise popup; skipping goes straight back to the video.
  const resumePuzzle = (solved = true) => {
    setActive(null);
    if (solved) setCelebrate(true);
    else player.play();
  };
  const handleAnswer = (label) => {
    setSelected(label);
    const right = label === quiz.answer;
    if (onResult) onResult(activityId.current, right ? 'correct' : 'wrong', quiz.kind);
    if (right) {
      setAnswered(true);
      playSound('success');
      speak('correct');
      onQuizCorrect();
    } else {
      playSound('wrong');
      speak('retry');
    }
  };

  if (active === 'trace') {
    return (
      <View style={styles.watchScreen}>
        {onBack ? (
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>‹ 뒤로</Text>
          </TouchableOpacity>
        ) : null}
      {onBack ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>‹ 뒤로</Text>
        </TouchableOpacity>
      ) : null}
        <TraceOverlay onDone={resumeTrace} />
      </View>
    );
  }

  return (
    <View style={styles.watchScreen}>
      <View style={styles.videoCard}>
        <GradientRim radius={34} width={7} />
        {active !== 'puzzle' ? (
          <VideoView style={styles.video} player={player} nativeControls={active !== 'quiz'} contentFit="contain" surfaceType="textureView" />
        ) : null}
        {countdown != null && !active && !announce ? (
          <Animated.View style={[styles.countdown, { transform: [{ scale: cdAnim }] }]} pointerEvents="none">
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="cd" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#BADAFF" />
                  <Stop offset="1" stopColor="#FFFFFF" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" rx={39} fill="url(#cd)" />
            </Svg>
            <Text style={styles.countdownText}>{countdown}</Text>
          </Animated.View>
        ) : null}
        {announce ? <CenterPopup text={ACT_MSG[announce].text} emoji={ACT_MSG[announce].emoji} /> : null}
        {active === 'quiz' ? (
          <QuizOverlay
            selected={selected}
            quiz={quiz}
            tries={tries}
            onAnswer={handleAnswer}
            onRetry={() => setSelected(null)}
            onResume={resume}
            onSkip={() => {
              onQuizSkip();
              resume();
            }}
          />
        ) : null}
      </View>
      {stageActivity && active === stageActivity.type ? (
        <ActivityStage
          activity={stageActivity}
          onDone={(ok) => {
            // These activities have no failure state — the buddy solves it rather than letting
            // the child fail, so a finish is always "correct"; only closing early (back button)
            // is a skip. Same shape as handleAnswer's onResult call for the quiz path.
            if (onResult) onResult(activityId.current, ok ? 'correct' : 'skip', stageActivity.type);
            setStageActivity(null);
            resume();
          }}
        />
      ) : null}
      {active === 'traceword' ? (
        <TraceWordOverlay word={quiz.answer} onDone={resume} />
      ) : null}
      {active === 'puzzle' ? (
        <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={resumePuzzle}>
          <View style={styles.puzzleModal}>
            <TabletHeader rightLabel="보호자 설정" onHome={onHome} onReport={onReport} />
            <PuzzleScreen image={puzzleImage} onDone={(solved) => resumePuzzle(solved !== false)} />
          </View>
        </Modal>
      ) : null}
      {celebrate ? <CenterPopup text="잘했어요! 🎉" emoji="🎉" /> : null}
    </View>
  );
}

const COLOR_SWATCHES = ['#111111', '#e5484d', '#00CFE9', '#f5c518'];

// Recently mixed colours live outside React so every canvas screen shares one list.
const RECENT_COLORS = { list: [] };
function useRecentColors() {
  const [, bump] = useState(0);
  const add = (hex) => {
    if (!RECENT_COLORS.list.includes(hex)) RECENT_COLORS.list = [hex, ...RECENT_COLORS.list].slice(0, 8);
    bump((n) => n + 1);
  };
  return [RECENT_COLORS.list, add];
}

const rgbToHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

// One RGB channel, dragged like the pen-size rail.
function ChannelSlider({ label, value, tint, onChange }) {
  const [trackW, setTrackW] = useState(160);
  const pickRef = useRef(null);
  pickRef.current = (x) => onChange(Math.round(Math.min(1, Math.max(0, x / trackW)) * 255));
  const pan = useMemo(
    () => Gesture.Pan().runOnJS(true).minDistance(0).maxPointers(1)
      .onBegin((e) => pickRef.current(e.x))
      .onUpdate((e) => pickRef.current(e.x)),
    []
  );
  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelLabel}>{label}</Text>
      <GestureDetector gesture={pan}>
        <View style={styles.channelHit} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={styles.channelTrack} />
          <View style={[styles.channelFill, { width: `${(value / 255) * 100}%`, backgroundColor: tint }]} />
          <View style={[styles.channelThumb, { left: `${(value / 255) * 100}%` }]} />
        </View>
      </GestureDetector>
      <Text style={styles.channelValue}>{value}</Text>
    </View>
  );
}

// Grid of standard colours, mirroring the picker kids already see in Samsung Notes.
const PICKER_HUES = [0, 20, 40, 55, 80, 120, 160, 180, 200, 220, 245, 275, 300, 330];
const PICKER_LEVELS = [0.93, 0.85, 0.75, 0.65, 0.55, 0.45, 0.36, 0.27, 0.18];

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

function ColorPickerModal({ visible, initial, onCancel, onDone }) {
  const [tab, setTab] = useState('standard');
  const [color, setColor] = useState(initial);
  const [recent, addRecent] = useRecentColors();
  useEffect(() => {
    if (visible) setColor(initial);
  }, [visible, initial]);
  const rgb = hexToRgb(color);
  const setChannel = (i, v) => {
    const next = [...rgb];
    next[i] = v;
    setColor(rgbToHex(next));
  };
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      {/* Modal renders in its own native hierarchy, so gesture-handler needs a root here too. */}
      <GestureHandlerRootView style={styles.pickerBackdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.pickerTabs}>
            {[{ k: 'standard', t: '표준' }, { k: 'custom', t: '사용자 지정' }].map((x) => (
              <TouchableOpacity key={x.k} style={[styles.pickerTab, tab === x.k && styles.pickerTabOn]} onPress={() => setTab(x.k)}>
                <Text style={styles.pickerTabText}>{x.t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'standard' ? (
            <View style={styles.pickerGrid}>
              <View style={styles.pickerCol}>
                {PICKER_LEVELS.map((l) => {
                  const c = hslToHex(0, 0, l);
                  return <TouchableOpacity key={`g${l}`} style={[styles.pickerCell, { backgroundColor: c }, color === c && styles.pickerCellOn]} onPress={() => setColor(c)} />;
                })}
              </View>
              {PICKER_HUES.map((h) => (
                <View key={h} style={styles.pickerCol}>
                  {PICKER_LEVELS.map((l) => {
                    const c = hslToHex(h, 0.85, l);
                    return <TouchableOpacity key={`${h}-${l}`} style={[styles.pickerCell, { backgroundColor: c }, color === c && styles.pickerCellOn]} onPress={() => setColor(c)} />;
                  })}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.pickerCustom}>
              <ChannelSlider label="R" value={rgb[0]} tint="#e5484d" onChange={(v) => setChannel(0, v)} />
              <ChannelSlider label="G" value={rgb[1]} tint="#46a758" onChange={(v) => setChannel(1, v)} />
              <ChannelSlider label="B" value={rgb[2]} tint="#3b82f6" onChange={(v) => setChannel(2, v)} />
            </View>
          )}

          <View style={styles.pickerReadout}>
            <View style={[styles.pickerPreview, { backgroundColor: color }]} />
            {[['색상 코드', color.toUpperCase()], ['빨간색', rgb[0]], ['녹색', rgb[1]], ['파란색', rgb[2]]].map(([label, value]) => (
              <View key={label} style={styles.pickerReadoutItem}>
                <Text style={styles.pickerReadoutLabel}>{label}</Text>
                <Text style={styles.pickerReadoutValue}>{value}</Text>
              </View>
            ))}
          </View>

          {recent.length ? (
            <View style={styles.swatchRow}>
              <Text style={styles.recentLabel}>자주 쓰는 색</Text>
              {recent.map((c) => (
                <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} onPress={() => setColor(c)} />
              ))}
            </View>
          ) : null}

          <View style={styles.pickerFooter}>
            <TouchableOpacity style={styles.pickerFooterBtn} onPress={onCancel}>
              <Text style={styles.pickerFooterText}>취소</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity style={styles.pickerFooterBtn} onPress={() => { addRecent(color); onDone(color); }}>
              <Text style={[styles.pickerFooterText, { color: '#00CFE9' }]}>완료</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Toolbar palette: a few presets, the colours the child saved, and the full picker.
function ColorControls({ value, onChange, swatches }) {
  const [recent] = useRecentColors();
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.swatchRow}>
      {swatches.slice(0, 4).map((c) => (
        <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchOn]} onPress={() => onChange(c)} />
      ))}
      {recent.slice(0, 3).map((c) => (
        <TouchableOpacity key={c} style={[styles.swatchSmall, { backgroundColor: c }, value === c && styles.swatchOn]} onPress={() => onChange(c)} />
      ))}
      <TouchableOpacity style={[styles.swatch, styles.swatchMore, { backgroundColor: value }]} onPress={() => setPicking(true)}>
        <Text style={styles.swatchMoreText}>＋</Text>
      </TouchableOpacity>
      <ColorPickerModal
        visible={picking}
        initial={value}
        onCancel={() => setPicking(false)}
        onDone={(c) => { onChange(c); setPicking(false); }}
      />
    </View>
  );
}

const EMPTY_FILLS = [];

const PEN_MIN = 1;
const PEN_MAX = 100;
// Slider units are 1-100, but a 100px radius is absurd on canvas: map it onto the pen radius
// range the fixed-size buttons used to cover (drawn width is about twice this).
const penPx = (value) => 1 + (value - 1) * 0.25;

// Strokes and bucket fills share one timeline so undo/redo walks them in the order they happened.
function useCanvasHistory() {
  const [strokes, setStrokes] = useState([]);
  const [fills, setFills] = useState([]);
  const [order, setOrder] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const addStroke = (updater) => {
    setStrokes(updater);
    setOrder((o) => [...o, 's']);
    setRedoStack([]);
  };
  const addFill = (op) => {
    setFills((f) => [...f, op]);
    setOrder((o) => [...o, 'f']);
    setRedoStack([]);
  };
  const undo = () => {
    const kind = order[order.length - 1];
    if (!kind) return;
    setOrder((o) => o.slice(0, -1));
    if (kind === 's') {
      setStrokes((prev) => {
        setRedoStack((r) => [...r, { kind, item: prev[prev.length - 1] }]);
        return prev.slice(0, -1);
      });
    } else {
      setFills((prev) => {
        setRedoStack((r) => [...r, { kind, item: prev[prev.length - 1] }]);
        return prev.slice(0, -1);
      });
    }
  };
  const redo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack((r) => r.slice(0, -1));
    setOrder((o) => [...o, last.kind]);
    if (last.kind === 's') setStrokes((prev) => [...prev, last.item]);
    else setFills((prev) => [...prev, last.item]);
  };
  // Stroke eraser: whichever item the pen touched disappears whole, so remove its slot from the
  // timeline too or undo would step onto an item that is no longer there.
  const dropAt = (kind, index) => {
    let seen = -1;
    setOrder((o) => {
      const at = o.findIndex((k) => k === kind && ++seen === index);
      return at < 0 ? o : [...o.slice(0, at), ...o.slice(at + 1)];
    });
    setRedoStack([]);
    if (kind === 's') setStrokes((prev) => prev.filter((_, i) => i !== index));
    else setFills((prev) => prev.filter((_, i) => i !== index));
  };
  const eraseStroke = (index) => dropAt('s', index);
  const eraseFill = (index) => dropAt('f', index);
  const clear = () => {
    setStrokes([]);
    setFills([]);
    setOrder([]);
    setRedoStack([]);
  };
  return { strokes, fills, addStroke, addFill, eraseStroke, eraseFill, undo, redo, clear, canUndo: order.length > 0, canRedo: redoStack.length > 0, setStrokes };
}

// Horizontal thickness control that lives in the toolbar strip, not on the canvas.
function SizeSlider({ value, color, onChange }) {
  const [trackW, setTrackW] = useState(120);
  const pickRef = useRef(null);
  pickRef.current = (x) => onChange(Math.round(PEN_MIN + Math.min(1, Math.max(0, x / trackW)) * (PEN_MAX - PEN_MIN)));
  const pan = useMemo(
    () => Gesture.Pan().runOnJS(true).minDistance(0).maxPointers(1)
      .onBegin((e) => pickRef.current(e.x))
      .onUpdate((e) => pickRef.current(e.x)),
    []
  );
  const ratio = (value - PEN_MIN) / (PEN_MAX - PEN_MIN);
  const dot = Math.max(4, Math.min(26, penPx(value) * 2));
  return (
    <View style={styles.sizeSlider}>
      <View style={styles.sizeDotWrap}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.channelHitSm} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={styles.channelTrack} />
          <View style={[styles.channelFill, { width: `${ratio * 100}%`, backgroundColor: '#00CFE9' }]} />
          <View style={[styles.channelThumb, { left: `${ratio * 100}%` }]} />
        </View>
      </GestureDetector>
      <Text style={styles.channelValue}>{value}</Text>
    </View>
  );
}

// One toolbar strip above every canvas: tools, colours, thickness, undo/redo.
function CanvasToolbar({ tool, onTool, tools, color, onColor, swatches, size, onSize, onUndo, onRedo, canUndo, canRedo, onClear, right }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <TouchableOpacity style={styles.toolPeek} onPress={() => setOpen(true)}>
        <Text style={styles.toolChipIcon}>🎨</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.toolStrip}>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setOpen(false)}>
        <Text style={styles.iconBtnText}>▾</Text>
      </TouchableOpacity>
      {tools.map((t) => (
        <TouchableOpacity key={t.key} style={[styles.toolChip, tool === t.key && styles.toolChipOn]} onPress={() => onTool(t.key)}>
          <Text style={styles.toolChipIcon}>{t.icon}</Text>
          <Text style={styles.toolChipText}>{t.label}</Text>
        </TouchableOpacity>
      ))}
      <View style={styles.toolDivider} />
      <ColorControls value={color} onChange={onColor} swatches={swatches} />
      <View style={styles.toolDivider} />
      <SizeSlider value={size} color={color} onChange={onSize} />
      <View style={styles.toolDivider} />
      <TouchableOpacity style={[styles.iconBtn, !canUndo && styles.iconBtnOff]} disabled={!canUndo} onPress={onUndo}>
        <Text style={styles.iconBtnText}>←</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.iconBtn, !canRedo && styles.iconBtnOff]} disabled={!canRedo} onPress={onRedo}>
        <Text style={styles.iconBtnText}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onClear}>
        <Text style={styles.iconBtnText}>🗑</Text>
      </TouchableOpacity>
      {right}
    </View>
  );
}


function TraceOverlay({ onDone }) {
  const [mode, setMode] = useState('intro');
  const history = useCanvasHistory();
  const { strokes, fills } = history;
  const [color, setColor] = useState('#111111');
  const [penWidth, setPenWidth] = useState(5);
  const [eraserWidth, setEraserWidth] = useState(40);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser' | 'fill'
  const [showTopic, setShowTopic] = useState(false);
  const erasing = tool === 'eraser';
  const win = useWindowDimensions();
  const enter = useRef(new Animated.Value(0)).current;
  const praiseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  // Show a "한번 그려볼까?" intro page first, then reveal the tracing canvas.
  useEffect(() => {
    if (mode !== 'intro') return;
    const id = setTimeout(() => setMode('trace'), 2400);
    return () => clearTimeout(id);
  }, [mode]);

  // The prompt is a greeting, not a label: show it for two seconds when a stage starts.
  useEffect(() => {
    if (mode !== 'trace' && mode !== 'color') return undefined;
    setShowTopic(true);
    const id = setTimeout(() => setShowTopic(false), 2000);
    return () => clearTimeout(id);
  }, [mode]);

  const toColor = () => {
    playSound('success');
    setMode('praise');
  };

  // After tracing: "참 잘했어요" → "이제 색칠하러 가자!" → coloring.
  useEffect(() => {
    if (mode !== 'praise') return undefined;
    praiseAnim.setValue(0);
    Animated.spring(praiseAnim, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
    const id = setTimeout(() => setMode('colorIntro'), 1400);
    return () => clearTimeout(id);
  }, [mode]);
  useEffect(() => {
    if (mode !== 'colorIntro') return undefined;
    const id = setTimeout(() => {
      history.clear();
      setMode('color');
    }, 1500);
    return () => clearTimeout(id);
  }, [mode]);

  return (
    <Animated.View style={[styles.traceOverlay, { opacity: enter }]}>
        {mode === 'trace' || mode === 'color' ? (
          <CanvasToolbar
            tool={tool}
            onTool={setTool}
            tools={mode === 'color'
              ? [{ key: 'pen', icon: '✏️', label: '펜' }, { key: 'eraser', icon: '🩹', label: '지우개' }, { key: 'fill', icon: '🪣', label: '채우기' }]
              : [{ key: 'pen', icon: '✏️', label: '펜' }, { key: 'eraser', icon: '🩹', label: '지우개' }]}
            color={erasing ? '#9aa6bf' : color}
            onColor={setColor}
            swatches={COLOR_SWATCHES}
            size={erasing ? eraserWidth : penWidth}
            onSize={erasing ? setEraserWidth : setPenWidth}
            onUndo={history.undo}
            onRedo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onClear={history.clear}
            right={(
              <TapScale
                style={styles.checkTool}
                onPress={() => {
                  if (mode === 'trace') {
                    playSound('pop');
                    toColor();
                  } else {
                    playSound('fanfare');
                    onDone();
                  }
                }}
              >
                <Text style={styles.checkText}>✓</Text>
              </TapScale>
            )}
          />
        ) : null}

        {mode !== 'intro' ? (
          <View style={styles.padRow}>
          <SketchPad
            strokes={strokes}
            onChange={history.addStroke}
            placeholder=""
            inkColor={mode === 'color' ? color : '#111111'}
            backgroundImage={TRACE_LINEART}
            bgOpacity={mode === 'color' ? 1 : 0.4}
            thickness={penPx(erasing ? eraserWidth : penWidth)}
            eraser={erasing}
            fillMode={mode === 'color' && tool === 'fill'}
            fillColor={color}
            fills={fills}
            onFill={history.addFill}
            onEraseStroke={history.eraseStroke}
            onEraseFill={history.eraseFill}
          />
          </View>
        ) : null}

        {showTopic && (mode === 'trace' || mode === 'color') ? (
          <View style={styles.traceTopic}>
            <Text style={styles.traceTopicText}>{mode === 'trace' ? '선을 따라 그려봐! ✏️' : '원하는 색으로 칠해봐! 🎨'}</Text>
          </View>
        ) : null}

        {mode === 'praise' ? <CenterPopup text="참 잘했어요!" emoji="✓" /> : null}

        {mode === 'colorIntro' ? <CenterPopup text={ACT_MSG.color.text} emoji={ACT_MSG.color.emoji} /> : null}

        {mode === 'intro' ? (
          <TouchableOpacity activeOpacity={0.9} style={[styles.traceIntro, { width: win.width, height: win.height }]} onPress={() => setMode('trace')}>
            <PattiCharacter tone="purple" size={0.95} />
            <View style={styles.quoteBox}>
              <Text style={styles.quoteMark}>“</Text>
              <Text style={styles.quoteText}>한번 그려볼까?</Text>
              <Text style={styles.quoteMark}>”</Text>
            </View>
            <Text style={styles.traceIntroHint}>화면을 톡 누르면 시작해요</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
  );
}

function ActivitiesScreen({ characterImage, onDrawing, onFinish }) {
  return (
    <View style={styles.activitiesScreen}>
      <View style={styles.activitiesFriend}>
        {characterImage ? <GeneratedCharacter uri={characterImage} size={170} /> : <PattiCharacter tone="blue" size={0.82} />}
        <View style={styles.quoteBox}>
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.quoteText}>다 봤다! 오늘 본 걸 그림으로 그려볼까?</Text>
          <Text style={styles.quoteMark}>”</Text>
        </View>
      </View>
      <View style={styles.wrapupActions}>
        <TouchableOpacity style={styles.drawCta} onPress={onDrawing}>
          <Text style={styles.drawCtaIcon}>✎</Text>
          <Text style={styles.drawCtaText}>그림 그리기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.lightButton} onPress={onFinish}>
          <Text style={styles.lightButtonText}>마무리</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const QUIZ_BUDDY = require('./assets/characters/bunny.png');

function QuizOverlay({ quiz, selected, tries = 0, onAnswer, onRetry, onResume, onSkip }) {
  // The pipeline lists the answer first; shuffled once per question so it moves around.
  const options = useMemo(() => {
    const list = [...quiz.options];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }, [quiz]);
  const win = useWindowDimensions();
  const correct = selected === quiz.answer;
  const shakeX = useRef(new Animated.Value(0)).current;
  const popScale = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const [cardBox, setCardBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    // Question audio is authored with the question, so playback is a single URL away.
    if (quiz.audioUrl) speakUrl(quiz.audioUrl);
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }).start();
  }, []);
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  useEffect(() => {
    if (!selected) return;
    if (correct) {
      popScale.setValue(0);
      Animated.spring(popScale, { toValue: 1, friction: 4, tension: 90, useNativeDriver: true }).start();
    } else {
      shakeX.setValue(0);
      Animated.sequence([
        Animated.timing(shakeX, { toValue: -14, duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 14, duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -9, duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 9, duration: 55, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0, duration: 55, useNativeDriver: true }),
      ]).start();
    }
  }, [selected]);

  return (
    <Modal transparent visible animationType="fade" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={onResume}>
      <View style={[styles.quizOverlay, { width: win.width, height: win.height }]}>
        <TouchableOpacity style={styles.ffBtn} onPress={onSkip}>
          <Text style={styles.ffBtnText}>⏭</Text>
        </TouchableOpacity>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        {/* 정답 시 캐릭터 등장 자리 (popScale 애니메이션 재사용) */}
        <Animated.View
          onLayout={(e) => setCardBox(e.nativeEvent.layout)}
          style={[styles.quizCard, { opacity: enter, transform: [{ translateX: shakeX }, { scale: enterScale }] }]}
        >
          {/* Inset by half the stroke so the rim sits inside the card without clipping — clipping
              would cut off the bubble and the buddy that hang above the card. */}
          {cardBox.width ? (
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="cardRim" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#609EF5" />
                  <Stop offset="1" stopColor="#1b3a7a" />
                </LinearGradient>
              </Defs>
              <Rect x={2.5} y={2.5} width={cardBox.width - 5} height={cardBox.height - 5} rx={31.5} fill="none" stroke="url(#cardRim)" strokeWidth={5} />
            </Svg>
          ) : null}
        {/* Buddy leans on the question bubble, and the options sit on the card below it. */}
        {selected ? null : (
          <TouchableOpacity style={styles.dunnoBtn} onPress={onSkip}>
            <Text style={styles.dunnoText}>모르겠어요</Text>
          </TouchableOpacity>
        )}
        <View style={styles.quizPromptRow}>
          <Image source={QUIZ_BUDDY} style={styles.quizBuddy} resizeMode="contain" />
          <View style={styles.questionBox}>
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="qRim" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#609EF5" />
                  <Stop offset="1" stopColor="#1b3a7a" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" rx={42} ry={42} fill="none" stroke="url(#qRim)" strokeWidth={7} />
            </Svg>
            <Text style={styles.questionText}>
              {selected && correct
                ? '맞아 정답이야! 잘했어 :)'
                : selected && tries >= 2
                ? `정답은 '${quiz.answer}' 였어!`
                : selected
                ? '앗 다시 생각해보자~!'
                : quiz.title}
            </Text>
          </View>
        </View>
        {selected && correct ? (
          <View style={styles.answerResult}>
            <Text style={styles.answerLabel}>정답 :</Text>
            <Text style={styles.answerValue}>{quiz.answer}</Text>
          </View>
        ) : (
          <View style={styles.quizOptions}>
            {options.map((option) => (
              <TouchableOpacity
                key={option.label}
                style={[styles.quizOption, { borderColor: option.color, backgroundColor: option.bg }, selected === option.label && styles.quizOptionDimmed]}
                onPress={() => onAnswer(option.label)}
              >
                <Text style={[styles.quizOptionText, { color: option.color }]}>{option.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.bottomActions}>
          {/* Right answer needs no skip; a second wrong answer ends the question. */}
          {selected && correct ? null : selected && tries < 2 ? (
            <TouchableOpacity style={styles.lightButton} onPress={onRetry}>
              <Text style={styles.lightButtonText}>다시 고르기</Text>
            </TouchableOpacity>
          ) : selected ? (
            <TapScale style={styles.darkButton} onPress={onSkip}>
              <Text style={styles.darkButtonText}>영상 이어보기</Text>
            </TapScale>
          ) : null}
          {selected && correct ? (
            <TouchableOpacity style={styles.darkButton} onPress={onResume}>
              <Text style={styles.darkButtonText}>영상 이어보기</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
      </View>
    </Modal>
  );
}

const DRAW_COLORS = ['#111111', '#e5484d', '#00CFE9', '#f5c518'];

function DrawingScreen({ topic = '오늘의 그림', strokes, status, error, characterImage, onChangeStrokes, onCanvasSize, onConvert, onSave, onDone, onSkip }) {
  const [choosing, setChoosing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 620, height: 380 });
  const converting = status === 'loading' || (status === 'done' && !!characterImage) || status === 'error';
  const [brushColor, setBrushColor] = useState('#111111');
  const [brushSize, setBrushSize] = useState(5);
  const [eraserSize, setEraserSize] = useState(40);
  const [tool, setTool] = useState('brush'); // 'brush' | 'eraser' | 'ruler'
  const [redoStack, setRedoStack] = useState([]);
  const inkColor = tool === 'eraser' ? '#ffffff' : brushColor;
  const thickness = penPx(tool === 'eraser' ? eraserSize : brushSize);
  return (
    <View style={styles.drawingScreen}>
      {!converting && !choosing ? (
      <>
      <View style={styles.padRow}>
      <View style={styles.drawingCanvasCard}>
        <SketchPad
          strokes={strokes}
          onChange={onChangeStrokes}
          onCanvasSize={(size) => { setCanvasSize(size); onCanvasSize(size); }}
          placeholder={`여기에 ${topic}을 그려보세요`}
          inkColor={inkColor}
          thickness={thickness}
          straightLine={tool === 'ruler'}
          eraser={tool === 'eraser'}
          onEraseStroke={(i) => onChangeStrokes((prev) => prev.filter((_, k) => k !== i))}
        />
        <View style={styles.drawingTopic}>
          <Text style={styles.drawingTopicText}>주제 : {topic}</Text>
        </View>
      </View>
      </View>
      <CanvasToolbar
        tool={tool}
        onTool={setTool}
        tools={[{ key: 'brush', icon: '✏️', label: '붓' }, { key: 'eraser', icon: '🩹', label: '지우개' }, { key: 'ruler', icon: '📏', label: '자' }]}
        color={brushColor}
        onColor={(c) => { setBrushColor(c); setTool('brush'); }}
        swatches={DRAW_COLORS}
        size={tool === 'eraser' ? eraserSize : brushSize}
        onSize={tool === 'eraser' ? setEraserSize : setBrushSize}
        onUndo={() => onChangeStrokes((prev) => {
          if (!prev.length) return prev;
          setRedoStack((r) => [...r, prev[prev.length - 1]]);
          return prev.slice(0, -1);
        })}
        onRedo={() => {
          const last = redoStack[redoStack.length - 1];
          if (!last) return;
          setRedoStack((r) => r.slice(0, -1));
          onChangeStrokes((prev) => [...prev, last]);
        }}
        canUndo={strokes.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => { onChangeStrokes([]); setRedoStack([]); }}
        right={(
          <TouchableOpacity style={styles.checkTool} onPress={() => strokes.length && setChoosing(true)}>
            <Text style={styles.checkText}>✓</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.skipFloat} onPress={onSkip}>
        <Text style={styles.skipFloatText}>건너뛰기</Text>
      </TouchableOpacity>
      </>
      ) : null}
      {choosing ? (
        <View style={styles.reviewScreen}>
          <Text style={styles.reviewTitle}>다 그렸어요!</Text>
          <View style={styles.reviewFrame}>
            <StrokeArt drawing={{ strokes, size: canvasSize }} size={420} />
          </View>
          <View style={styles.creatorActions}>
            <TouchableOpacity style={styles.lightButton} onPress={() => { playSound('pop'); setChoosing(false); onSave(); }}>
              <Text style={styles.lightButtonText}>그림 저장</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.blueButton} onPress={() => { playSound('pop'); setChoosing(false); onConvert(); }}>
              <Text style={styles.blueButtonText}>그림 변환</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setChoosing(false)}>
            <Text style={styles.reviewBack}>더 그릴래요</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {converting ? (
        <View style={styles.convertOverlay}>
          <View style={styles.convertCard}>
            {status === 'loading' ? (
              <>
                <PattiCharacter tone="purple" size={0.9} />
                <Text style={styles.convertTitle}>그림 변환중...</Text>
                <Text style={styles.convertCopy}>그림을 귀여운 그림으로 만들고 있어요.</Text>
              </>
            ) : null}
            {status === 'done' && characterImage ? (
              <>
                <Text style={styles.convertTitle}>완성! 멋진 그림이 됐어요</Text>
                {/* Shown at canvas size: the child should see the picture, not a thumbnail. */}
                <View style={styles.convertFrame}>
                  <GeneratedCharacter uri={characterImage} size={Math.min(canvasSize.width, 560)} />
                </View>
                <View style={styles.creatorActions}>
                  <TouchableOpacity style={styles.lightButton} onPress={() => { playSound('pop'); onSave(); }}>
                    <Text style={styles.lightButtonText}>그림 저장</Text>
                  </TouchableOpacity>
                  <TapScale style={styles.darkButton} onPress={() => { playSound('pop'); onDone(); }}>
                    <Text style={styles.darkButtonText}>마무리하기</Text>
                  </TapScale>
                </View>
              </>
            ) : null}
            {status === 'error' ? (
              <>
                <Text style={styles.convertTitle}>앗, 변환에 실패했어요</Text>
                <Text style={styles.errorText}>{error}</Text>
                <View style={styles.creatorActions}>
                  <TouchableOpacity style={styles.lightButton} onPress={onSkip}>
                    <Text style={styles.lightButtonText}>건너뛰기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.blueButton} onPress={onConvert}>
                    <Text style={styles.blueButtonText}>다시 시도</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Replays the child's own strokes, so a saved drawing needs no image capture.
function StrokeArt({ drawing, size = 230 }) {
  const strokes = drawing.strokes || [];
  const pts = strokes.flatMap((st) => st.points || st);
  const pad = 24;
  const box = pts.length
    ? {
        x: Math.min(...pts.map((p) => p.x)) - pad,
        y: Math.min(...pts.map((p) => p.y)) - pad,
        w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + pad * 2,
        h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + pad * 2,
      }
    : { x: 0, y: 0, w: drawing.size?.width || 620, h: drawing.size?.height || 380 };
  const scale = size / Math.max(box.w, box.h);
  return (
    <Svg width={box.w * scale} height={box.h * scale} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
      {strokes.map((stroke, i) => (
        <Path
          key={i}
          d={(stroke.points || stroke).map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}
          stroke={stroke.color || '#171d31'}
          strokeWidth={stroke.thickness || 8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

function ReportScreen({ report, characterImage, savedDrawing, onReplay, onOtherVideos, onCharacter }) {
  const today = new Date();
  const dateLine = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const watched = report.watched || video.title;
  const completed = report.quiz + report.drawing;
  const interests = report.interests || [];
  return (
    <View style={styles.reportScreen}>
      <View style={styles.reportCardWide}>
        <View style={styles.reportHead}>
          <Text style={styles.reportTitle}>활동 리포트</Text>
          <Text style={styles.reportDate}>{dateLine} · {watched}</Text>
        </View>
        <View style={styles.reportBody}>
          <View style={styles.reportArtCol}>
            <Text style={styles.reportColLabel}>오늘의 작품</Text>
            <View style={styles.reportArtBox}>
              {characterImage ? (
                <GeneratedCharacter uri={characterImage} size={230} />
              ) : savedDrawing ? (
                <StrokeArt drawing={savedDrawing} size={230} />
              ) : (
                <>
                  <PattiCharacter tone="blue" size={1.1} />
                  <Text style={styles.reportArtCaption}>그림을 건너뛰었어요</Text>
                </>
              )}
            </View>
          </View>
          <View style={styles.reportSumCol}>
            <View style={styles.reportStatsRow}>
              <ReportStat label="퀴즈 정답" value={report.quiz} tone="#3d5afe" />
              <ReportStat label="그림 완성" value={report.drawing} tone="#7bd88f" />
              <ReportStat label="건너뜀" value={report.skip} tone="#ffb020" />
            </View>
            {interests.length ? (
              <View style={styles.reportChips}>
                {interests.map((t) => (
                  <View key={t} style={styles.reportChip}><Text style={styles.reportChipText}>#{t}</Text></View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.reportActions}>
          <TouchableOpacity style={styles.lightButton} onPress={() => { playSound('pop'); onReplay(); }}>
            <Text style={styles.lightButtonText}>영상 다시보기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.lightButton} onPress={() => { playSound('pop'); onOtherVideos(); }}>
            <Text style={styles.lightButtonText}>다른 영상 보기</Text>
          </TouchableOpacity>
          <TapScale style={styles.darkButton} onPress={() => { playSound('pop'); onCharacter(); }}>
            <Text style={styles.darkButtonText}>캐릭터 보러가기</Text>
          </TapScale>
        </View>
      </View>
    </View>
  );
}

function ReportStat({ label, value, tone }) {
  return (
    <View style={styles.reportStat}>
      <Text style={[styles.reportStatValue, { color: tone }]}>{value}</Text>
      <Text style={styles.reportStatLabel}>{label}</Text>
    </View>
  );
}



// perfect-freehand outline -> SVG path string (filled shape)
function strokeToSvg(points, size) {
  if (!points || points.length === 0) return '';
  const outline = getStroke(points.map((p) => [p.x, p.y]), {
    size: Math.max(4, size * 2), thinning: 0, smoothing: 0.55, streamline: 0.5, simulatePressure: false, last: true,
  });
  if (!outline.length) return '';
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i += 1) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`;
  }
  return `${d} Z`;
}

// Bucket fill over the line art. Walls are any pixel that is not near-white; several grown
// copies let a tap pick the strongest gap closing that still leaves its own region reachable,
// which is what stops paint escaping through the hairline breaks in the artwork.
const WALL_LEVELS = 3;

function buildWalls(src, w, h, threshold) {
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    if (src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114 < threshold) wall[i] = 1;
  }
  const grown = [];
  let prev = wall;
  for (let level = 0; level < WALL_LEVELS; level += 1) {
    const next = Uint8Array.from(prev);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!prev[i]) continue;
        next[i - 1] = 1;
        next[i + 1] = 1;
        next[i - w] = 1;
        next[i + w] = 1;
      }
    }
    grown.push(next);
    prev = next;
  }
  return { wall, grown };
}

// Paint spreads over the open pixels of the chosen wall map, then creeps back into the walls so
// the anti-aliased edge sits on colour instead of a white halo. It never crosses a wall.
function floodFill(walls, out, w, h, startX, startY, rgb, owner, ownerId) {
  let level = WALL_LEVELS;
  while (level > 0 && walls.grown[level - 1][startY * w + startX]) level -= 1;
  if (level === 0 && walls.wall[startY * w + startX]) return false;
  const open = level === 0 ? walls.wall : walls.grown[level - 1];
  const seen = new Uint8Array(w * h);
  const stack = [startX, startY];
  const edge = [];
  let filled = 0;
  const paint = (i) => {
    const o = i * 4;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
    out[o + 3] = 255;
    if (owner) owner[i] = ownerId;
  };
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (seen[y * w + x]) continue;
    let left = x;
    while (left > 0 && !seen[y * w + left - 1] && !open[y * w + left - 1]) left -= 1;
    let right = x;
    while (right < w - 1 && !seen[y * w + right + 1] && !open[y * w + right + 1]) right += 1;
    for (let sx = left; sx <= right; sx += 1) {
      const i = y * w + sx;
      seen[i] = 1;
      paint(i);
      filled += 1;
      if (y > 0 && !seen[i - w] && !open[i - w]) stack.push(sx, y - 1);
      if (y < h - 1 && !seen[i + w] && !open[i + w]) stack.push(sx, y + 1);
      if (sx === left || sx === right || y === 0 || y === h - 1) edge.push(i);
    }
  }
  if (!filled) return false;
  // Creep back exactly as far as the walls were grown, plus the anti-aliased fringe itself.
  let ring = edge;
  for (let step = 0; step < level + 2; step += 1) {
    const next = [];
    for (let k = 0; k < ring.length; k += 1) {
      const i = ring[k];
      const around = [i - 1, i + 1, i - w, i + w];
      for (let n = 0; n < 4; n += 1) {
        const j = around[n];
        if (j < 0 || j >= w * h || seen[j] || !open[j]) continue;
        seen[j] = 1;
        paint(j);
        // Stop at the ink itself: creeping past a printed line would cross into its neighbour.
        if (!walls.wall[j]) next.push(j);
      }
    }
    ring = next;
  }
  return true;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Keeps the zoomed canvas covering its frame: no blank gap, no drifting away at 1x.
function clampPan(value, size, zoom) {
  'worklet';
  const min = size * (1 - zoom);
  return Math.min(0, Math.max(min, value));
}

function SketchPad({ strokes, onChange, onCanvasSize, placeholder, inkColor, transparent, backgroundImage, thickness = 8, overlayStrokes, bgOpacity = 0.4, straightLine = false, eraser = false, fillMode = false, fillColor = '#111111', fills = EMPTY_FILLS, onFill, onEraseStroke, onEraseFill }) {
  const [layout, setLayout] = useState({ width: 620, height: 380 });
  // In-progress stroke lives in local state so only THIS stroke re-renders per move
  // (committed strokes stay memoized) — that's what keeps writing latency GoodNotes-low.
  const activeRef = useRef(null);
  const [active, setActive] = useState(null);
  // Palm rejection: once a stylus touches down, finger touches are ignored for a short
  // window — that window is exactly when a resting palm/knuckle lands next to the pen.
  const rejectRef = useRef(false);
  // Samsung reports a held S-Pen button as MotionEvent TOOL_TYPE_ERASER, which gesture-handler
  // surfaces as pointerType OTHER — so the pen button erases without any native code.
  const penEraseRef = useRef(false);

  // Pinch to zoom, two fingers to move. One finger always stays a pen, so drawing never fights
  // the viewport; stroke coordinates are converted back into canvas space before being stored.
  const scale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const moveAllowed = useSharedValue(false);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  // Frame size on the UI thread, so panning can be clamped to it.
  const boxW = useSharedValue(620);
  const boxH = useSharedValue(380);
  const viewTransform = useDerivedValue(() => [
    { translateX: originX.value },
    { translateY: originY.value },
    { scale: scale.value },
  ]);
  const toCanvas = (event) => ({
    ...event,
    x: (event.x - originX.value) / scale.value,
    y: (event.y - originY.value) / scale.value,
  });

  // Bucket fill: the line art is read once as raw pixels, and every fill accumulates into one
  // mask buffer that is turned into an SkImage painted between the line art and the strokes.
  const lineArt = useImage(backgroundImage);
  const srcPixelsRef = useRef(null);
  const wallsRef = useRef(null);
  const [fillImage, setFillImage] = useState(null);
  // The line art PNG has an opaque white background, so colour can never go under it. Rebuild it
  // once as ink-on-transparent, which lets the fill sit below the strokes and kills the halo.
  const [inkImage, setInkImage] = useState(null);


  const fillBox = () => {
    if (!lineArt) return null;
    const iw = lineArt.width();
    const ih = lineArt.height();
    const boxW = layout.width;
    const boxH = (boxW * ih) / iw;
    return { iw, ih, boxW, boxH, top: (layout.height - boxH) / 2 };
  };

  const readSource = () => {
    if (!lineArt) return null;
    const info = { width: lineArt.width(), height: lineArt.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
    if (!srcPixelsRef.current) srcPixelsRef.current = lineArt.readPixels(0, 0, info);
    return srcPixelsRef.current ? info : null;
  };

  useEffect(() => {
    if (!lineArt || inkImage) return;
    const info = readSource();
    if (!info) return;
    const src = srcPixelsRef.current;
    const ink = new Uint8Array(src.length);
    for (let i = 0; i < info.width * info.height; i += 1) {
      const o = i * 4;
      const lum = src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114;
      ink[o + 3] = lum >= 250 ? 0 : Math.round(255 - lum);
    }
    setInkImage(Skia.Image.MakeImage(info, Skia.Data.fromBytes(ink), info.width * 4));
  }, [lineArt]);

  // Stroke eraser: delete the item the pen touched — a whole stroke, or a whole bucket fill.
  const eraseAt = (rawEvent) => {
    const event = toCanvas(rawEvent);
    for (let i = (strokes || []).length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (!stroke) continue;
      const reach = Math.max(8, (stroke.thickness || thickness) * 1.5);
      const hit = stroke.some((p) => p && Math.hypot(p.x - event.x, p.y - event.y) <= reach);
      if (hit) {
        if (onEraseStroke) onEraseStroke(i);
        return;
      }
    }
    const box = fillBox();
    const owner = appliedRef.current.owner;
    if (!box || !owner) return;
    const px = Math.round((event.x * box.iw) / box.boxW);
    const py = Math.round(((event.y - box.top) * box.ih) / box.boxH);
    if (px < 0 || py < 0 || px >= box.iw || py >= box.ih) return;
    const id = owner[py * box.iw + px];
    if (id && onEraseFill) onEraseFill(id - 1);
  };

  const doFill = (rawEvent) => {
    const event = toCanvas(rawEvent);
    const box = fillBox();
    if (!box) return;
    const info = readSource();
    if (!info) return;
    if (!wallsRef.current) wallsRef.current = buildWalls(srcPixelsRef.current, box.iw, box.ih, 235);
    const px = Math.round((event.x * box.iw) / box.boxW);
    const py = Math.round(((event.y - box.top) * box.ih) / box.boxH);
    if (px < 0 || py < 0 || px >= box.iw || py >= box.ih) return;
    if (onFill) onFill({ x: px, y: py, color: fillColor });
  };

  // Fills are replayed from the parent's list, which is what makes undo/redo of a bucket work.
  // Appending keeps the previous buffer; only an undo has to replay from scratch.
  const appliedRef = useRef({ ops: [], buf: null, owner: null });
  useEffect(() => {
    const box = fillBox();
    if (!box) return;
    const info = readSource();
    if (!info) return;
    if (!fills.length) {
      appliedRef.current = { ops: [], buf: null, owner: null };
      setFillImage(null);
      return;
    }
    if (!wallsRef.current) wallsRef.current = buildWalls(srcPixelsRef.current, box.iw, box.ih, 235);
    const applied = appliedRef.current;
    const isAppend = applied.buf && applied.ops.length < fills.length
      && applied.ops.every((op, i) => op === fills[i]);
    const buf = isAppend ? applied.buf : new Uint8Array(box.iw * box.ih * 4);
    const owner = isAppend ? applied.owner : new Uint16Array(box.iw * box.ih);
    const offset = isAppend ? applied.ops.length : 0;
    const pending = isAppend ? fills.slice(offset) : fills;
    pending.forEach((op, i) => floodFill(wallsRef.current, buf, box.iw, box.ih, op.x, op.y, hexToRgb(op.color), owner, offset + i + 1));
    appliedRef.current = { ops: fills, buf, owner };
    setFillImage(Skia.Image.MakeImage(info, Skia.Data.fromBytes(buf), box.iw * 4));
  }, [fills, lineArt]);

  // Uniform width: kids want a predictable line, so neither stylus pressure nor speed
  // changes the stroke — only the selected pen size does.
  const makePoint = (event) => ({ x: event.x, y: event.y, w: thickness });

  const begin = (event) => {
    // Fingers only pan and pinch the page; painting is the stylus's job alone, so a resting
    // palm can never leave a mark.
    if (event.pointerType === PointerType.TOUCH) {
      rejectRef.current = true;
      return;
    }
    penEraseRef.current = event.pointerType !== PointerType.TOUCH && event.pointerType !== PointerType.STYLUS;
    if (__DEV__) console.log('[pen] pointerType', event.pointerType, 'stylusData', JSON.stringify(event.stylusData));
    if (fillMode || eraser) {
      // Bucket and eraser both act on whole items, so neither starts a stroke.
      rejectRef.current = true;
      if (eraser) eraseAt(event);
      else doFill(event);
      return;
    }
    rejectRef.current = false;
    const stroke = [makePoint(toCanvas(event))];
    activeRef.current = stroke;
    setActive(stroke);
  };
  const extend = (event) => {
    if (rejectRef.current) {
      if (eraser) eraseAt(event); // dragging the eraser keeps rubbing items out
      return;
    }
    const prev = activeRef.current;
    if (!prev) return begin(event);
    // Ruler mode: keep only the start point and the current point → a straight line.
    const point = makePoint(toCanvas(event));
    const stroke = straightLine ? [prev[0], point] : [...prev, point];
    activeRef.current = stroke;
    setActive(stroke);
  };
  const end = () => {
    if (rejectRef.current) {
      rejectRef.current = false;
      return;
    }
    const stroke = activeRef.current;
    activeRef.current = null;
    setActive(null);
    if (stroke && stroke.length) {
      stroke.color = inkColor; // lock each stroke's color so later palette changes don't repaint it
      stroke.thickness = thickness; // lock its width too so later size changes don't repaint it
      stroke.eraser = eraser || penEraseRef.current; // eraser strokes clear ink (blendMode) without touching the background guide
      onChange((prev) => [...prev, stroke]);
    }
  };
  const handlersRef = useRef({ begin, extend, end });
  handlersRef.current = { begin, extend, end };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true) // stroke state lives on the JS thread; no worklet hop needed
        .minDistance(0) // draw from the very first pixel, and allow single-tap dots
        .maxPointers(1)
        .averageTouches(false)
        .onBegin((event) => handlersRef.current.begin(event))
        .onUpdate((event) => handlersRef.current.extend(event))
        .onFinalize(() => handlersRef.current.end()),
    []
  );

  const zoom = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onBegin((e) => {
        startScale.value = scale.value;
        startX.value = originX.value;
        startY.value = originY.value;
        focalX.value = e.focalX;
        focalY.value = e.focalY;
      })
      .onUpdate((e) => {
        const next = Math.min(6, Math.max(1, startScale.value * e.scale));
        const k = next / startScale.value;
        scale.value = next;
        originX.value = clampPan(focalX.value - (focalX.value - startX.value) * k, boxW.value, next);
        originY.value = clampPan(focalY.value - (focalY.value - startY.value) * k, boxH.value, next);
      });
    const move = Gesture.Pan()
      .minPointers(1)
      .averageTouches(true)
      .onBegin((e) => {
        moveAllowed.value = e.pointerType === PointerType.TOUCH;
        startX.value = originX.value;
        startY.value = originY.value;
      })
      .onUpdate((e) => {
        if (!moveAllowed.value) return;
        originX.value = clampPan(startX.value + e.translationX, boxW.value, scale.value);
        originY.value = clampPan(startY.value + e.translationY, boxH.value, scale.value);
      });
    const reset = Gesture.Tap().numberOfTaps(2).onEnd(() => {
      scale.value = 1;
      originX.value = 0;
      originY.value = 0;
    });
    return Gesture.Simultaneous(pinch, move, reset);
  }, []);

  // perfect-freehand outlines as filled SVG path strings; committed + overlay memoized
  // so they are NOT recomputed while an active stroke is being drawn.
  const committedPaths = useMemo(
    () => (strokes || [])
      .map((s, i) => ({ key: `p-${i}`, d: strokeToSvg(s && s.filter(Boolean), (s && s.thickness) || thickness), color: (s && s.color) || inkColor, eraser: !!(s && s.eraser) }))
      .filter((p) => p.d),
    [strokes, thickness, inkColor]
  );
  const overlayPaths = useMemo(
    () => (overlayStrokes || [])
      .map((s, i) => ({ key: `o-${i}`, d: strokeToSvg(s && s.filter(Boolean), thickness) }))
      .filter((p) => p.d),
    [overlayStrokes, thickness]
  );
  const committedLayer = useMemo(
    () => (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group transform={viewTransform}>
        {fillImage && fillGeom ? (
          <SkiaImage image={fillImage} x={0} y={fillGeom.top} width={fillGeom.boxW} height={fillGeom.boxH} fit="fill" />
        ) : null}
        {committedPaths.map((p) => (
          <SkiaPath key={p.key} path={p.d} color={p.eraser ? '#000' : p.color} blendMode={p.eraser ? 'clear' : undefined} />
        ))}
        {overlayPaths.map((p) => (
          <SkiaPath key={p.key} path={p.d} color="#111111" />
        ))}
        </Group>
      </Canvas>
    ),
    [committedPaths, overlayPaths, fillImage, fillGeom && fillGeom.top, fillGeom && fillGeom.boxW, fillGeom && fillGeom.boxH]
  );
  const fillGeom = fillBox();
  const activePath = active ? strokeToSvg(active.filter(Boolean), thickness) : '';
  const hasInk = committedPaths.length > 0 || overlayPaths.length > 0 || !!activePath;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, zoom)}>
    <View
      collapsable={false}
      style={[styles.sketchPad, transparent && styles.sketchPadTransparent]}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        setLayout(next);
        boxW.value = next.width;
        boxH.value = next.height;
        if (onCanvasSize) {
          onCanvasSize({ width: next.width, height: next.height });
        }
      }}
    >
      {!transparent && !backgroundImage ? <View style={styles.gridLayer} pointerEvents="none" /> : null}
      {!hasInk && placeholder ? <Text style={styles.padPlaceholder}>{placeholder}</Text> : null}
      {committedLayer}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group transform={viewTransform}>
          {activePath ? <SkiaPath path={activePath} color={eraser || penEraseRef.current ? '#00000055' : inkColor} /> : null}
        </Group>
      </Canvas>
      {/* The printed lines stay on top: colouring over them must never bury the drawing. */}
      {inkImage && fillGeom ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Group transform={viewTransform}>
            <SkiaImage image={inkImage} x={0} y={fillGeom.top} width={fillGeom.boxW} height={fillGeom.boxH} fit="fill" opacity={bgOpacity} />
          </Group>
        </Canvas>
      ) : null}
    </View>
    </GestureDetector>
  );
}

function GeneratedCharacter({ uri, size }) {
  return (
    <View style={[styles.generatedWrap, { width: size, height: size }]}>
      <Image source={{ uri }} style={styles.generatedImage} resizeMode="contain" />
    </View>
  );
}

// Growth stages: everyone starts as the star, then becomes the species the child picked.
const CHARACTER_IMAGES = {
  star: require('./assets/characters/star.png'),
  rabbit: require('./assets/characters/rabbit2.png'),
  dino: require('./assets/characters/dino2.png'),
};
const CHARACTER_BASE = 150;

function characterImageFor(species, level) {
  if (level < 2) return CHARACTER_IMAGES.star;
  return CHARACTER_IMAGES[species] || CHARACTER_IMAGES.star;
}

// The mascot: breathes on its own, squashes when tapped, jumps when something good happens.
// ponytail: RN Animated stand-in until the Rive file lands — same props, so the swap is local.
function PattiCharacter({ tone = 'blue', size = 1, onPress, celebrate = 0, species = 'star', level = 1 }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const hop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (!celebrate) return;
    Animated.sequence([
      Animated.spring(hop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }),
      Animated.spring(hop, { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 10 }),
    ]).start();
  }, [celebrate]);

  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.9, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }),
    ]).start();
    if (onPress) onPress();
  };

  const px = CHARACTER_BASE * size;
  const translateY = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -px * 0.18] })
  );

  return (
    <Pressable onPress={tap} hitSlop={12}>
      <Animated.Image
        source={characterImageFor(species, level)}
        resizeMode="contain"
        style={{ width: px, height: px, transform: [{ translateY }, { scale }] }}
      />
    </Pressable>
  );
}

const CIRCLE_STYLE = {
  width: 120,
  height: 120,
  borderRadius: 60,
  borderWidth: 3,
  borderColor: 'rgba(255,255,255,0.7)',
  shadowColor: '#91a2c0',
  shadowOpacity: 0.18,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
};

const styles = StyleSheet.create({
  pattiCircle: CIRCLE_STYLE,
  safe: {
    flex: 1,
    backgroundColor: '#eef5ff',
  },
  outer: {
    flex: 1,
    backgroundColor: '#eef5ff',
  },
  tablet: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: COLORS.card,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  logoWord: {
    fontFamily: 'BnviitLasik',
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  header: {
    height: 76,
    paddingHorizontal: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f4f7fe',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  screen: {
    flex: 1,
    padding: 40,
    backgroundColor: COLORS.stage,
  },
  lightButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f6ff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  lightButtonText: {
    color: '#609EF5',
    fontSize: 18,
    fontWeight: '900',
  },
  blueButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.blue,
  },
  blueButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  darkButton: {
    minHeight: 58,
    paddingHorizontal: 30,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dark,
    shadowColor: COLORS.dark,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  darkButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  libHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
  },
  libGreetText: {
    flex: 1,
  },
  libTitle: {
    fontSize: 46,
    lineHeight: 54,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  libSubtitle: {
    marginTop: 6,
    fontSize: 24,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  creatorActions: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  errorText: {
    marginTop: 12,
    color: '#c03744',
    fontSize: 15,
    fontWeight: '800',
  },
  puzzleModal: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  traceWordScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    // Same as the quiz: the video stays visible behind the activity.
    backgroundColor: 'rgba(20,28,48,0.28)',
  },
  traceWord: {
    width: '82%',
    height: '88%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    borderRadius: 34,
    backgroundColor: '#ffffff',
  },
  traceWordTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#171d31',
  },
  traceWordPad: {
    width: '86%',
    flex: 1,
    borderRadius: 24,
    backgroundColor: '#f8faff',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  traceWordActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  traceWordSkip: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
  },
  watchScreen: {
    flex: 1,
    padding: 36,
    backgroundColor: COLORS.stage,
  },
  videoCard: {
    flex: 1,
    borderRadius: 34,
    overflow: 'hidden',
    padding: 7,
    backgroundColor: '#f4f7fe',
    shadowColor: '#91a2c0',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  video: {
    flex: 1,
    borderRadius: 27,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  activitiesScreen: {
    flex: 1,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
    backgroundColor: COLORS.stage,
  },
  activitiesFriend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  wrapupActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  drawCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 40,
    borderRadius: 26,
    backgroundColor: COLORS.blue,
    shadowColor: COLORS.blue,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  drawCtaIcon: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
  },
  drawCtaText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
  },
  quoteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.blue,
  },
  quoteMark: {
    color: COLORS.blue,
    fontSize: 21,
    fontWeight: '900',
    marginHorizontal: 8,
  },
  quoteText: {
    color: TEXT_ON_DARK,
    fontSize: 22,
    fontWeight: '900',
  },
  traceOverlay: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  countdown: {
    position: 'absolute',
    right: 26,
    bottom: 26,
    zIndex: 7,
    width: 78,
    height: 78,
    borderRadius: 39,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#609EF5',
  },
  countdownText: {
    color: '#192853',
    fontSize: 40,
    lineHeight: 46,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontWeight: '900',
  },
  traceIntro: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: '#f4f7fe',
  },
  traceIntroHint: {
    marginTop: 6,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 18,
    fontWeight: '800',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  swatchOn: {
    borderColor: COLORS.ink,
    transform: [{ scale: 1.15 }],
  },
  traceTopic: {
    position: 'absolute',
    top: 22,
    alignSelf: 'center',
    zIndex: 5,
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: '#eaf4ff',
    borderWidth: 1.5,
    borderColor: COLORS.blue,
  },
  traceTopicText: {
    color: COLORS.blueDark,
    fontSize: 22,
    fontWeight: '900',
  },
  praiseScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,28,48,0.18)',
  },
  praiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  praiseBuddy: {
    width: 190,
    height: 190,
    // Leans over the bubble's left edge instead of sitting beside it.
    marginRight: -84,
    zIndex: 2,
  },
  praiseCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 520,
    paddingVertical: 30,
    paddingLeft: 120,
    paddingRight: 56,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    borderWidth: 4,
    borderColor: '#609EF5',
    shadowColor: '#1b2a4a',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  praiseText: {
    color: '#171d31',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
  quizOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: 'rgba(26, 28, 35, 0.35)',
    zIndex: 50,
  },
  reviewScreen: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 30,
    backgroundColor: '#ffffff',
    zIndex: 10,
  },
  reviewTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#171d31',
  },
  reviewFrame: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 10,
    borderColor: '#d9b382',
    shadowColor: '#171d31',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  reviewBack: {
    fontSize: 14,
    fontWeight: '800',
    color: '#5b6b8c',
  },
  convertOverlay: {
    // Fills the screen the way the review page does; absolute fill left it half-height.
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: '#f1f5ff',
    zIndex: 10,
  },
  convertFrame: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 10,
    borderColor: '#d9b382',
  },
  convertCard: {
    minWidth: 420,
    maxWidth: '92%',
    padding: 28,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#f4f7fe',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
  },
  convertTitle: {
    color: TEXT_ON_DARK,
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  convertCopy: {
    color: TEXT_MUTED_ON_DARK,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  quizCard: {
    maxWidth: '90%',
    // Bubble overlaps the card's top edge, so the card starts below it.
    marginTop: 66,
    paddingTop: 58,
    paddingBottom: 30,
    paddingHorizontal: 34,
    borderRadius: 34,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  dunnoBtn: {
    position: 'absolute',
    top: -112,
    alignSelf: 'center',
    marginLeft: 40,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#eef2f8',
    zIndex: 4,
  },
  dunnoText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#8a97b1',
  },
  quizPromptRow: {
    position: 'absolute',
    top: -74,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  quizBuddy: {
    width: 130,
    height: 130,
    // Leans in over the bubble's left edge, tucked a little further in.
    marginRight: -66,
    marginBottom: 34,
    zIndex: 4,
  },
  miniStar: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eaf2ff',
  },
  miniStarText: {
    fontSize: 30,
    color: COLORS.blue,
    fontWeight: '900',
  },
  questionBox: {
    minWidth: 460,
    minHeight: 84,
    paddingLeft: 74,
    paddingRight: 44,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionKind: {
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '900',
    color: '#609EF5',
  },
  questionText: {
    textAlign: 'center',
    color: TEXT_ON_DARK,
    fontSize: 27,
    fontWeight: '900',
  },
  quizOptions: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 38,
  },
  quizOption: {
    minWidth: 150,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#94a3b8',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  quizOptionDimmed: {
    opacity: 0.48,
  },
  quizOptionText: {
    fontSize: 21,
    fontWeight: '900',
  },
  answerResult: {
    alignSelf: 'center',
    marginTop: 28,
    minWidth: 260,
    height: 58,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#00CFE9',
    backgroundColor: '#f1fdff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  answerLabel: {
    fontSize: 20,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  answerValue: {
    fontSize: 21,
    fontWeight: '900',
    color: '#00CFE9',
  },
  bottomActions: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  drawingScreen: {
    flex: 1,
    padding: 14,
    backgroundColor: '#ffffff',
  },
  drawingCanvasCard: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#188ddd',
    backgroundColor: '#ffffff',
  },
  drawingTopic: {
    position: 'absolute',
    top: 18,
    right: 22,
  },
  drawingTopicText: {
    color: '#171d31',
    fontSize: 20,
    fontWeight: '900',
  },
  checkTool: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00CFE9',
  },
  checkText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  skipFloat: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#f1f6ff',
  },
  skipFloatText: {
    color: COLORS.blueDark,
    fontSize: 16,
    fontWeight: '900',
  },
  sketchPad: {
    flex: 1,
    minHeight: 360,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  sketchPadTransparent: {
    flex: 1,
    position: 'relative',
    minHeight: undefined,
    borderWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.01)',
    zIndex: 3,
  },
  padRow: {
    flex: 1,
  },
  toolPeek: {
    position: 'absolute',
    bottom: 14,
    left: 18,
    zIndex: 50,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  welcomeScreen: {
    flex: 1,
    padding: 40,
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
  },
  welcomeBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
  },
  welcomeBadge: {
    fontSize: 14,
    fontWeight: '800',
    color: '#609EF5',
  },
  welcomeTitle: {
    fontSize: 40,
    lineHeight: 52,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  welcomeCopy: {
    fontSize: 16,
    lineHeight: 26,
    color: TEXT_MUTED_ON_DARK,
  },
  welcomeButton: {
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#609EF5',
  },
  welcomeButtonText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
  },
  evolveBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,28,60,0.35)',
  },
  evolveCard: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 36,
    paddingVertical: 28,
    borderRadius: 28,
    backgroundColor: '#f4f7fe',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  evolveTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  evolveCopy: {
    fontSize: 14,
    color: TEXT_MUTED_ON_DARK,
  },
  evolveRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 6,
  },
  evolveChoice: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  evolveImage: {
    width: 110,
    height: 110,
  },
  debugWrap: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 90,
  },
  debugBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3e9f7',
  },
  debugBtnText: {
    fontSize: 15,
    color: '#5b6b8c',
  },
  debugBackdrop: {
    position: 'absolute',
    top: -40,
    left: -40,
    width: 3000,
    height: 3000,
  },
  debugPanel: {
    marginTop: 6,
    width: 430,
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#0b1c4a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  debugStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  debugDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  debugStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5b6b8c',
  },
  debugGroup: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8a97b1',
  },
  debugChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  debugChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f1f5ff',
  },
  debugChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#171d31',
  },
  debugDanger: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffecec',
  },
  debugDangerText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#e5484d',
  },
  mainWho: {
    position: 'absolute',
    top: 26,
    left: 30,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mainWhoPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  mainWhoBlank: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fe',
  },
  mainWhoStar: {
    width: 34,
    height: 34,
  },
  mainWhoName: {
    maxWidth: 130,
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  mainScreen: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
    backgroundColor: '#ffffff',
  },
  mainGreetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  // Balances the star so the greeting itself stays screen-centred.
  buddySpacer: {
    width: 128,
  },
  buddyBubble: {
    // Hangs off the star's right side; the anchor keeps it glued there.
    position: 'absolute',
    left: 198,
    top: 24,
    zIndex: 40,
    minWidth: 230,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: '#609EF5',
  },
  buddyText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  buddyTail: {
    position: 'absolute',
    left: -8,
    top: 26,
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#609EF5',
    transform: [{ rotate: '45deg' }],
  },
  buddyAnchor: {
    position: 'relative',
  },
  buddyMenu: {
    marginTop: 10,
    gap: 8,
  },
  buddyMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  buddyMenuIcon: {
    fontSize: 16,
    color: '#609EF5',
  },
  buddyMenuText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#171d31',
  },
  mainGreetBlock: {
    alignItems: 'center',
    marginTop: 44,
  },
  mainGreetLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainUnderline: {
    height: 8,
    borderRadius: 4,
    marginTop: -6,
    backgroundColor: '#609EF5',
  },
  ringCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: CARD_W,
    justifyContent: 'center',
  },
  carousel: {
    // Children are absolutely placed, so the row needs its own size to catch the drag.
    flex: 1,
    alignSelf: 'stretch',
    // Pushed down so the cards run off the bottom edge — the fan should feel like it continues.
    marginTop: 64,
    marginBottom: -70,
  },
  mainGreeting: {
    fontSize: 40,
    lineHeight: 54,
    fontWeight: '900',
    color: BG,
  },
  mainGreetingSub: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
    marginBottom: 18,
  },
  carouselContent: {
    alignItems: 'center',
    paddingTop: 46,
  },
  card: {
    width: CARD_W,
    // Fills down to the character card's baseline instead of stopping short.
    height: CARD_H + 80,
    borderRadius: CARD_RADIUS,
    paddingTop: 26,
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  cardFocused: {
    zIndex: 2,
    marginHorizontal: -14,
    transform: [{ translateY: -26 }, { scale: 1.06 }],
  },
  cardBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  cardBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
  },
  cardSub: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  cardArt: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 14,
    height: 320,
  },
  backButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 60,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(20,28,60,0.35)',
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  backChip: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    backgroundColor: '#f1f5ff',
  },
  backChipText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#171d31',
  },
  headerSheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4000,
    zIndex: 60,
  },
  headerSheet: {
    position: 'absolute',
    top: 68,
    right: 24,
    minWidth: 176,
    borderRadius: 18,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#0b1c4a',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 70,
  },
  headerSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  headerSheetIcon: {
    fontSize: 15,
    color: '#00CFE9',
  },
  headerSheetText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#171d31',
  },
  headerSheetDivider: {
    height: 1,
    marginVertical: 4,
    backgroundColor: '#eef2fb',
  },
  headerMenu: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  headerMenuLine: {
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: TEXT_ON_DARK,
  },
  detailScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  detailClose: {
    position: 'absolute',
    top: 22,
    right: 28,
    padding: 10,
  },
  detailCloseText: {
    fontSize: 26,
    fontWeight: '900',
    color: BG,
  },
  detailThumb: {
    // Real video shape, so the still is not letterboxed or stretched.
    width: '82%',
    aspectRatio: 16 / 9,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    overflow: 'hidden',
  },
  detailThumbImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  detailOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailStart: {
    alignItems: 'center',
    gap: 10,
  },
  detailPlay: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  detailPlayGlyph: {
    fontSize: 34,
    marginLeft: 6,
    color: '#ffffff',
  },
  detailStartText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 6,
  },
  detailTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: BG,
  },
  detailMeta: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  detailCounts: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  seriesScreen: {
    flex: 1,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  seriesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  seriesBack: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  seriesBackText: {
    fontSize: 18,
    fontWeight: '800',
    color: BG,
  },
  seriesTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#171d31',
  },
  seriesCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  seriesBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 24,
  },
  seriesHero: {
    width: SERIES_HERO_W,
    // Runs the full column, so its bottom lines up with the last row of videos.
    alignSelf: 'stretch',
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 20,
    // Line rides a little above the floor, halfway between the character and the card edge.
    paddingBottom: 110,
  },
  seriesHeroArt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesHeroLine: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
  },
  seriesRight: {
    flex: 1,
    gap: 14,
  },
  seriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingBottom: 20,
  },
  episode: {
    gap: 8,
  },
  episodeThumb: {
    height: 190,
    borderRadius: 18,
    overflow: 'hidden',
  },
  episodeImg: {
    width: '100%',
    height: '100%',
  },
  episodeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: BG,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: '#e3e9f7',
    backgroundColor: '#f4f7fe',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
  },
  tabIcon: {
    fontSize: 18,
    color: TEXT_MUTED_ON_DARK,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  tabActive: {
    color: '#00CFE9',
  },
  charScreen: {
    flex: 1,
  },
  charDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    zIndex: 4,
  },
  charDockBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  charDockArt: {
    width: 38,
    height: 38,
  },
  charDockBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#609EF5',
  },
  strokeHeart: {
    position: 'absolute',
    fontSize: 26,
    color: '#ff8fb1',
  },
  sleepZ: {
    position: 'absolute',
    top: 10,
    right: 18,
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
    opacity: 0.85,
  },
  ffBtn: {
    position: 'absolute',
    top: 20,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    zIndex: 20,
  },
  ffBtnText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#171d31',
  },
  costumeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  costumeCard: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  costumeCardOn: {
    borderColor: '#609EF5',
  },
  costumeArt: {
    width: 108,
    height: 108,
  },
  costumeClose: {
    marginTop: 6,
    paddingHorizontal: 26,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  costumeCloseText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#171d31',
  },
  charFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    zIndex: 8,
  },
  charDockBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  charPanelBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 2,
    borderColor: '#ffffff',
    zIndex: 5,
  },
  charPanelBtnText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#609EF5',
  },
  charPanel: {
    position: 'absolute',
    left: '50%',
    marginLeft: -165,
    bottom: 96,
    width: 330,
    gap: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    zIndex: 5,
  },
  charPanelLine: {
    height: 1,
    backgroundColor: '#e6ecfa',
    marginVertical: 2,
  },
  starWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spark: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    shadowColor: '#bcd8ff',
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  starGlow: {
    position: 'absolute',
    width: 360,
    height: 360,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starRing: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  starArt: {
    width: 260,
    height: 260,
  },
  evolveWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: 'rgba(10,18,45,0.55)',
    zIndex: 6,
  },
  evolveTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  evolveRow: {
    flexDirection: 'row',
    gap: 18,
  },
  evolveCard: {
    width: 170,
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#609EF5',
  },
  evolveArt: {
    width: 110,
    height: 110,
  },
  evolveLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#171d31',
  },
  starLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charPops: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  charPopText: {
    // Pinned inside the star's own top-right corner so it travels with the drag. Android clips
    // children that stick out, so it sits just inside the box rather than beyond it.
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    elevation: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    backgroundColor: '#609EF5',
  },
  charItemOff: {
    opacity: 0.4,
  },
  charStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#b7e3c8',
  },
  charCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  sceneImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
  },
  sceneStrip: {
    gap: 10,
    paddingVertical: 2,
  },
  sceneCell: {
    alignItems: 'center',
    gap: 6,
  },
  sceneThumb: {
    width: 74,
    height: 50,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  sceneThumbOn: {
    borderColor: '#609EF5',
  },
  sceneLabel: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#8a97b1',
  },
  sceneLabelOn: {
    color: '#171d31',
  },
  charBarTrack: {
    height: 16,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#ffffff',
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  charBarFill: {
    position: 'absolute',
    left: 0,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#609EF5',
  },
  charGrowthValue: {
    fontSize: 17,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },

  charCheck: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#b6c8e8',
  },
  charCheckOn: {
    borderColor: '#609EF5',
    backgroundColor: '#609EF5',
  },
  parentScroll: {
    flex: 1,
    paddingBottom: 20,
  },
  parentBody: {
    flex: 1,
    flexDirection: 'row',
    // Columns stretch to the tallest one, so the dividers run the full height.
    alignItems: 'stretch',
    gap: 16,
    padding: 22,
    borderRadius: 28,
    backgroundColor: '#D7EAFF',
  },
  parentDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#a9c8f2',
  },
  parentCol: {
    width: 300,
    gap: 10,
  },
  parentColWide: {
    flex: 1.15,
    gap: 8,
  },
  parentColRight: {
    flex: 1,
    gap: 8,
  },
  parentTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  parentSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a97b1',
  },
  parentMonthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  parentMonthNav: {
    paddingHorizontal: 2,
  },
  parentMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  parentMonthArrow: {
    paddingHorizontal: 6,
    fontSize: 26,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  parentMonthArrowOff: {
    color: '#d3dcee',
  },
  parentMonth: {
    width: 84,
    height: 100,
    borderRadius: 42,
    overflow: 'hidden',
    opacity: 0.92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentMonthOff: {
    backgroundColor: '#eef3fd',
  },
  parentMonthYearOff: {
    color: '#a9b6cf',
  },
  parentMonthNumOff: {
    color: '#8a97b1',
  },
  parentMonthYear: {
    fontSize: 13,
    fontWeight: '800',
    color: '#dbeafe',
  },
  parentMonthNum: {
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
  },
  parentWeek: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 26,
    overflow: 'hidden',
    // Solid base under the gradient: without it a dropped fill leaves an invisible button.
    backgroundColor: '#eef3fd',
  },
  parentWeekOn: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#609EF5',
  },
  parentWeekText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
    textAlign: 'center',
  },
  parentWeekTextOn: {
    color: '#171d31',
  },
  parentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(96,158,245,0.4)',
  },
  parentTagStar: {
    fontSize: 15,
    color: '#3f7fe0',
  },
  parentTagText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#192853',
  },
  parentHint: {
    marginTop: 4,
    marginBottom: 14,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#8a97b1',
  },
  parentClock: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dbeafe',
  },
  parentClockFace: {
    fontSize: 64,
  },
  parentStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
  },
  parentStat: {
    width: '47%',
    paddingVertical: 4,
  },
  parentStatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  parentStatArt: {
    width: 40,
    height: 40,
  },
  parentStatValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#609EF5',
  },
  parentStatUnit: {
    fontSize: 15,
    fontWeight: '800',
    color: '#609EF5',
    marginBottom: 4,
  },
  parentStatLabel: {
    marginLeft: 48,
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  parentStatDelta: {
    marginLeft: 48,
    fontSize: 12,
    fontWeight: '800',
  },
  deltaUp: {
    color: '#2f8f5b',
  },
  deltaDown: {
    color: '#d9534f',
  },
  parentHintOn: {
    color: '#609EF5',
    textDecorationLine: 'underline',
  },
  momentCard: {
    marginBottom: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#e4efff',
    overflow: 'hidden',
  },
  // Sits behind the words, faded, so the card reads as a sentence with a picture rather than
  // an icon with a caption.
  momentArt: {
    position: 'absolute',
    right: 10,
    bottom: 6,
    width: 74,
    height: 74,
    opacity: 0.28,
  },
  momentTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8a97b1',
  },
  momentHead: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '900',
    color: '#171d31',
  },
  momentHeadOn: {
    color: '#609EF5',
  },
  momentBody: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  parentChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  parentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  parentChipArt: {
    width: 32,
    height: 32,
  },
  parentChipText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#171d31',
  },
  qdBody: {
    gap: 8,
    paddingBottom: 24,
  },
  qdGroup: {
    gap: 6,
  },
  qdVideo: {
    paddingTop: 8,
    fontSize: 13,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  qdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  qdAt: {
    width: 46,
    fontSize: 12,
    fontWeight: '900',
    color: '#609EF5',
  },
  qdText: {
    flex: 1,
  },
  qdKind: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8a97b1',
  },
  qdTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  qdAnswer: {
    fontSize: 13,
    fontWeight: '900',
    color: '#2f8f5b',
  },
  wordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingBottom: 24,
  },
  wordCard: {
    width: 300,
    gap: 8,
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  wordHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  wordDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  wordText: {
    flex: 1,
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  wordBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#00CFE9',
  },
  wordMeaning: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  wordExample: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
  },
  tabScreen: {
    flex: 1,
  },
  tabHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 14,
  },
  tabHeadTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  settingsBody: {
    gap: 14,
    paddingBottom: 24,
  },
  settingsCard: {
    gap: 12,
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  settingsCardTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  settingsRowText: {
    flex: 1,
    gap: 2,
  },
  settingsLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  settingsHint: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a97b1',
  },
  settingsValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#00CFE9',
  },
  settingsEdit: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
  },
  settingsEditText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#00CFE9',
  },
  toggle: {
    width: 56,
    height: 32,
    borderRadius: 16,
    padding: 3,
    backgroundColor: '#dde5f5',
  },
  toggleOn: {
    backgroundColor: '#00CFE9',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  toggleKnobOn: {
    marginLeft: 24,
  },
  tabPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardScreen: {
    flex: 1,
    padding: 30,
    gap: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  onboardHeader: {
    alignItems: 'center',
    gap: 4,
  },
  onboardStep: {
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  onboardTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  onboardCopy: {
    fontSize: 14,
    color: TEXT_MUTED_ON_DARK,
  },
  onboardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 56,
  },
  onboardFields: {
    gap: 10,
    // Matches the picker track, and gives the consent sentence room to wrap cleanly.
    width: LIMIT_TRACK_W,
  },
  photoCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fe',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  photoImage: {
    width: 128,
    height: 128,
    borderRadius: 64,
  },
  photoBadge: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#609EF5',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  photoBadgeText: {
    fontSize: 16,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 14,
  },
  stepperCol: {
    alignItems: 'center',
    gap: 8,
  },
  stepperCard: {
    width: 118,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    backgroundColor: '#eaf9fc',
  },
  stepperViewport: {
    height: WHEEL_ITEM_H,
    alignSelf: 'stretch',
  },
  stepperItem: {
    height: WHEEL_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperArrowText: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: '#609EF5',
  },
  stepperArrowDown: {
    marginTop: -4,
  },
  stepperValue: {
    fontSize: 42,
    lineHeight: 52,
    fontWeight: '900',
    color: '#609EF5',
  },
  stepperColon: {
    marginTop: 44,
    fontSize: 30,
    fontWeight: '900',
    color: '#609EF5',
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  onboardLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  onboardInput: {
    width: 368,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 16,
    fontSize: 17,
    color: TEXT_ON_DARK,
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  birthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    width: 116,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  dropdownValue: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  dropdownCaret: {
    fontSize: 13,
    color: TEXT_MUTED_ON_DARK,
  },
  dropdownBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,28,60,0.3)',
  },
  dropdownSheet: {
    width: 200,
    maxHeight: 320,
    borderRadius: 20,
    paddingVertical: 8,
    backgroundColor: '#f4f7fe',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  dropdownOption: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownOptionOn: {
    backgroundColor: '#00CFE9',
  },
  dropdownOptionText: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT_ON_DARK,
  },
  dropdownOptionTextOn: {
    fontWeight: '900',
    color: '#04122b',
  },
  birthAge: {
    fontSize: 14,
    fontWeight: '800',
    color: '#609EF5',
  },
  guardianFields: {
    alignItems: 'center',
  },
  consentRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    // Top-aligned so the box stays on the first line when the sentence wraps.
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  checkboxOn: {
    backgroundColor: '#609EF5',
    borderColor: '#609EF5',
  },
  checkboxMark: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
  },
  consentTextWrap: {
    gap: 2,
    alignItems: 'center',
  },
  consentSub: {
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED_ON_DARK,
  },
  consentText: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_ON_DARK,
  },
  consentRequired: {
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  chipText: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  onboardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  toolStrip: {
    alignSelf: 'center',
    marginTop: 10,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  toolChipOn: {
    backgroundColor: '#00CFE9',
  },
  toolChipIcon: {
    fontSize: 16,
  },
  toolChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  toolDivider: {
    width: 1,
    height: 24,
    borderRadius: 1,
    backgroundColor: '#e6ecfa',
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  iconBtnOff: {
    opacity: 0.35,
  },
  iconBtnText: {
    fontSize: 17,
    color: TEXT_ON_DARK,
  },
  sizeSlider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sizeDotWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelHitSm: {
    width: 120,
    height: 26,
    justifyContent: 'center',
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatchMore: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#00CFE9',
    borderWidth: 2,
  },
  swatchMoreText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  pickerBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,25,40,0.35)',
  },
  pickerCard: {
    gap: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#f4f7fe',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  pickerTabs: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'center',
  },
  pickerTab: {
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f1f5ff',
  },
  pickerTabOn: {
    backgroundColor: '#00CFE9',
  },
  pickerTabText: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  pickerGrid: {
    flexDirection: 'row',
    alignSelf: 'center',
  },
  pickerCol: {
    flexDirection: 'column',
  },
  pickerCell: {
    width: 30,
    height: 26,
  },
  pickerCellOn: {
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  pickerCustom: {
    gap: 6,
    paddingVertical: 6,
  },
  pickerReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  pickerPreview: {
    width: 54,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  pickerReadoutItem: {
    alignItems: 'center',
  },
  pickerReadoutLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
  },
  pickerReadoutValue: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  pickerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 6,
  },
  pickerFooterBtn: {
    paddingHorizontal: 30,
    paddingVertical: 8,
  },
  pickerFooterText: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  swatchSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  recentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  channelLabel: {
    width: 14,
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  channelHit: {
    width: 170,
    height: 26,
    justifyContent: 'center',
  },
  channelTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e3e9f7',
  },
  channelFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
  },
  channelThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: '#f4f7fe',
    borderWidth: 3,
    borderColor: '#00CFE9',
  },
  channelValue: {
    width: 30,
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
    textAlign: 'right',
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    opacity: 0.92,
  },
  padPlaceholder: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: COLORS.blueSoft,
    color: COLORS.blueDark,
    fontSize: 20,
    fontWeight: '900',
  },
  reportScreen: {
    flex: 1,
    padding: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  reportIcon: {
    width: 82,
    height: 82,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#64748b',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  reportBadge: {
    position: 'absolute',
    top: -9,
    right: -8,
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f057a8',
  },
  reportBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
  },
  reportIconSymbol: {
    color: COLORS.blueDark,
    fontSize: 29,
    fontWeight: '900',
  },
  reportIconLabel: {
    marginTop: 4,
    color: TEXT_ON_DARK,
    fontSize: 13,
    fontWeight: '900',
  },
  reportActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportCardWide: {
    width: '92%',
    maxWidth: 1040,
    padding: 34,
    borderRadius: 28,
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#7ba3ff',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  reportHead: {
    alignItems: 'center',
    marginBottom: 22,
  },
  reportTitle: {
    color: TEXT_ON_DARK,
    fontSize: 30,
    fontWeight: '900',
  },
  reportDate: {
    marginTop: 7,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 15,
    fontWeight: '800',
  },
  reportBody: {
    width: '100%',
    flexDirection: 'row',
    gap: 26,
    marginBottom: 24,
  },
  reportArtCol: {
    alignItems: 'center',
  },
  reportColLabel: {
    color: TEXT_ON_DARK,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
  },
  reportArtBox: {
    width: 300,
    minHeight: 288,
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    // Picture frame: thick warm mount, thin dark rim, and a soft drop shadow.
    borderWidth: 10,
    borderColor: '#d9b382',
    shadowColor: '#171d31',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  reportArtCaption: {
    marginTop: 12,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 14,
    fontWeight: '800',
  },
  reportSumCol: {
    flex: 1,
    justifyContent: 'center',
    // Frame and summary sit on the same baseline height.
    minHeight: 308,
  },
  reportStatsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  reportStat: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#64748b',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  reportStatValue: {
    fontSize: 42,
    fontWeight: '900',
  },
  reportStatLabel: {
    marginTop: 4,
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: '900',
  },
  reportChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  reportChip: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.blueSoft,
  },
  reportChipText: {
    color: COLORS.blueDark,
    fontSize: 14,
    fontWeight: '900',
  },
  generatedWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedImage: {
    width: '100%',
    height: '100%',
  },
});
