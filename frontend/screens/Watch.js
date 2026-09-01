// The video itself, the question that interrupts it, and the hand-off to drawing afterwards.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Text } from '../Typography';
import { VideoView, useVideoPlayer } from 'expo-video';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { playSound, speak, speakUrl, stopSpeaking } from '../sound';
import { sayLine } from '../activities/voice';
import { ACT_MSG } from '../data/activities';
import { SERIES_ART, voiceFor } from '../data/library';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { buttons } from '../ui/buttons';
import { CenterPopup } from '../ui/CenterPopup';
import { StaryLogo } from '../ui/Logo';
import { Quote } from '../ui/Quote';
import { GeneratedCharacter, PattiCharacter } from '../ui/artwork';
import { GradientRim, TapScale } from '../ui/motion';
import { TabletHeader } from '../ui/Header';
import { QUIZ_POOL } from '../data/quiz-pool';
import { TraceOverlay, TraceWordOverlay } from './Drawing';
import ActivityStage from '../activities/ActivityStage';
import PuzzleScreen from '../Puzzle';
import WheelFit from '../activities/WheelFit';
import { WHEEL_FRAMES } from '../data/wheels';

// Demo stand-in for the pre-generated content schedule. Later: load per video_id from the
// analysis pipeline's activities.json — same shape { at: seconds, type }.

const STAGE_KINDS = new Set(['findit', 'drag', 'count', 'say']);
// 보기를 고르는 대신 손으로 하는 것들. 영상 끝 줄에서 문항과 나란히 선다.
const HAND_KINDS = new Set(['wheels']);

// Frames grabbed at each puzzle's own timestamp, keyed by the name the activity payload carries.
const PUZZLE_IMAGES = {
  'teenieping-01-90': require('../assets/puzzles/teenieping-01-90.png'),
};

// 문항 옆에 서는 친구. 아이가 방금 보던 시리즈의 주인공이 나오고, 모르는 시리즈면 토끼가 선다.
const QUIZ_BUDDY = require('../assets/characters/bunny.png');
const buddyFor = (seriesId) => SERIES_ART[seriesId]?.thumb || QUIZ_BUDDY;

// How long the character stands alone before the bubble and its voice arrive.
const BUDDY_ALONE_MS = 700;

export function WatchScreen({ source, seriesId, onLast, plan = [], picks = [0, 1, 2], pool = QUIZ_POOL, seekTo, onResult, onWatched, quizDone, onQuizCorrect, onQuizSkip, onFinish, onBack, onHome, onReport }) {
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.play();
  });
  const [selected, setSelected] = useState(null);
  // The four participation activities live in their own stage; quiz and puzzle keep their old path.
  const [stageActivity, setStageActivity] = useState(null);
  const [answered, setAnswered] = useState(quizDone);
  // What the buddy said about the answer, so the words on screen are the words that were spoken.
  const [reaction, setReaction] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [active, setActive] = useState(null); // current activity type: 'quiz' | 'puzzle' | null
  const [quizIndex, setQuizIndex] = useState(0);
  const [serverQuiz, setServerQuiz] = useState(null);
  const [tries, setTries] = useState(0);
  const [puzzleImage, setPuzzleImage] = useState(null);
  // 바퀴 끼우기가 쓸 사진과 구멍 좌표.
  const [wheels, setWheels] = useState(null);
  // 영상 카드가 화면 어디에 얼마만 한 크기로 앉았는지. 퍼즐 판을 그 자리에 그대로 얹는다.
  const cardRef = useRef(null);
  const [cardBox, setCardBox] = useState(null);
  // 칸의 자리는 퍼즐이 뜨는 순간에 잰다. 화면에 들어올 때 재면 레이아웃이 아직 앉지 않아
  // 어긋난 값이 남고, 판이 그만큼 삐져나온다.
  useEffect(() => {
    if (active !== 'wheels') return;
    requestAnimationFrame(() => {
      cardRef.current?.measureInWindow((x, y, w, h) => {
        if (w && h) setCardBox({ x, y, w, h });
      });
    });
  }, [active]);
  const quiz = serverQuiz || pool[quizIndex] || QUIZ_POOL[0];
  const activityId = useRef(null);
  const followUp = useRef(null);
  // A break can hold more than one question: the second waits here while the first is answered.
  const nextQuiz = useRef(null);
  // Server plan wins; the built-in schedule is the demo fallback.
  // 영상이 끝난 뒤에 내는 문항. at 이 없는 항목이 여기로 온다.
  const endQueue = useMemo(
    () => plan
      .map((a) => {
        let payload = {};
        try { payload = typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {}; }
        catch (e) { payload = {}; }
        return { ...a, payload };
      })
      // 영상 끝에 낼 것들: 보기가 달린 문항, 그리고 손으로 하는 활동.
      .filter((a) => a.at_sec == null && a.at == null
        && (Array.isArray(a.payload.options) || HAND_KINDS.has(a.type)))
      .map((a) => (HAND_KINDS.has(a.type)
        ? { type: a.type, payload: a.payload, activityId: a.id }
        : { ...a.payload, kind: a.payload.activity_template, activityId: a.id })),
    [plan]
  );
  const pending = useRef([]);
  const finishing = useRef(false);
  // 문항은 서버에서 늦게 온다. 리스너는 한 번만 등록되므로 최신 목록을 여기로 흘려 둔다 —
  // 이걸 안 하면 리스너가 등록 시점의 빈 목록을 계속 붙잡고 있어 영상이 그냥 끝나 버린다.
  const endRef = useRef([]);
  useEffect(() => { endRef.current = endQueue; }, [endQueue]);

  const schedule = useMemo(() => {
    // 계획이 비어 있으면 이 영상에는 물을 것이 없다는 뜻이다. 예전에는 데모 시간표로
    // 떨어졌는데, 그러면 두 번째 영상이 시작하자마자 엉뚱한 문항이 떴다.
    if (!plan.length) return [];
    return plan.filter((a) => (a.at_sec ?? a.at) != null).map((a) => {
      let payload = {};
      try {
        payload = typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload || {};
      } catch (e) {
        payload = {};
      }
      return { at: a.at_sec ?? a.at, type: a.type, activityId: a.id, payload, next: a.next || null };
    });
  }, [plan, picks]);
  const [announce, setAnnounce] = useState(null); // activity type being announced before it opens
  const [celebrate, setCelebrate] = useState(false);
  const [ended, setEnded] = useState(false); // 영상이 끝난 뒤 — 재생면을 내린다
  // 다음 편이 들어오면 재생면을 다시 올린다 — 지난 편이 끝났다는 표시가 남으면 새 영상이 보이지 않는다.
  useEffect(() => { setEnded(false); }, [source]);
  // 하루의 마지막 문항을 푼 뒤, 그림으로 넘어간다는 인사를 잠깐 띄운다.
  const [toDraw, setToDraw] = useState(false);
  // 이어보기를 누른 뒤 잠깐 뜨는 인사. 화면이 뚝 끊기지 않게 한 박자 둔다.
  const [toResume, setToResume] = useState(false); // "잘했어요" popup between an activity and resuming the video
  const firedRef = useRef(new Set());

  // 이어보기 인사를 보여 준 뒤 실제로 재생을 잇는다.
  useEffect(() => {
    if (!toResume) return undefined;
    // 인사말이 끝나기 전에 화면을 넘기면 소리가 잘린다. 녹음 길이만큼 머무른다.
    speak('resume');
    const id = setTimeout(() => { setToResume(false); resume(); }, 2600);
    return () => clearTimeout(id);
  }, [toResume]);

  // 인사를 잠깐 보여 주고 그림 화면으로 넘긴다.
  useEffect(() => {
    if (!toDraw) return undefined;
    const id = setTimeout(() => { setToDraw(false); onFinish(); }, 2200);
    return () => clearTimeout(id);
  }, [toDraw]);

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
            nextQuiz.current = a.next || null;
            setQuizIndex(a.quiz || 0);
          }
          if (STAGE_KINDS.has(a.type)) setStageActivity({ type: a.type, payload: a.payload || {} });
          // 영상이 이 프레임에서 멈추고 그 화면이 그대로 판이 된다.
          if (HAND_KINDS.has(a.type)) setWheels(WHEEL_FRAMES[a.payload?.frame] || null);
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
      // 문항은 영상을 다 본 뒤에 낸다. 남은 것이 있으면 먼저 풀고 나서 다음으로 넘어간다.
      const queue = endRef.current;
      if (queue.length) {
        // 다 본 재생면은 검게 남고 정지 버튼이 뜬다. 문항으로 넘어가기 전에 그 면을 내린다.
        setEnded(true);
        pending.current = queue.slice(1);
        finishing.current = true;
        openEndItem(queue[0]);
        return;
      }
      onFinish();
    });
    return () => sub.remove();
  }, [player]);

  // 영상이 끝난 뒤 줄에 선 항목 하나를 연다. 문항이면 문항으로, 손으로 하는 활동이면 그 활동으로.
  const openEndItem = (item, { quiet = false } = {}) => {
    setSelected(null);
    activityId.current = item.activityId || null;
    if (item.type === 'wheels') {
      setWheels(WHEEL_FRAMES[item.payload?.frame] || null);
      setAnnounce('wheels');
      return;
    }
    setServerQuiz(item);
    // 같은 쉬는 시간의 두 번째 문항부터는 인사를 건너뛴다 — 방금 한 말을 또 하면 소음이다.
    if (quiet) { setActive('quiz'); return; }
    setAnnounce('quiz');
  };

  // Some slots chain: the question is answered first, then its answer word is traced.
  const resume = () => {
    // 영상이 끝난 뒤의 줄: 남은 문항을 차례로 내고, 다 풀면 다음 화면으로 넘어간다.
    if (finishing.current) {
      const [head, ...rest] = pending.current;
      pending.current = rest;
      if (head) {
        setTries(0);
        setReaction('');
        openEndItem(head, { quiet: true });
        return;
      }
      finishing.current = false;
      setActive(null);
      // 마지막 영상이면 그림으로 넘어간다고 먼저 알려 준다 — 화면이 갑자기 바뀌지 않게.
      if (onLast) {
        setToDraw(true);
        return;
      }
      onFinish();
      return;
    }
    // Another question in the same break: swap it in without letting the video back through.
    if (nextQuiz.current) {
      const q = nextQuiz.current;
      nextQuiz.current = null;
      setServerQuiz(q);
      setSelected(null);
      setTries(0);
      setReaction('');
      setActive('quiz');
      return;
    }
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
      setReaction(sayLine(voiceFor(seriesId), 'answer.right') || '');
      onQuizCorrect();
    } else {
      playSound('wrong');
      setReaction(sayLine(voiceFor(seriesId), 'answer.again') || '');
      // 아이가 버튼을 찾아 누르게 하지 않는다 — 한 박자 뒤 문제로 되돌아온다.
      if (tries < 1) setTimeout(() => { setSelected(null); setReaction(''); }, 1000);
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
      <View style={[styles.videoCard, ended && styles.videoCardDone]}>
        {/* 영상이 끝나면 칸의 테두리도 걷는다 — 문항만 남아야 재생면이 아직 있는 것처럼 보이지 않는다. */}
        {ended ? null : <GradientRim radius={34} width={7} />}
        {/* 영상이 앉는 칸. 퍼즐 판은 이 칸에 겹쳐야 화면이 언 것처럼 보인다. */}
        <View ref={cardRef} style={[styles.video, ended && styles.videoDone]}>
          {active !== 'puzzle' && !ended ? (
            // 멈춰 세운 자리에서는 재생 버튼을 감춘다 — 아이가 문항 위에서 그걸 먼저 누른다.
            <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={!active && !announce && countdown == null} contentFit="contain" surfaceType="textureView" />
          ) : null}
        </View>
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
        {announce ? (
          <CenterPopup text={ACT_MSG[announce].text} emoji={ACT_MSG[announce].emoji} buddy={buddyFor(seriesId)} />
        ) : null}
        {active === 'quiz' ? (
          <QuizOverlay
            selected={selected}
            reaction={reaction}
            seriesId={seriesId}
            standalone={finishing.current}
            quiz={quiz}
            tries={tries}
            onAnswer={handleAnswer}
            onRetry={() => setSelected(null)}
            onResume={() => {
              // 아직 낼 문항이 남았으면 인사 없이 바로 다음 문항으로.
              const more = nextQuiz.current || pending.current.length;
              if (more || (finishing.current && onLast)) resume();
              else setToResume(true);
            }}
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
          voice={voiceFor(seriesId)}
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
      {active === 'wheels' && wheels && cardBox ? (
        <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => { setActive(null); resume(); }}>
          <View style={[styles.freeze, { left: cardBox.x, top: cardBox.y, width: cardBox.w, height: cardBox.h }]}>
            <WheelFit
              inline
              image={wheels.image}
              holes={wheels.holes}
              reserveDock={wheels.reserveDock}
              buddy={buddyFor(seriesId)}
              onDone={() => { setActive(null); resume(); }}
            />
          </View>
        </Modal>
      ) : null}
      {celebrate ? <CenterPopup text="잘했어요! 🎉" emoji="🎉" buddy={buddyFor(seriesId)} /> : null}
      {toDraw ? <CenterPopup text="오늘 본 걸 그림으로 그려볼까?" buddy={buddyFor(seriesId)} solid /> : null}
      {toResume ? <CenterPopup text="그럼 이어서 볼까?" buddy={buddyFor(seriesId)} /> : null}
    </View>
  );
}

export function QuizOverlay({ quiz, selected, reaction, seriesId, standalone, tries = 0, onAnswer, onRetry, onResume, onSkip }) {
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
  // 말풍선 테두리는 그라데이션이라 직접 그린다 — 잘리지 않게 실제 크기를 재둔다.
  const [qBox, setQBox] = useState({ width: 0, height: 0 });

  // The buddy arrives alone first; the bubble and its voice land together a beat later, so the
  // child looks at the character before any words appear.
  const bubble = useRef(new Animated.Value(0)).current;
  const buddyIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(buddyIn, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.spring(bubble, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
      // Question audio is authored with the question, so playback is a single URL away.
      if (quiz.audioUrl) speakUrl(quiz.audioUrl);
    }, BUDDY_ALONE_MS);
    return () => { clearTimeout(t); stopSpeaking(); };
  }, []);

  useEffect(() => {
    // The card follows the bubble, so the choices are the last thing to appear.
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 80, delay: BUDDY_ALONE_MS, useNativeDriver: true }).start();
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
      <View style={[styles.quizOverlay, standalone && styles.quizPage, { width: win.width, height: win.height }]}>
        {standalone ? (
          <View style={styles.quizPageLogo} pointerEvents="none"><StaryLogo size={30} /></View>
        ) : (
          <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        )}
        {/* 정답 시 캐릭터 등장 자리 (popScale 애니메이션 재사용) */}
        <Animated.View
          onLayout={(e) => setCardBox(e.nativeEvent.layout)}
          style={[styles.quizCard, standalone && styles.quizCardWide, { opacity: enter, transform: [{ translateX: shakeX }, { scale: enterScale }] }]}
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
        <View style={styles.quizPromptRow}>
          <Animated.Image
            source={buddyFor(seriesId)}
            style={[
              styles.quizBuddy,
              {
                opacity: buddyIn,
                transform: [{ scale: buddyIn.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
              },
            ]}
            resizeMode="contain"
          />
          <Animated.View
            onLayout={(e) => setQBox(e.nativeEvent.layout)}
            style={[
              styles.questionBox,
              {
                opacity: bubble,
                transform: [
                  { scale: bubble.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
                  { translateX: bubble.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
                ],
              },
            ]}
          >
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="qRim" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#609EF5" />
                  <Stop offset="1" stopColor="#1b3a7a" />
                </LinearGradient>
              </Defs>
              {/* 획을 가장자리에 그리면 바깥 절반이 잘린다. 절반만큼 안으로 들여 그린다. */}
              {qBox.width ? (
                <Rect
                  x={2}
                  y={2}
                  width={qBox.width - 4}
                  height={qBox.height - 4}
                  rx={(qBox.height - 4) / 2}
                  fill="none"
                  stroke="url(#qRim)"
                  strokeWidth={4}
                />
              ) : null}
            </Svg>
            <Text style={styles.questionText}>
              {selected && correct
                ? reaction || '맞아 정답이야! 잘했어'
                : selected && tries >= 2
                ? `정답은 '${quiz.answer}' 였어!`
                : selected
                ? reaction || '다시 해볼까?'
                : quiz.title}
            </Text>
          </Animated.View>
        </View>
        {/* 문항이 "이 그림에서…" 라고 묻는다. 그 그림이 없으면 아이가 풀 수 없다. */}
        {quiz.frameUri ? (
          <Image
            source={{ uri: quiz.frameUri }}
            style={[styles.quizFrame, standalone && styles.quizFrameWide]}
            resizeMode="cover"
          />
        ) : null}
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
        {/* The way out sits under the choices: smaller and grey, so it never reads as an answer. */}
        {selected ? null : (
          <TouchableOpacity style={[styles.quizOption, styles.dunnoBtn]} onPress={onSkip}>
            <Text style={[styles.quizOptionText, styles.dunnoText]}>모르겠어요</Text>
          </TouchableOpacity>
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

export function ActivitiesScreen({ characterImage, onDrawing, onFinish }) {
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

const styles = StyleSheet.create({
  // 얼어붙은 화면. 영상 카드를 그대로 덮어 판이 영상과 같은 자리에 온다.
  // 얼어붙은 화면. 영상 카드 안에 넣으면 안드로이드에서 그려지지 않아 화면 위로 올렸고,
  // 카드와 같은 자리에 판이 오도록 카드가 쓰는 여백(36 + 7)만큼 물려 둔다.
  // 얼어붙은 화면. 자리와 크기는 영상 카드를 재서 그대로 받는다(카드 안쪽 여백 7 제외).
  freeze: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 27,
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
  videoDone: { backgroundColor: COLORS.stage },
  videoCardDone: { backgroundColor: COLORS.stage, shadowOpacity: 0, elevation: 0 },
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
  // 영상이 끝난 뒤의 문항 화면. 뒤에 아무것도 없으므로 배경을 직접 칠한다.
  quizPage: {
    backgroundColor: COLORS.stage,
    padding: 20,
  },
  quizPageLogo: {
    position: 'absolute',
    top: 26,
    left: 34,
  },
  quizCardWide: {
    // 가릴 영상이 없으니 카드를 넓게 쓴다.
    width: '86%',
    maxWidth: 980,
    paddingTop: 66,
    paddingBottom: 28,
    paddingHorizontal: 44,
  },
  quizCard: {
    maxWidth: '90%',
    // Bubble overlaps the card's top edge, so the card starts below it.
    marginTop: 40,
    paddingTop: 58,
    paddingBottom: 22,
    paddingHorizontal: 34,
    borderRadius: 34,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  dunnoBtn: {
    // Hangs below the card, clear of the choices inside it.
    position: 'absolute',
    bottom: -53,
    alignSelf: 'center',
    // Smaller than a real choice, so it reads as the way out rather than an answer.
    minWidth: 104,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#c3ccdb',
    backgroundColor: '#eef2f8',
    zIndex: 4,
  },
  dunnoText: {
    fontSize: 14,
    color: '#8a97b1',
  },
  quizPromptRow: {
    position: 'absolute',
    // Sits lower, close enough to the card that the pair reads as one block.
    top: -52,
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
    // Overlaps the bubble's left edge so buddy and bubble touch.
    marginRight: -40,
    marginBottom: 20,
    zIndex: 4,
  },
  questionBox: {
    minWidth: 460,
    minHeight: 84,
    // Even padding on both sides, so the words land in the middle of the bubble.
    paddingLeft: 58,
    paddingRight: 58,
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
  quizFrame: {
    alignSelf: 'center',
    width: 360,
    height: 202,
    marginTop: 24,
    // 그림이 있는 문항에서만 보기가 위로 붙는다 — 글자만 있는 문항은 그대로.
    marginBottom: -12,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: '#BADAFF',
    backgroundColor: '#dbe8fb',
  },
  quizFrameWide: {
    width: 520,
    height: 292,
  },
  quizOptions: {
    marginTop: 40,
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
    // 긴 정답도 테두리에 닿지 않게 — 높이를 고정하지 않고 여백으로 벌린다.
    minHeight: 58,
    paddingHorizontal: 34,
    paddingVertical: 12,
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
    // 카드 밖 아래에 걸린다 — '모르겠어요'와 같은 자리라 문항이 끝나면 자연스럽게 바뀐다.
    position: 'absolute',
    bottom: -76,
    alignSelf: 'center',
    marginTop: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
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
});
