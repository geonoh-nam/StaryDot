// The video itself, the question that interrupts it, and the hand-off to drawing afterwards.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Text } from '../Typography';
import { VideoView, useVideoPlayer } from 'expo-video';
import { BlurView } from 'expo-blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { playSound, speak, speakUrl, stopSpeaking } from '../sound';
import { ACT_MSG } from '../data/activities';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { buttons } from '../ui/buttons';
import { CenterPopup } from '../ui/CenterPopup';
import { Quote } from '../ui/Quote';
import { GeneratedCharacter, PattiCharacter } from '../ui/artwork';
import { GradientRim, TapScale } from '../ui/motion';
import { TabletHeader } from '../ui/Header';
import { QUIZ_POOL } from '../data/quiz-pool';
import { TraceOverlay, TraceWordOverlay } from './Drawing';
import ActivityStage from '../activities/ActivityStage';
import PuzzleScreen from '../Puzzle';

// Demo stand-in for the pre-generated content schedule. Later: load per video_id from the
// analysis pipeline's activities.json — same shape { at: seconds, type }.
const ACTIVITY_SLOTS = [
  { at: 10, type: 'quiz', pick: 0 },
  { at: 20, type: 'quiz', pick: 1, then: 'traceword' },
  { at: 30, type: 'puzzle' },
  { at: 40, type: 'quiz', pick: 2 },
];

const STAGE_KINDS = new Set(['findit', 'drag', 'count', 'say']);

// Frames grabbed at each puzzle's own timestamp, keyed by the name the activity payload carries.
const PUZZLE_IMAGES = {
  'teenieping-01-90': require('../assets/puzzles/teenieping-01-90.png'),
};

const QUIZ_BUDDY = require('../assets/characters/bunny.png');

// How long the character stands alone before the bubble and its voice arrive.
const BUDDY_ALONE_MS = 700;

export function WatchScreen({ source, plan = [], midVideo = true, picks = [0, 1, 2], seekTo, onResult, onWatched, quizDone, onQuizAsk, onQuizCorrect, onQuizSkip, onFinish, onBack, onHome, onReport }) {
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
    // 세션 편성에서는 퀴즈가 영상 사이에만 붙는다. 중간 개입을 끄면 데모 일정도 같이 꺼야
    // 한다 — 안 그러면 10초·20초마다 데모 문항이 튀어나온다.
    if (!midVideo) return [];
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
  }, [plan, picks, midVideo]);
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

// `frame` 은 문항이 근거로 삼은 화면이다. storydot 의 마무리 문항은 회상이 아니라 재인을
// 묻는다 — "이 그림에 버스가 몇 대 있나요?"는 그림이 같이 떠야 성립한다. 그림이 없는
// 문항(대사 기반)은 frame 을 주지 않으면 예전 그대로 그려진다.
export function QuizOverlay({ quiz, selected, tries = 0, frame, resumeLabel = '영상 이어보기', onAnswer, onRetry, onResume, onSkip }) {
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
      <View style={[styles.quizOverlay, { width: win.width, height: win.height }]}>
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
        <View style={styles.quizPromptRow}>
          <Animated.Image
            source={QUIZ_BUDDY}
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
          </Animated.View>
        </View>
        {frame ? (
          <Image source={frame} style={styles.quizFrame} resizeMode="contain" />
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
              <Text style={buttons.darkButtonText}>{resumeLabel}</Text>
            </TapScale>
          ) : null}
          {selected && correct ? (
            <TouchableOpacity style={buttons.darkButton} onPress={onResume}>
              <Text style={buttons.darkButtonText}>{resumeLabel}</Text>
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
  quizFrame: {
    // 문제 자체다. 선택지보다 크게 두어야 아이가 그림을 먼저 본다.
    width: 520,
    height: 260,
    borderRadius: 20,
    backgroundColor: '#0f1116',
    marginTop: 4,
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
