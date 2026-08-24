// The star's own room: feed it, dress it, throw it about, and watch it grow.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Rea, { makeMutable, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  CANDY_ICON, CHARACTER_IMAGES, CLOSET_ICON, COSTUMES, EVOLUTIONS, FULL_BAR, GROWTH_CHECKPOINTS,
  GROWTH_PER_CANDY, SCENES, STAGE1_ART, STAR_FIELD,
} from '../data/character';
import { playSound } from '../sound';
import { TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { Spark } from './Browse';

// How much speed a thrown star keeps off a wall, and how fast it coasts to a stop.
const WALL_BOUNCE = 0.5;

const FLING_FRICTION = 0.94;

// How long the star waits before dozing off, and how close a candy has to land to be eaten.
const SLEEP_AFTER_MS = 12000;

const FEED_REACH = 150;

// The star glows harder as it fills, flashes when a form is chosen, and the new character springs
// out of the light. Everything runs on the UI thread so it stays smooth while the panel re-renders.
// Idle float lives outside React: nothing that happens in a render can restart it, so the star
// keeps drifting on its own clock however often the panel re-renders.
const IDLE = makeMutable(0);
// One breath loop for every star on screen, started once.
let idleStarted = false;

const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  angle: (i / 10) * Math.PI * 2,
  delay: i * 45,
}));

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

// Rebuilt only when the character itself changes — never when candy or scene state moves.
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

  // Floating up lifts the character off its shadow, so the shadow tightens as it rises.
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: (0.85 - idle.value * 0.2) * (1 - flash.value),
    transform: [{ scaleX: 1 - idle.value * 0.09 }, { scaleY: 1 - idle.value * 0.12 }],
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
      {/* The ground under the character: a blurred ellipse that shrinks as it floats up. */}
      <Rea.View pointerEvents="none" style={[styles.starShadow, shadowStyle]}>
        <Svg width={240} height={70}>
          <Defs>
            <RadialGradient id="starShade" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#8fbcff" stopOpacity="0.55" />
              <Stop offset="0.6" stopColor="#a9ccff" stopOpacity="0.28" />
              <Stop offset="1" stopColor="#cfe4ff" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={120} cy={35} rx={118} ry={30} fill="url(#starShade)" />
        </Svg>
      </Rea.View>
      <Rea.View style={artStyle}>
        <Image source={art} style={styles.starArt} resizeMode="contain" />
      </Rea.View>
    </View>
  );
});

export function CharacterScreen({ profile, food, fed, onFeed }) {
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
      </View>
      </GestureDetector>

      {/* Growth, candy, wardrobe and backdrops stand beside the stage, all visible at once. */}
      <View
        style={styles.charSide}
        onLayout={(e) => {
          dockBox.current = { x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y };
        }}
      >
        <View style={styles.charCard}>
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
        </View>

        {/* Candy and wardrobe share one card, a row each. */}
        <View style={styles.charItemCard}>
          <GestureDetector gesture={candyDrag}>
            <Animated.View
              style={{ transform: candyPos.getTranslateTransform(), zIndex: 6 }}
              onLayout={(e) => {
                const { x, y, width, height } = e.nativeEvent.layout;
                candyBox.current = { x, y, w: width, h: height };
              }}
            >
              <TouchableOpacity style={[styles.charItemLine, food <= 0 && styles.charItemOff]} onPress={feedStar}>
                <Image source={CANDY_ICON} style={styles.charItemArt} resizeMode="contain" />
                <Text style={styles.charItemLabel}>별사탕</Text>
                <Text style={styles.charItemCount}>{food}개</Text>
              </TouchableOpacity>
            </Animated.View>
          </GestureDetector>
          {/* Clothes are the third-stage reward: nothing to wear until the friend is fully grown. */}
          <TouchableOpacity
            style={[styles.charItemLine, !grownUp && styles.charItemOff]}
            disabled={!grownUp}
            onPress={() => { playSound('pop'); setCloset(true); }}
          >
            <Image source={CLOSET_ICON} style={styles.charItemArt} resizeMode="contain" />
            <Text style={styles.charItemLabel}>옷장</Text>
            <Text style={styles.charItemCount}>{grownUp ? COSTUMES.length : 0}개</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.charItemHint}>퀴즈를 맞히면 별사탕을 줄 수 있어요 !</Text>

        <View style={styles.charCard}>
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
      </View>
    </View>
  );
}

// The growth popup lives here too: it shares the chooser's cards with the screen.
// The one moment the child picks a species: the star has grown and becomes a friend.
export function EvolvePopup({ onPick }) {
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

const styles = StyleSheet.create({
  evolveBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,28,60,0.35)',
  },
  evolveCopy: {
    fontSize: 14,
    color: TEXT_MUTED_ON_DARK,
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
  chipText: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_ON_DARK,
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
  evolveArt: {
    width: 110,
    height: 110,
  },
  evolveLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#171d31',
  },
  charBarFill: {
    position: 'absolute',
    left: 0,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#609EF5',
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
  charCardTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#5b6b8c',
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
  charDockBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
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
  charFlash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    zIndex: 8,
  },
  charGrowthValue: {
    fontSize: 17,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  charItemOff: {
    opacity: 0.4,
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
  charPanelLine: {
    height: 1,
    backgroundColor: '#e6ecfa',
    marginVertical: 2,
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
  charScreen: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  charSide: {
    width: 300,
    gap: 12,
  },
  charCard: {
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#D7EAFF',
    gap: 10,
  },


  charItemCard: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#BADAFF',
  },
  charItemLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  charItemCount: {
    marginLeft: 'auto',
    fontSize: 16,
    fontWeight: '900',
    color: '#609EF5',
  },
  charItemHint: {
    marginTop: -4,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#609EF5',
  },
  charItemArt: {
    width: 34,
    height: 34,
  },
  charItemLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
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
  costumeArt: {
    width: 108,
    height: 108,
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
  costumeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  sceneCell: {
    alignItems: 'center',
    gap: 6,
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
  sceneLabel: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#8a97b1',
  },
  sceneLabelOn: {
    color: '#171d31',
  },
  sceneStrip: {
    gap: 10,
    paddingVertical: 2,
    paddingRight: 4,
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
  sleepZ: {
    position: 'absolute',
    top: 10,
    right: 18,
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
    opacity: 0.85,
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
  starWrap: {
    alignItems: 'center',
    justifyContent: 'center',
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
  starShadow: {
    position: 'absolute',
    bottom: -18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeHeart: {
    position: 'absolute',
    fontSize: 26,
    color: '#ff8fb1',
  },

});
