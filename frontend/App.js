import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Image, Modal, Platform, ScrollView, StatusBar, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Text } from './Typography';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Skia } from '@shopify/react-native-skia';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { interpolate } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import getStroke from 'perfect-freehand';
import PuzzleScreen from './Puzzle';
import { playSound, speak, speakUrl, stopSpeaking } from './sound';
import { ageInMonths } from './age';
import { Quote } from './ui/Quote';
import { DrawingScreen, TraceOverlay, TraceWordOverlay } from './screens/Drawing';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from './theme';
import { DEMO_VIDEO, LIBRARY, SERIES_ART, THUMBS } from './data/library';
import { QUIZ_POOL } from './data/quiz-pool';
import { CenterPopup } from './ui/CenterPopup';
import { TabletHeader } from './ui/Header';
import { StaryLogo } from './ui/Logo';
import { GradientRim, ScreenFade, TapScale } from './ui/motion';
import { CharacterScreen, EvolvePopup } from './screens/Character';
import { ParentReportScreen } from './screens/ParentReport';
import { ChildProfileScreen, GuardianSetupScreen, OnboardIntroScreen } from './screens/Onboarding';
import { buttons } from './ui/buttons';
import { CARD_GAP, CARD_H, CARD_RADIUS, CARD_W, CardSheen, MainScreen, SeriesScreen, VideoDetailScreen } from './screens/Browse';
import { TABS } from './ui/Header';
import { ACT_MSG, OFFLINE_ACTIVITIES } from './data/activities';
import { QuizDebugScreen } from './screens/QuizDebug';
import { ReportScreen } from './screens/Report';
import { SettingsScreen } from './screens/Settings';
import ActivityStage from './activities/ActivityStage';
import IntroScreen from './Intro';
import * as ImagePicker from 'expo-image-picker';
import { DebugJump } from './ui/DebugJump';
import { GeneratedCharacter, PattiCharacter } from './ui/artwork';


// The content server runs beside the dev server, so its host is the one we are bundling from.
const CONTENT_PORT = 5056;
// Videos pushed to the app's own folder play without any storage permission, and without a server.
const LOCAL_VIDEO_DIR = 'file:///sdcard/Android/data/com.flyai.patti/files/video/';
const OFFLINE_LIBRARY = require('./assets/library.json');
// Frames grabbed at each puzzle's own timestamp, keyed by the name the activity payload carries.
const PUZZLE_IMAGES = {
  'teenieping-01-90': require('./assets/puzzles/teenieping-01-90.png'),
};
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
      color: v.color || art.color,
      still: base && v.thumbPath ? { uri: base + v.thumbPath } : null,
      // Local copy first: it plays with the laptop off, and never buffers over wifi.
      source: { uri: `${LOCAL_VIDEO_DIR}${v.id}.mp4` },
    })),
  };
}





const STAGE_KINDS = new Set(['findit', 'drag', 'count', 'say']);



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











































// Bars rise from this offset; the average line and its badge hang off the same base.




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
            <View style={[styles.wordDot, { backgroundColor: w.color || '#609EF5' }]} />
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





// Toss-style center popup with a spring pop-in. Self-animates on mount.
// 10 to 180 minutes. Too many values for a chip row, hence the scrolling picker below.
const LIMIT_ITEM_W = 88;









const EVOLVE_AT = 3;




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
















function ActivitiesScreen({ characterImage, onDrawing, onFinish }) {
  return (
    <View style={styles.activitiesScreen}>
      <View style={styles.activitiesFriend}>
        {characterImage ? <GeneratedCharacter uri={characterImage} size={170} /> : <PattiCharacter tone="blue" size={0.82} />}
        <Quote>다 봤다! 오늘 본 걸 그림으로 그려볼까?</Quote>
      </View>
      <View style={styles.wrapupActions}>
        <TouchableOpacity style={styles.drawCta} onPress={onDrawing}>
          <Text style={styles.drawCtaIcon}>✎</Text>
          <Text style={styles.drawCtaText}>그림 그리기</Text>
        </TouchableOpacity>
        <TouchableOpacity style={buttons.lightButton} onPress={onFinish}>
          <Text style={buttons.lightButtonText}>마무리</Text>
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
            <TouchableOpacity style={buttons.lightButton} onPress={onRetry}>
              <Text style={buttons.lightButtonText}>다시 고르기</Text>
            </TouchableOpacity>
          ) : selected ? (
            <TapScale style={buttons.darkButton} onPress={onSkip}>
              <Text style={buttons.darkButtonText}>영상 이어보기</Text>
            </TapScale>
          ) : null}
          {selected && correct ? (
            <TouchableOpacity style={buttons.darkButton} onPress={onResume}>
              <Text style={buttons.darkButtonText}>영상 이어보기</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
      </View>
    </Modal>
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
  screen: {
    flex: 1,
    padding: 40,
    backgroundColor: COLORS.stage,
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
  puzzleModal: {
    flex: 1,
    backgroundColor: '#ffffff',
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
    borderColor: '#609EF5',
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
    color: '#609EF5',
  },
  bottomActions: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  // Balances the star so the greeting itself stays screen-centred.
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

  // Sits behind the words, faded, so the card reads as a sentence with a picture rather than
  // an icon with a caption.
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
    backgroundColor: '#609EF5',
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
  tabPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
