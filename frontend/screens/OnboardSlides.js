// The first thing anyone sees: five painted screens that fade into one another on their own.
// A touch anywhere jumps to the last one, where the button is.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../Typography';
import { playSound } from '../sound';

const SLIDES = [
  require('../assets/onboard/1.jpg'),
  require('../assets/onboard/2.jpg'),
  require('../assets/onboard/3.jpg'),
  require('../assets/onboard/4.jpg'),
  require('../assets/onboard/5.jpg'),
];

// How long each picture holds, and how long one dissolves into the next.
const HOLD_MS = 2000;
const FADE_MS = 900;

// The one picture that arrives by sliding in; every other change is a crossfade.
const SLIDE_IN = 3;

// The start button's own size, so its drawn rim lands exactly on its edge.
const START_W = 300;
const START_H = 62;
const START_RIM = 4;

export function OnboardSlides({ onNext }) {
  const win = useWindowDimensions();
  const [page, setPage] = useState(0);
  // 마지막 그림이 다 떠오른 뒤에야 버튼을 낸다 — 화면이 아직 바뀌는 중에 뜨면 먼저 눌린다.
  const [ready, setReady] = useState(false);
  const last = SLIDES.length - 1;
  // One value per picture: a crossfade is two of them moving at once, so there is never a frame
  // where the screen is empty.
  const fades = useRef(SLIDES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  // Each picture keeps its own zoom, so one slide reaching the end never snaps another back to
  // the start — that reset is what read as "grows, then shrinks".
  const drifts = useRef(SLIDES.map(() => new Animated.Value(0))).current;
  // Only the fourth waits off-screen to the right; the rest sit in place and fade.
  const slides = useRef(SLIDES.map((_, i) => new Animated.Value(i === SLIDE_IN ? 1 : 0))).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Only the picture on screen zooms, and it is never wound back while it is visible.
    Animated.timing(drifts[page], { toValue: 1, duration: HOLD_MS + FADE_MS, useNativeDriver: true }).start();
    if (page >= last) return undefined;
    const next = page + 1;
    const t = setTimeout(() => {
      const moves = [
        Animated.timing(fades[next], { toValue: 1, duration: FADE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ];
      // Both pictures travel together: the old one leaves to the left as the new one arrives.
      if (next === SLIDE_IN) {
        const glide = { duration: FADE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true };
        moves.push(Animated.timing(slides[next], { toValue: 0, ...glide }));
        moves.push(Animated.timing(slides[page], { toValue: -1, ...glide }));
      }
      // The picture underneath is never faded out: two half-transparent pictures let the ground
      // show through, which reads as the screen washing white mid-change.
      Animated.parallel(moves).start(({ finished }) => { if (finished && next >= last) setReady(true); });
      setPage(next);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [page, last]);

  // Skipping lands on the last picture rather than leaving the screen.
  const skip = () => {
    if (page >= last) return;
    playSound('pop');
    Animated.parallel([
      ...fades.map((f, i) => Animated.timing(f, { toValue: i <= last ? 1 : 0, duration: 320, useNativeDriver: true })),
      ...slides.map((v, i) => Animated.timing(v, { toValue: i === SLIDE_IN - 1 ? -1 : 0, duration: 320, useNativeDriver: true })),
    ]).start(({ finished }) => { if (finished) setReady(true); });
    setPage(last);
  };

  return (
    <Pressable style={styles.wrap} onPress={skip}>
      {SLIDES.map((art, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: fades[i],
              transform: [
                { translateX: slides[i].interpolate({ inputRange: [-1, 0, 1], outputRange: [-(win.width - 2), 0, win.width - 2] }) },
                // The sliding pair holds still: a zoom running under a slide reads as the screen
                // swelling mid-move.
                { scale: drifts[i].interpolate({ inputRange: [0, 1], outputRange: [1, i === SLIDE_IN || i === SLIDE_IN - 1 ? 1 : 1.035] }) },
              ],
            },
          ]}
        >
          <Image source={art} style={{ width: win.width, height: win.height }} resizeMode="cover" />
        </Animated.View>
      ))}

      {ready ? (
        // A real button to a five-year-old: it has a thick base, and pressing pushes it down onto it.
        <View style={styles.startWrap} pointerEvents="box-none">
          <Pressable
            onPressIn={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
            onPressOut={() => Animated.spring(press, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 8 }).start()}
            onPress={() => { playSound('pop'); onNext(); }}
          >
            <Animated.View
              style={[
                styles.start,
                { transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) }] },
              ]}
            >
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                <Defs>
                  {/* Deep in the middle, bright toward the edges — light pooling on a glass pill. */}
                  <RadialGradient id="startFace" cx="50%" cy="50%" rx="62%" ry="120%">
                    <Stop offset="0.01" stopColor="#436DCA" />
                    <Stop offset="0.48" stopColor="#609EF5" />
                    <Stop offset="1" stopColor="#FFFFFF" />
                  </RadialGradient>
                  {/* The rim runs dark to light and back, so it reads as a rolled glass edge. */}
                  <LinearGradient id="startRim" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#436DCA" />
                    <Stop offset="0.49" stopColor="#FFFFFF" />
                    <Stop offset="0.93" stopColor="#436DCA" />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={START_W} height={START_H} rx={START_H / 2} fill="url(#startFace)" />
                {/* Inset by half the stroke, so the line sits on the pill's edge rather than inside it. */}
                <Rect
                  x={START_RIM / 2}
                  y={START_RIM / 2}
                  width={START_W - START_RIM}
                  height={START_H - START_RIM}
                  rx={(START_H - START_RIM) / 2}
                  fill="none"
                  stroke="url(#startRim)"
                  strokeWidth={START_RIM}
                />
              </Svg>
              <Text style={styles.startText}>시작하기</Text>
            </Animated.View>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#cfe6ff',
  },
  startWrap: {
    position: 'absolute',
    bottom: 78,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  start: {
    width: START_W,
    height: START_H,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#609EF5',
  },
  startText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
  },
});
