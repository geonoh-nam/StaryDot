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
import { DEMO_VIDEO, LIBRARY, SERIES_ART } from './data/library';
import { QUIZ_POOL } from './data/quiz-pool';
import { CenterPopup } from './ui/CenterPopup';
import { TabletHeader } from './ui/Header';
import { StaryLogo } from './ui/Logo';
import { ScreenFade } from './ui/motion';
import { EvolvePopup } from './screens/Character';
import { ChildProfileScreen, GuardianSetupScreen } from './screens/Onboarding';
import { OnboardSlides } from './screens/OnboardSlides';
import { LoadingScreen } from './screens/Loading';
import { PackageScreen } from './screens/Package';
import { ByeScreen } from './screens/Bye';
import { buttons } from './ui/buttons';
import { MainScreen, VideoDetailScreen } from './screens/Browse';
import { OFFLINE_ACTIVITIES } from './data/activities';
import { ReportScreen } from './screens/Report';
import { BreakScreen } from './screens/Break';
import { MissionScreen } from './screens/Mission';
import ActivityStage from './activities/ActivityStage';
import IntroScreen from './Intro';
import * as ImagePicker from 'expo-image-picker';


// The content server runs beside the dev server, so its host is the one we are bundling from.
const CONTENT_PORT = 5056;
// Videos pushed to the app's own folder play without any storage permission, and without a server.
const LOCAL_VIDEO_DIR = 'file:///sdcard/Android/data/com.flyai.patti/files/video/';
const OFFLINE_LIBRARY = require('./assets/library.json');
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


// One planned video → the episode shape the screens already expect. Same fields toSeries makes,
// so Package and Watch need no idea that a planner picked this one.
function toEpisode(item, base) {
  return {
    id: item.id,
    title: item.title,
    duration: mmss(item.durationSec),
    color: item.color || COLORS.blue,
    still: base && item.thumbPath ? { uri: base + item.thumbPath } : null,
    source: base && item.videoPath ? { uri: base + item.videoPath } : { uri: `${LOCAL_VIDEO_DIR}${item.id}.mp4` },
  };
}


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
      // Streamed from the content server. The tablet keeps no copy — a build is not a video store.
      source: base && v.videoPath ? { uri: base + v.videoPath } : { uri: `${LOCAL_VIDEO_DIR}${v.id}.mp4` },
    })),
  };
}


// Demo questions until the pipeline fills the activity table: one per template, so the variety
// the pipeline will produce is visible today. Keys match oneshot/schemas.py.


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

  // 시리즈를 고른 순간 오늘 한 회분을 편성한다. 로딩 화면이 도는 동안 돌아온다.
  //
  // 예산은 보호자가 정한 하루 총량이다. 영상 길이와 브레이크·미션까지 다 합쳐 그 안에
  // 들어가는 조합을 서버가 고른다.
  const requestPlan = (seriesId) => {
    setSessionPlan(null);
    setPlanCursor(0);
    if (!seriesId) return;
    const budgetSec = Math.max(120, (guardianSettings.dailyLimit || 30) * 60);
    const q = `character_id=${encodeURIComponent(seriesId)}&budget_sec=${budgetSec}` +
              (childId ? `&child_id=${encodeURIComponent(childId)}` : '');
    api(`/plan?${q}`).then((res) => {
      if (res?.ok && res.plan?.items?.length) setSessionPlan(res.plan);
    });
  };

  // dev 전용: 영상을 다 보지 않고 브레이크 화면만 연다. 편성은 서버에서 그대로 받아오므로
  // 화면에 뜨는 문항은 파이프라인이 심은 그 문항이다 — 가짜 데이터를 끼우지 않는다.
  // 작품 칩마다 그 작품의 편성을 받아 첫 브레이크를 연다.
  const jumpToBreak = async (id) => {
    if (!id) return;
    const res = await api(`/plan?character_id=${id}&budget_sec=1800`);
    const i = res?.plan?.items?.findIndex((it) => it.kind === 'quiz') ?? -1;
    if (i < 0) return;
    setSessionPlan(res.plan);
    setPlanCursor(i);
    setScreen('break');
  };

  // 편성의 i 번째 항목을 연다. 영상이면 재생, 퀴즈면 브레이크, 미션이면 마무리 카드.
  // 끝까지 가면 작별 화면 — 세션이 닫히는 자리는 여기 하나뿐이다.
  const openPlanItem = (i) => {
    const item = sessionPlan?.items?.[i];
    setPlanCursor(i);
    if (!item) { setScreen('bye'); return; }
    if (item.kind === 'video') {
      const ep = toEpisode(item, contentBase());
      setSelectedVideo(ep);
      startWatching(ep, { planned: true });
      return;
    }
    setScreen(item.kind === 'quiz' ? 'break' : 'mission');
  };

  const advancePlan = () => {
    if (!sessionPlan) { setScreen('activities'); return; } // 편성 없이 한 편만 본 경우
    openPlanItem(planCursor + 1);
  };

  // 활동 결과 한 건. 영상 중이든 브레이크든 기록하는 자리는 하나여야 리포트가 어긋나지 않는다.
  const recordResult = (activityId, result, kind, latencyMs) => {
    if (kind) setQuizHistory((prev) => [...prev.slice(-99), { kind, correct: result === 'correct' }]);
    if (result === 'correct') setLog((prev) => ({ ...prev, quiz: prev.quiz + 1 }));
    if (result === 'skip') setLog((prev) => ({ ...prev, skip: prev.skip + 1 }));
    if (!sessionId.current || !activityId) return;
    api('/activity-results', { method: 'POST', body: { session_id: sessionId.current,
        activity_id: activityId, result, latency_ms: latencyMs ?? null } });
  };

  // Opening a video: ask the server for its activity plan and open a session to record against.
  // planned=true 면 영상 중간 활동을 붙이지 않는다 — 편성에서는 퀴즈가 영상 사이에만 온다.
  const startWatching = (video, { planned = false } = {}) => {
    // 편성 밖에서 한 편만 고른 경우(검색·바로가기)에는 지난 편성을 버린다. 남겨 두면 그 영상이
    // 끝났을 때 예전 편성의 다음 항목으로 넘어간다.
    if (!planned) setSessionPlan(null);
    setPicks(pickQuizzes(quizHistory, 3));
    setPlan([]);
    sessionId.current = null;
    if (video?.id) {
      // 서버 문항은 편성이든 아니든 항상 받는다 — 파이프라인이 계산한 개입지점이
      // 거기 실려 온다. 예전에는 planned 일 때 이 호출을 건너뛰어서, 편성으로 보면
      // 개입지점 문항이 하나도 안 뜨고 영상만 끝까지 재생됐다.
      // 오프라인 번들은 편성 밖에서만 쓴다(서버가 꺼져 있을 때의 대비).
      const bundled = planned ? [] : (OFFLINE_ACTIVITIES[video.id] || []);
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
  // 오늘 한 회분의 편성. 서버가 없거나 편성이 안 되면 null 이고, 그때는 예전처럼 한 편만 튼다 —
  // 편성이 실패했다고 아이가 아무것도 못 보게 두지 않는다.
  const [sessionPlan, setSessionPlan] = useState(null);
  const [planCursor, setPlanCursor] = useState(0);
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
    // The slides open every launch; where their button leads is what the saved profile decides.
    setScreen('welcome');
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
      loading: 'main',
      package: 'main',
      detail: 'main',
      watch: 'main',
      break: 'main',
      mission: 'main',
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

  // 오늘 볼 목록. 편성이 돌아왔으면 그것이 답이고, 아니면 아래 임시 고르기로 내려간다.
  const planVideos = useMemo(() => {
    if (!sessionPlan) return null;
    const base = contentBase();
    return sessionPlan.items.filter((i) => i.kind === 'video').map((i) => toEpisode(i, base));
  }, [sessionPlan]);

  // 편성이 없을 때의 임시 고르기 — 서버가 꺼져 있어도 아이가 볼 것이 있어야 한다.
  //
  // 고른 시리즈를 먼저 본다. 예전에는 "에피소드가 가장 많은 시리즈"만 봐서,
  // 편성 응답이 늦으면 아이가 아기상어를 골라도 타요(유일한 2편짜리)가 떴다.
  // 아무것도 안 나오는 것보다 나쁘다 — 고른 것과 다른 게 나오면 앱이 고장 난 것으로 보인다.
  const fallbackPick = useMemo(() => {
    const picked = selectedSeries && series.find((s) => s.id === selectedSeries.id);
    const richest = picked
      || [...series].sort((a, b) => (b.episodes?.length || 0) - (a.episodes?.length || 0))[0];
    const pool = [...(richest?.episodes || [])];
    const out = [];
    while (pool.length && out.length < 3) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }, [series, selectedSeries]);

  const todayPick = planVideos || fallbackPick;

  const report = useMemo(
    () => ({
      quiz: log.quiz,
      drawing: log.drawing,
      skip: log.skip,
      watched: selectedVideo?.title || DEMO_VIDEO.title,
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
          {screen !== 'intro' && screen !== 'welcome' && screen !== 'profile' && screen !== 'guardian' && screen !== 'main' && screen !== 'bye' && (
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
          {screen === 'loading' && (
            <LoadingScreen
              profile={childProfile}
              onStart={() => setScreen('package')}
              onBack={() => setScreen('main')}
            />
          )}
          {screen === 'bye' && <ByeScreen profile={childProfile} onUnlock={() => setScreen('main')} />}
          {screen === 'package' && (
            <PackageScreen
              profile={childProfile}
              videos={todayPick}
              onBack={() => setScreen('main')}
              onStart={() => {
                if (sessionPlan) { openPlanItem(0); return; }
                const first = todayPick[0];
                // planned:true 를 빠뜨리면 startWatching 이 방금 받은 편성을 지운다.
                // 그러면 1화가 끝났을 때 sessionPlan 이 없어 브레이크·2화·미션을
                // 건너뛰고 마무리 활동으로 직행한다.
                if (first) { setSelectedVideo(first); startWatching(first, { planned: true }); }
              }}
            />
          )}
          {screen === 'welcome' && <OnboardSlides onNext={() => { playSound('main'); setScreen(onboarded ? 'main' : 'profile'); }} />}
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
              onStart={(v) => { setSelectedSeries(v || null); requestPlan(v?.id); setScreen('loading'); }}
              // A search hit is one episode, so it goes straight to its own screen.
              onOpenVideo={(v) => { setSelectedSeries(null); setSelectedVideo(v); setScreen('detail'); }}
              onMenu={(key) => { setSelectedSeries(null); setTab(key); setScreen('home'); }}
              onJump={(key) => {
                if (key.startsWith('break:')) { jumpToBreak(key.slice(6)); return; }
                if (key === 'detail' || key === 'watch') setSelectedVideo(series[0]?.episodes?.[0] || LIBRARY[1].videos[0]);
                setScreen(key);
              }}
              contentUp={contentUp}
              breaks={series.map((x) => ({ id: x.id, title: x.title })).filter((x) => x.id)}
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
          {screen === 'home' && (
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
              onWipe={() => {
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
              onStart={(v) => { setSelectedVideo(v || null); startWatching(v); }}
            />
          )}
          {screen === 'detail' && selectedVideo && (
            <VideoDetailScreen
              video={selectedVideo}
              series={selectedSeries}
              // Back where it came from: the series it belongs to, or the main screen if a search
              // opened it directly.
              onClose={() => setScreen(selectedSeries ? 'home' : 'main')}
              onStart={() => startWatching(selectedVideo)}
            />
          )}
          {screen === 'watch' && (
            <WatchScreen
              key={selectedVideo?.id || 'demo'}
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
              midVideo
              picks={picks}
              seekTo={seekTo}
              onResult={recordResult}
              onWatched={(sec) => {
                if (!sessionId.current) return;
                api(`/sessions/${sessionId.current}`, { method: 'PATCH', body: { watched_sec: sec } });
              }}
              onFinish={advancePlan}
              onBack={() => setScreen('home')}
              onHome={() => setScreen('main')}
              onReport={() => setScreen('report')}
            />
          )}
          {/* 영상 사이 브레이크. 방금 본 영상의 마무리 문항을 그 장면과 함께 낸다. */}
          {screen === 'break' && sessionPlan?.items?.[planCursor]?.kind === 'quiz' && (
            <BreakScreen
              items={sessionPlan.items[planCursor].items}
              mediaBase={contentBase()}
              isLast={!sessionPlan.items.slice(planCursor + 1).some((i) => i.kind === 'video')}
              onResult={recordResult}
              onDone={advancePlan}
            />
          )}
          {/* 세션의 착지점. 화면 밖에서 할 일 하나를 주고 끝낸다. */}
          {screen === 'mission' && sessionPlan?.items?.[planCursor]?.kind === 'mission' && (
            <MissionScreen
              mission={sessionPlan.items[planCursor].mission}
              onDone={() => setScreen('bye')}
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
