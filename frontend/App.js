import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StatusBar, StyleSheet, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Path } from 'react-native-svg';
import { Skia } from '@shopify/react-native-skia';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import getStroke from 'perfect-freehand';
import PuzzleScreen from './Puzzle';
import { playSound } from './sound';
import { ageInMonths } from './age';
import { ActivitiesScreen, WatchScreen } from './screens/Watch';
import { HomeScreen } from './screens/Home';
import { DrawingScreen } from './screens/Drawing';
import { COLORS } from './theme';
import { CHARACTER_TOPICS, DEMO_VIDEO, LIBRARY, SERIES_ART, TOPIC_STYLE, voiceFor } from './data/library';
import { QUIZ_POOL } from './data/quiz-pool';
import { DUO_FRAME_AT } from './data/duo-shapes';
import { koreanForSeries, koreanPoolFor } from './data/korean-pool';
import { CenterPopup } from './ui/CenterPopup';
import { TabletHeader } from './ui/Header';
import { StoryDotLogo } from './ui/Logo';
import { ScreenFade } from './ui/motion';
import { EvolvePopup } from './screens/Character';
import { ChildProfileScreen, GuardianSetupScreen } from './screens/Onboarding';
import { OnboardSlides } from './screens/OnboardSlides';
import { LoadingScreen } from './screens/Loading';
import { PackageScreen } from './screens/Package';
import { ByeScreen } from './screens/Bye';
import { buttons } from './ui/buttons';
import { MainScreen } from './screens/Browse';
import { OFFLINE_ACTIVITIES } from './data/activities';
import { ReportScreen } from './screens/Report';
import ActivityStage from './activities/ActivityStage';
import * as ImagePicker from 'expo-image-picker';
import { DebugJump } from './ui/DebugJump';


// The content server runs beside the dev server, so its host is the one we are bundling from.
const CONTENT_PORT = 5056;
// 노트북 없이 도는 날의 매체 뿌리. media/ 를 통째로 여기에 올려 두면 서버가 주던 경로
// (/media/video/…, /media/frame/…)가 그대로 파일 경로가 된다. 앱 전용 폴더라 권한도 필요 없다.
const OFFLINE_BASE = 'file:///sdcard/Android/data/com.flyai.patti/files';
const OFFLINE_LIBRARY = require('./assets/library.json');
const OFFLINE_MISSIONS = require('./assets/missions.json');
function contentBase() {
  const hostUri = Constants.expoConfig?.hostUri || '';
  const host = Platform.OS === 'android' ? hostUri.split(':')[0] || 'localhost' : 'localhost';
  return `http://${host}:${CONTENT_PORT}`;
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
      // Kept alongside the pretty label so screens can add the day up.
      durationSec: v.duration_sec,
      color: v.color || art.color,
      still: v.thumbPath ? { uri: base + encodeURI(v.thumbPath) } : null,
      // 서버가 켜져 있으면 스트리밍, 아니면 패드에 올려 둔 같은 이름의 파일.
      source: v.videoPath ? { uri: base + encodeURI(v.videoPath) } : null,
    })),
  };
}


// Demo questions until the pipeline fills the activity table: one per template, so the variety
// the pipeline will produce is visible today. Keys match oneshot/schemas.py.


// Which questions this episode asks. Ported from oneshot/plan_types.py: kinds the child gets
// wrong come up more often, but only after enough attempts to tell a stumble from a pattern.
const MIN_ATTEMPTS = 3;
const MAX_BOOST = 2.0;

function pickQuizzes(history, count, pool = QUIZ_POOL) {
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

  const remaining = pool.map((q, i) => i);
  const picks = [];
  while (picks.length < count && remaining.length) {
    const weights = remaining.map((i) => weightOf(pool[i].kind));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let at = 0;
    while (at < weights.length - 1 && roll > weights[at]) { roll -= weights[at]; at += 1; }
    picks.push(remaining[at]);
    remaining.splice(at, 1);
  }
  return picks;
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
  // First run walks the grown-up through setup; every launch opens on the painted slides.
  const [screen, setScreen] = useState('welcome');
  // 한 패드를 형제가 나눠 쓴다. 목록을 두고 지금 아이만 화면에 넘긴다 — 나이가 다르면
  // 문항 세트도 따라 바뀐다.
  const [profiles, setProfiles] = useState([DEFAULT_PROFILE]);
  const [activeChild, setActiveChild] = useState(0);
  const childProfile = profiles[activeChild] || DEFAULT_PROFILE;
  const setChildProfile = (next) => setProfiles((list) => list.map((p, i) => (
    i === activeChild ? (typeof next === 'function' ? next(p) : next) : p
  )));
  const addChild = () => {
    setProfiles((list) => [...list, { ...DEFAULT_PROFILE }]);
    setActiveChild(profiles.length);
    setScreen('profile');
  };
  const [guardianSettings, setGuardianSettings] = useState(DEFAULT_SETTINGS);
  // Until the saved profile is read back, onboarding must not flash on an returning child's tablet.
  const [restored, setRestored] = useState(false);
  // Korean activities come in two age bands. Until the pipeline authors them per video, the child's
  // own age picks the set — a seven-year-old asked four-year-old questions stops trying.
  const quizPool = koreanPoolFor(ageInMonths(childProfile.birth));

  // Where in today's set we are. Only the first video carries a break — the day runs
  // 영상 → 국어·수학 → 영상 → 그림, and a second interruption is one too many.
  const [dayIndex, setDayIndex] = useState(0);

  // Opening a video: ask the server for its activity plan and open a session to record against.
  const startWatching = (video, index = 0) => {
    setPicks(pickQuizzes(quizHistory, 3, quizPool));
    setPlan([]);
    sessionId.current = null;
    if (video?.id) {
      // 문항은 바로 아래에서 골라 세운다. 여기서는 퀴즈가 아닌 활동만 미리 깔아 둔다 —
      // 스냅숏에는 그 영상의 문항이 통째로 들어 있어서, 그대로 두면 열댓 개가 한꺼번에 나온다.
      const bundled = (OFFLINE_ACTIVITIES[video.id] || [])
        .filter((a) => a.type !== 'quiz')
        .map((a) => ({ ...a, at_sec: null, at: null }));
      setPlan(bundled);
      api(`/videos/${video.id}`).then((v) => {
        // 서버가 없으면 앱과 함께 나간 스냅숏이 같은 문항을 낸다.
        const activities = v?.activities?.length ? v.activities : OFFLINE_ACTIVITIES[video.id] || [];
        // 문항은 영상을 다 본 뒤에 낸다 — at 을 주지 않으면 화면이 끝까지 재생하고 나서 묻는다.
        // 국어가 먼저, 그 다음 수학. 둘 다 이 영상을 분석해서 만든 것이다.
        const withPayload = activities.map((a) => {
          try {
            return { ...a, pay: typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {} };
          } catch (e) { return { ...a, pay: {} }; }
        });
        // 국어는 시리즈에 맞춰 손으로 쓴 것, 수학은 이 영상을 분석해 만든 것.
        const k = koreanForSeries(selectedSeries?.id, ageInMonths(childProfile.birth), index);
        const korean = k && {
          type: 'quiz',
          payload: { activity_template: k.kind, title: k.title, options: k.options, answer: k.answer },
        };
        // 아이 나이에 가장 가까운 수 문항. 서버는 감당 못 할 것만 빼 주므로 쉬운 것이 잔뜩
        // 남는다 — 일곱 살에게 세 살 문항을 내면 배우는 것이 없다.
        const pinnedTitle = DEMO_MATH[video.id];
        const years = Math.floor((ageInMonths(childProfile.birth) ?? 48) / 12);
        const numbers = withPayload
          .filter((a) => a.pay.domain === '자연탐구' && Array.isArray(a.pay.options))
          .sort((a, b) => Math.abs(parseInt(a.pay.age, 10) - years) - Math.abs(parseInt(b.pay.age, 10) - years));
        // 손으로 쓴 문항이면 그 프레임만 빌려 새 문항으로 세운다.
        const custom = typeof pinnedTitle === 'object' ? pinnedTitle : null;
        const borrowed = custom && withPayload.find((a) => a.pay.title === custom.frameFrom);
        // 손으로 하는 활동으로 지정된 자리는 문항 대신 그 활동을 낸다.
        const math = custom?.activity
          ? { type: custom.activity, payload: { frame: custom.frame }, at: custom.at, at_sec: custom.at }
          : custom
          ? {
              type: 'quiz',
              pay: {},
              payload: {
                activity_template: custom.template,
                title: custom.title,
                answer: custom.answer,
                age: custom.age,
                domain: '자연탐구',
                options: custom.choices.map((label, i) => ({
                  label,
                  // 파랑 · 빨강 · 초록 — 옆자리끼리 색이 비슷해 보이지 않게.
                  color: ['#2b7fd7', '#e03131', '#2fa96b'][i % 3],
                  bg: ['#eef5ff', '#fff5f5', '#eefaf2'][i % 3],
                })),
                framePath: borrowed?.pay?.framePath,
              },
            }
          : (pinnedTitle && withPayload.find((a) => a.pay.title === pinnedTitle))
            || numbers[0] || withPayload[0];
        // 문항의 근거 프레임. 서버가 상대 경로로 주므로 여기서 주소를 붙인다.
        const withFrame = (a) => {
          const path = a.pay?.framePath || a.payload?.framePath;
          if (!path) return a;
          // 파일 이름에 한글이 들어간다(타요스페셜3화). 인코딩하지 않으면 안드로이드가 못 읽는다.
          const base = a.pay && Object.keys(a.pay).length ? a.pay : a.payload;
          return { ...a, payload: { ...base, title: friendly(base.title), frameUri: mediaBase + encodeURI(path) } };
        };
        // 문항은 영상이 끝난 뒤에 낸다. 손으로 하는 활동만은 제 시각을 지킨다 —
        // 영상이 그 프레임에서 멈추고 그 화면이 그대로 판이 되어야 하기 때문이다.
        // 중간 개입은 제 시각을 지키고, 문항 둘은 영상이 끝난 뒤로 밀린다.
        const mid = DEMO_PUZZLE[video.id];
        const puzzle = mid && {
          type: 'wheels', payload: { frame: mid.frame }, at: mid.at, at_sec: mid.at,
        };
        const asked = [korean, math, puzzle].filter(Boolean)
          .map(withFrame)
          .map((a) => (a.at_sec != null ? a : { ...a, at_sec: null, at: null }));
        if (!asked.length) return;
        const ours = bundled.filter((a) => a.type !== 'quiz');
        setPlan([...asked, ...ours]);
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
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [series, setSeries] = useState(LIBRARY[0].videos);
  const [contentUp, setContentUp] = useState(false);
  // 프레임·썸네일을 어디서 읽을지. 서버가 대답하면 서버, 아니면 패드에 올려 둔 media 폴더.
  const [mediaBase, setMediaBase] = useState(contentBase());
  const [childId, setChildId] = useState(null);
  const sessionId = useRef(null);
  // Server-authored activity plan for the video being watched; empty means use the built-in one.
  const [plan, setPlan] = useState([]);
  const [quizHistory, setQuizHistory] = useState([]);
  const [picks, setPicks] = useState([0, 1, 2]);
  const [seekTo, setSeekTo] = useState(null);
  const [drawStrokes, setDrawStrokes] = useState([]);
  const [savedDrawing, setSavedDrawing] = useState(null);
  // What today's series asks the child to draw, and how the finished picture should look — each
  // show has its own art, so a Pororo drawing should not come back as a Teenieping one.
  // 캐릭터를 고른 적이 없어도(디버그로 바로 들어온 경우) 방금 본 영상의 id 로 시리즈를 알아낸다.
  const seriesKey = selectedSeries?.id
    || Object.keys(SERIES_ART).find((k) => selectedVideo?.id?.startsWith(k))
    || null;
  const seriesArt = SERIES_ART[seriesKey] || {};
  // 그릴 거리는 시리즈마다 서너 개 있고, 그 회차에 하나가 걸린다. 같은 아이가 며칠 와도
  // 같은 것만 그리지 않게 세션마다 새로 뽑는다.
  // 그림판에 들어갈 때마다 새로 뽑는다 — 같은 시리즈를 두 번 봐도 같은 것만 그리지 않게.
  const [drawRound, setDrawRound] = useState(0);
  const drawTopic = useMemo(() => {
    const pool = seriesArt.topics || (seriesArt.topic ? [seriesArt.topic] : []);
    if (!pool.length) return '내가 좋아하는 것';
    return pool[Math.floor(Math.random() * pool.length)];
  }, [seriesKey, drawRound]);
  // 시리즈 화풍 + 그 주제가 실제로 무엇처럼 생겼는지. 둘을 합쳐야 "소방차"가 소방차로 나온다.
  const drawStyle = [seriesArt.style, TOPIC_STYLE[drawTopic] && `The subject is ${TOPIC_STYLE[drawTopic]}.`]
    .filter(Boolean).join(' ');
  const [drawCanvasSize, setDrawCanvasSize] = useState({ width: 620, height: 380 });
  const [doodleStrokes, setDoodleStrokes] = useState([]);
  const [doodleCanvasSize, setDoodleCanvasSize] = useState({ width: 620, height: 380 });
  const [characterImage, setCharacterImage] = useState(null);
  const [characterStatus, setCharacterStatus] = useState('idle');
  const [characterError, setCharacterError] = useState('');
  const [quizDone, setQuizDone] = useState(false);
  // 오늘 실제로 본 시간(초). 편마다 마지막으로 알려 온 값을 더해 리포트에 싣는다.
  const [watchedSec, setWatchedSec] = useState(0);
  const [log, setLog] = useState({ quiz: 0, drawing: 0, skip: 0 });
  // 사탕 열 개를 손에 쥐고 시작한다 — 처음 온 아이도 별에게 바로 먹여 볼 수 있어야 한다.
  const [quizCorrectCount, setQuizCorrectCount] = useState(__DEV__ ? 1000 : 10);
  const [fedCount, setFedCount] = useState(0);
  const [tab, setTab] = useState('library');
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [evolving, setEvolving] = useState(false);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  // "오늘은 우리 뭐 할까"는 하루를 여는 인사다. 메인에 닿을 때 울리되 한 번만 — 영상에서
  // 돌아올 때마다 되풀이하면 인사가 아니라 소음이 된다.
  const greeted = useRef(false);
  useEffect(() => {
    // 인트로를 지나면 새 하루다 — 앱을 켤 때도, 기록을 지우고 처음부터 할 때도 그 화면을 거친다.
    if (screen === 'welcome') greeted.current = false;
    if (screen !== 'main' || greeted.current) return;
    greeted.current = true;
    playSound('main');
  }, [screen]);

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
        // No server: fall back to the library shipped with the app, playing the local media files.
        const built = OFFLINE_LIBRARY.map((c) => toSeries(c, OFFLINE_BASE)).filter(Boolean);
        if (built.length) setSeries(built);
        setContentUp(false);
        setMediaBase(OFFLINE_BASE);
      });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        const list = saved.profiles?.length ? saved.profiles
          : saved.profile ? [saved.profile] : null;
        if (list) {
          setProfiles(list.map((p) => ({ ...DEFAULT_PROFILE, ...p })));
          setActiveChild(Math.min(saved.activeChild || 0, list.length - 1));
        }
        if (saved.settings) setGuardianSettings({ ...DEFAULT_SETTINGS, ...saved.settings });
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
    if (!restored) return;
    // The slides open every launch; where their button leads is what the saved profile decides.
    setScreen('welcome');
  }, [restored, onboarded]);

  useEffect(() => {
    if (!restored) return; // never write the defaults over a saved profile before it is read
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({
      profiles, activeChild, settings: guardianSettings, childId, quizHistory,
    })).catch(() => {});
  }, [restored, profiles, activeChild, guardianSettings, childId, quizHistory]);

  // The tablet's own back gesture should walk the app back, not drop the child out of it.
  useEffect(() => {
    const back = {
      profile: 'welcome',
      guardian: 'profile',
      home: 'main',
      loading: 'main',
      package: 'main',
      watch: 'main',
      activities: 'main',
      drawing: 'activities',
      report: 'main',
      bye: 'main',
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
    // 정사각으로 보낸다. 그림판이 가로로 길어서 그대로 보내면 변환 결과도 가로로 나오고,
    // 그 안에서 캐릭터가 작게 앉는다. 남는 자리는 흰 여백으로 둔다.
    const side = Math.max(w, h);
    const surface = Skia.Surface.MakeOffscreen(side, side);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('#ffffff'));
    canvas.translate((side - w) / 2, (side - h) / 2);
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

  const runGeneration = async (strokes, canvasSize, topic, style) => {
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
      const timeout = setTimeout(() => abort.abort(), 150000);
      let response;
      try {
        response = await fetch(CHARACTER_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({ imageBase64, topic, style, character: CHARACTER_TOPICS.has(topic) }),
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
    setDrawRound((n) => n + 1);
    setDrawStrokes([]);
    setCharacterStatus('idle');
    setCharacterError('');
    setScreen('drawing');
  };

  const completeDrawing = () => {
    setLog((prev) => ({ ...prev, drawing: Math.max(prev.drawing, 1) }));
    setScreen('report');
  };

  // 시연에서는 오늘 볼 두 편을 고정한다. 편성기는 본 것을 피해 매번 다른 화를 고르는데,
  // 그러면 그 화의 이야기로 쓴 국어 문항과 어긋난다.
  const DEMO_PINS = {
    // 세 편이 하루치다. 티니핑의 1분·6분짜리 특별편은 묶음이 허전해 보여 빼 두었다.
    tayo: ['tayo-타요스페셜3화', 'tayo-타요마법버스1화', 'tayo-타요스페셜1화'],
    teenieping: ['teenieping-05', 'teenieping-09', 'teenieping-10'],
  };

  // 파이프라인 문항은 존댓말로 나온다. 아이에게는 친구가 묻듯 반말이 편해서 화면에 낼 때만 고친다.
  const friendly = (t = '') => t
    .replace(/있어요\./g, '있어.')
    .replace(/몇 개 더 많을까요\?/g, '몇 개 더 많을까?')
    .replace(/모두 몇 (개|대|그루|마리)일까요\?/g, '모두 몇 $1일까?')
    .replace(/몇 (개|대|그루|마리|채) 있나요\?/g, '몇 $1 있을까?')
    .replace(/무슨 색인가요\?/g, '무슨 색일까?')
    .replace(/어느 것이 더 큰가요\?/g, '어느 게 더 클까?')
    .replace(/어느 것이 더 (큰|작은)가요\?/g, '어느 게 더 $1까?')
    .replace(/찾아보세요\./g, '찾아볼까?')
    .replace(/이 그림/g, '그림');

  // 시연에서 낼 수 문항을 영상마다 하나씩 못 박는다. 파이프라인이 뽑은 것 그대로지만,
  // 그림이 애매하지 않은 것 — 문장에 개수가 이미 적혀 있거나 크기를 눈으로 견주는 것 — 으로 골랐다.
  // 영상 한복판에서 한 번 멈춰 세우는 자리. 문항은 영상이 끝난 뒤에 내지만 이건 보는 도중에
  // 끼어든다 — 파이프라인(events.py)이 사건을 근거로 고른 지점이다.
  const DEMO_PUZZLE = {
    'teenieping-05': { frame: 'teenieping-duo', at: DUO_FRAME_AT },
    'teenieping-10': { frame: 'teenieping-faces', at: 318 },
  };

  const DEMO_MATH = {
    // 손으로 쓴 문항. frameFrom 이 가리키는 파이프라인 문항의 근거 프레임을 그대로 빌려 쓴다.
    // 세어서 고르는 대신 직접 끼운다 — 바퀴를 도려낸 사진에 제자리를 찾아 넣는다.
    'tayo-타요마법버스1화': {
      // 파랑·노랑·빨강 버스가 나란히 선 장면.
      frameFrom: '이 그림에 빨간 버스 1대와 노란 버스 1대, 파란 버스 1대가 있어요. 버스는 모두 몇 대일까요?',
      title: '화면 속에 버스는 모두 몇대일까?',
      answer: '3',
      choices: ['1', '2', '3'],
      age: '4세',
      template: '모두 세기',
    },
    // 세 편이 같은 유형만 물으면 두 번째부터는 아이가 답을 세지 않고 형태를 외운다.
    // 가르기 → 합 → 세기로 유형을 갈라 둔다.
    'teenieping-05': '이 그림에 초록색 화분 3개와 분홍색 집 1개가 있어요. 화분이 몇 개 더 많을까요?',
    'teenieping-09': '이 그림에 검은 휴대폰 1개와 초록색 나무 5개가 있어요. 모두 몇 개일까요?',
    // 파이프라인은 티니핑을 "인형"으로 세어 두었다. 아이에게는 그 이름으로 물어야 하므로
    // 근거 프레임만 빌려 문항을 새로 세운다.
    'teenieping-10': {
      frameFrom: '이 그림에 초록색 인형 2개와 분홍색 인형 1개, 초록색 나무 5그루가 있어요. 모두 몇 개일까요?',
      title: '그림에 티니핑이 몇 명 있을까?',
      answer: '3',
      choices: ['2', '3', '4'],
      age: '6세',
      template: '개수 세기',
    },
  };

  // Today's set. The server plans it: it knows the time budget, what this child has already seen,
  // and which activities their age can take. Asked for while the buddy keeps them company on the
  // loading screen, so the wait is the planning.
  const [todayPick, setTodayPick] = useState([]);
  // The grown-up mission the planner picked to close the day with.
  const [mission, setMission] = useState(null);
  useEffect(() => {
    if (screen !== 'loading') return undefined;
    let live = true;
    const pool = (selectedSeries?.episodes || []).length
      ? selectedSeries.episodes
      : [...series].sort((a, b) => (b.episodes?.length || 0) - (a.episodes?.length || 0))[0]?.episodes || [];
    // 시연에서 낼 두 편은 서버가 답하지 않아도 그대로 나와야 한다.
    const byIdPool = new Map(pool.map((v) => [v.id, v]));
    const pins = (DEMO_PINS[selectedSeries?.id] || []).map((id) => byIdPool.get(id)).filter(Boolean);

    // What to show if the server cannot plan: a few episodes of the series they picked, and a
    // mission from the same list the planner would have drawn from.
    const fallback = () => {
      const mine = OFFLINE_MISSIONS.filter((m) => m.characterIds.includes(selectedSeries?.id));
      const pick = mine.length ? mine : OFFLINE_MISSIONS;
      setMission(pick[Math.floor(Math.random() * pick.length)] || null);
      if (pins.length) { setTodayPick(pins); return; }
      const rest = [...pool];
      const out = [];
      while (rest.length && out.length < 3) out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
      if (live) setTodayPick(out);
    };
    const query = [
      `character_id=${encodeURIComponent(selectedSeries?.id || '')}`,
      `budget_sec=${(guardianSettings.dailyLimit || 30) * 60}`,
      childId ? `child_id=${encodeURIComponent(childId)}` : '',
    ].filter(Boolean).join('&');
    fetch(`${contentBase()}/plan?${query}`)
      .then((r) => r.json())
      .then((res) => {
        if (!live) return;
        if (!res?.ok) { fallback(); return; }
        setMission(res.plan.mission || null);
        // The plan speaks in ids; the screens want the episode objects the library already built.
        if (pins.length) { setTodayPick(pins); return; }
        const picked = (res.plan.videoIds || []).map((id) => byIdPool.get(id)).filter(Boolean);
        picked.length ? setTodayPick(picked) : fallback();
      })
      .catch(fallback);
    return () => { live = false; };
  }, [screen, selectedSeries, series, childId, guardianSettings.dailyLimit]);

  const report = useMemo(
    () => ({
      quiz: log.quiz,
      drawing: log.drawing,
      skip: log.skip,
      watchedSec,
      interests: ['고래', '용기', '친구', '색깔'],
    }),
    [log, watchedSec]
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <ExpoStatusBar style="dark" />
        <StatusBar hidden />
        <View style={styles.outer}>
        <View style={styles.tablet}>
          {screen !== 'welcome' && screen !== 'profile' && screen !== 'guardian' && screen !== 'main' && screen !== 'bye' && (
            <TabletHeader
              rightLabel={screen === 'report' ? '오늘 활동 집계' : '더보기'}
              onHome={() => setScreen('main')}
              onReport={() => setScreen('report')}
              // 영상 is the main screen's carousel; the other tabs live on the list screen.
              onTab={(key) => { setSelectedSeries(null); setTab(key); setScreen(key === 'library' ? 'main' : 'home'); }}
            />
          )}
          <ScreenFade screenKey={screen}>
          {screen === 'loading' && (
            <LoadingScreen
              profile={childProfile}
              voice={voiceFor(selectedSeries?.id)}
              onStart={() => setScreen('package')}
              onBack={() => setScreen('main')}
            />
          )}
          {screen === 'bye' && <ByeScreen profile={childProfile} mission={mission} onUnlock={() => setScreen('main')} />}
          {screen === 'package' && (
            <PackageScreen
              profile={childProfile}
              voice={voiceFor(selectedSeries?.id)}
              videos={todayPick}
              onBack={() => setScreen('main')}
              onStart={() => { const first = todayPick[0]; if (first) { setDayIndex(0); setSelectedVideo(first); startWatching(first, 0); } }}
            />
          )}
          {screen === 'welcome' && (
            <OnboardSlides
              onNext={() => setScreen(onboarded ? 'main' : 'profile')}
            />
          )}
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
              onStart={(v) => { setSelectedSeries(v || null); setScreen('loading'); }}
              // A search hit is one episode, so it goes straight to its own screen.
              onMenu={(key) => { setSelectedSeries(null); setTab(key); setScreen('home'); }}
              onJump={(key) => { if (key === 'watch') setSelectedVideo(series[0]?.episodes?.[0] || LIBRARY[1].videos[0]); setScreen(key); }}
              contentUp={contentUp}
              onReset={() => {
                AsyncStorage.removeItem(STORE_KEY).catch(() => {});
                setChildProfile(DEFAULT_PROFILE);
                setGuardianSettings(DEFAULT_SETTINGS);
                setFedCount(0);
                setQuizCorrectCount(__DEV__ ? 1000 : 10);
                setOnboarded(false);
                setScreen('welcome');
              }}
            />
          )}
          {screen === 'home' && (
            <HomeScreen
              profile={childProfile}
              tab={tab}
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
              report={report}
              feed={quizCorrectCount}
              fed={fedCount}
              onFeed={() => setFedCount((n) => n + 1)}
              onEditProfile={() => setScreen('profile')}
              profiles={profiles}
              activeChild={activeChild}
              onPickChild={setActiveChild}
              onAddChild={addChild}
              onOpenReport={() => setTab('parent')}
              onWipe={() => {
                AsyncStorage.removeItem(STORE_KEY).catch(() => {});
                setChildProfile(DEFAULT_PROFILE);
                setGuardianSettings(DEFAULT_SETTINGS);
                setFedCount(0);
                setQuizCorrectCount(__DEV__ ? 1000 : 10);
                setOnboarded(false);
                setScreen('welcome');
              }}
            />
          )}
          {screen === 'watch' && (
            <WatchScreen
              source={selectedVideo?.source}
              seriesId={selectedSeries?.id}
              // 두 번째 영상일 때만 그림 안내를 띄운다. 묶음이 한 편뿐이면 안내 없이 넘어간다.
              onLast={dayIndex >= todayPick.length - 1}
              quizDone={quizDone}
              onQuizCorrect={() => {
                setQuizDone(true);
                setLog((prev) => ({ ...prev, quiz: Math.max(prev.quiz, 1) }));
                // Demo growth rule: three correct answers and the star becomes a friend.
                setQuizCorrectCount((n) => {
                  const next = n + 1;
                  // 진화 팝업은 시연 흐름을 끊어서 꺼 두었다. 되살리려면 이 줄의 주석을 푼다.
                  // if (next >= EVOLVE_AT && childProfile.level < 2) setEvolving(true);
                  return next;
                });
              }}
              onQuizSkip={() => setLog((prev) => ({ ...prev, skip: prev.skip + 1 }))}
              plan={plan}
              picks={picks}
              pool={quizPool}
              seekTo={seekTo}
              onResult={(activityId, result, kind) => {
                if (kind) setQuizHistory((prev) => [...prev.slice(-99), { kind, correct: result === 'correct' }]);
                if (!sessionId.current || !activityId) return;
                api('/activity-results', { method: 'POST', body: { session_id: sessionId.current, activity_id: activityId, result } });
              }}
              onWatched={(sec) => {
                setWatchedSec((prev) => prev + Math.max(0, sec));
                if (!sessionId.current) return;
                api(`/sessions/${sessionId.current}`, { method: 'PATCH', body: { watched_sec: sec } });
              }}
              onFinish={() => {
                // 묶음의 마지막 편을 본 뒤에 하루가 그림으로 닫힌다 — 편수는 묶음이 정한다.
                const next = todayPick[dayIndex + 1];
                if (next) {
                  setDayIndex(dayIndex + 1);
                  setSelectedVideo(next);
                  startWatching(next, dayIndex + 1);
                } else {
                  goDrawing();
                }
              }}
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
              onConvert={() => runGeneration(drawStrokes, drawCanvasSize, drawTopic, drawStyle)}
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
              onCharacter={() => { setSelectedSeries(null); setTab('character'); setScreen('home'); }}
              onFinish={() => setScreen('bye')}
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


const EVOLVE_AT = 3;


const styles = StyleSheet.create({
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
});
