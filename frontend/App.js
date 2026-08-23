import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, Platform, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './Typography';
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
import { ActivitiesScreen, QuizOverlay, WatchScreen } from './screens/Watch';
import { DrawingScreen } from './screens/Drawing';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from './theme';
import { DEMO_VIDEO, LIBRARY, SERIES_ART, THUMBS } from './data/library';
import { QUIZ_POOL } from './data/quiz-pool';
import { CenterPopup } from './ui/CenterPopup';
import { TabletHeader } from './ui/Header';
import { StaryLogo } from './ui/Logo';
import { ScreenFade, TapScale } from './ui/motion';
import { CharacterScreen, EvolvePopup } from './screens/Character';
import { ParentReportScreen } from './screens/ParentReport';
import { ChildProfileScreen, GuardianSetupScreen, OnboardIntroScreen } from './screens/Onboarding';
import { buttons } from './ui/buttons';
import { CARD_GAP, CARD_H, CARD_RADIUS, CARD_W, CardSheen, MainScreen, SeriesScreen, VideoDetailScreen } from './screens/Browse';
import { TABS } from './ui/Header';
import { OFFLINE_ACTIVITIES } from './data/activities';
import { QuizDebugScreen } from './screens/QuizDebug';
import { ReportScreen } from './screens/Report';
import { SettingsScreen } from './screens/Settings';
import ActivityStage from './activities/ActivityStage';
import IntroScreen from './Intro';
import * as ImagePicker from 'expo-image-picker';
import { DebugJump } from './ui/DebugJump';
import { PattiCharacter } from './ui/artwork';


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






// Toss-style center popup with a spring pop-in. Self-animates on mount.
// 10 to 180 minutes. Too many values for a chip row, hence the scrolling picker below.
const LIMIT_ITEM_W = 88;









const EVOLVE_AT = 3;





































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
