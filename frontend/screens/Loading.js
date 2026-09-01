// While the day's package is being put together, the buddy has the screen to itself and asks to
// be played with. The wait is where a child is most likely to walk away, so this is the one
// screen that must never look like it is doing nothing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../Typography';
import LINES from '../assets/lines.json';
import { pickLine } from '../activities/lines';
import { playSound, speak } from '../sound';
const BG = require('../assets/scenes/bg.png');
const BUDDY = require('../assets/characters/loading.png');

// What the buddy says while it waits. The words live in lines.json, so a recording can be
// dropped in later without touching this screen.
const LINE_KEYS = ['load.play', 'load.pick'];

const LINE_MS = 3200;

// How long the buddy keeps the child company before the day's set is ready.
const PACK_MS = 3000;

// How much speed a thrown buddy keeps off a wall, and how fast it coasts to a stop.
const WALL_BOUNCE = 0.5;
const FLING_FRICTION = 0.94;
const BUDDY_SIZE = 260;

export function LoadingScreen({ profile, voice = 'bunny', onStart }) {
  // The wait ends on its own — a child should not have to press anything to get to the good part.
  useEffect(() => {
    const t = setTimeout(() => onStart && onStart(), PACK_MS);
    return () => clearTimeout(t);
  }, []);
  const win = useWindowDimensions();
  const [line, setLine] = useState(0);
  const [said, setSaid] = useState('');
  const [taps, setTaps] = useState(0);
  const bob = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const bubble = useRef(new Animated.Value(0)).current;
  // Where the buddy has been dragged or thrown to, and how big the child has made it.
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(1)).current;
  const scaleAt = useRef(1);
  const stage = useRef({ w: 0, h: 0 });
  const limit = useRef({ x: 0, y: 0 });

  // Let go mid-swing and it keeps flying, bouncing off the edges. Animated.decay cannot bounce,
  // so the throw is stepped by hand.
  const flight = useRef(null);
  const stopFlight = () => {
    if (flight.current) cancelAnimationFrame(flight.current);
    flight.current = null;
  };
  useEffect(() => stopFlight, []);

  const throwBuddy = (vx, vy) => {
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
      if (x > lx || x < -lx) { x = x > 0 ? lx : -lx; vx = -vx * WALL_BOUNCE; playSound('pop'); }
      if (y > ly || y < -ly) { y = y > 0 ? ly : -ly; vy = -vy * WALL_BOUNCE; playSound('pop'); }
      const damp = Math.pow(FLING_FRICTION, dt * 60);
      vx *= damp;
      vy *= damp;
      pos.setValue({ x, y });
      flight.current = Math.hypot(vx, vy) > 40 ? requestAnimationFrame(step) : null;
    };
    flight.current = requestAnimationFrame(step);
  };

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin(() => { stopFlight(); pos.extractOffset(); })
        .onUpdate((e) => pos.setValue({ x: e.translationX, y: e.translationY }))
        .onEnd((e) => {
          pos.flattenOffset();
          throwBuddy(e.velocityX, e.velocityY);
        }),
    []
  );

  // Two fingers anywhere on the scene resize the buddy, the way the character room does it.
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onUpdate((e) => scale.setValue(Math.max(0.4, Math.min(2.4, scaleAt.current * e.scale))))
        .onEnd((e) => { scaleAt.current = Math.max(0.4, Math.min(2.4, scaleAt.current * e.scale)); }),
    []
  );

  const name = profile?.name || '친구';

  // The idle float never stops, so the screen is alive even between lines.
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    bubble.setValue(0);
    Animated.spring(bubble, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
    // 글은 줄마다 바뀌지만 목소리는 하나다 — 로딩 내내 같은 한마디가 흐른다.
    setSaid(pickLine(LINES[LINE_KEYS[line]] || [], said) || '');
    if (line === 0) speak('loading');
    if (line >= LINE_KEYS.length - 1) return undefined;
    const t = setTimeout(() => setLine((n) => n + 1), LINE_MS);
    return () => clearTimeout(t);
  }, [line]);

  // Touching the buddy is the whole game here: it hops, and that is the reward.
  const poke = () => {
    playSound('star');
    setTaps((n) => n + 1);
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 170, useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
  };

  const lift = Animated.add(
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -60] })
  );

  const [card, setCard] = useState({ width: 0, height: 0 });
  const [bubbleBox, setBubbleBox] = useState({ width: 0, height: 0 });

  return (
    <View style={styles.screen}>
      <View style={styles.bubbleWrap} pointerEvents="none">
        <Animated.View
          onLayout={(e) => setBubbleBox(e.nativeEvent.layout)}
          style={[
            styles.bubble,
            {
              opacity: bubble,
              transform: [{ translateY: bubble.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
            },
          ]}
        >
          {/* A React Native border takes one flat colour, so the rim is drawn at the measured size. */}
          {bubbleBox.width ? (
            <Svg width={bubbleBox.width} height={bubbleBox.height} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id="bubbleRim" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#609EF5" />
                  <Stop offset="0.52" stopColor="#BADAFF" />
                  <Stop offset="1" stopColor="#DFECFF" />
                </LinearGradient>
              </Defs>
              <Rect
                x={2}
                y={2}
                width={bubbleBox.width - 4}
                height={bubbleBox.height - 4}
                rx={(bubbleBox.height - 4) / 2}
                fill="none"
                stroke="url(#bubbleRim)"
                strokeWidth={4}
              />
            </Svg>
          ) : null}
          <Text style={styles.bubbleText} numberOfLines={1}>
            {line === 0 ? `${name}아 ${said}` : said}
          </Text>
        </Animated.View>
      </View>

      <GestureDetector gesture={pinch}>
      <Pressable
        style={styles.stage}
        onPress={poke}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCard(e.nativeEvent.layout);
          stage.current = { w: width, h: height };
          // Keeps the buddy inside its scene however far it is thrown.
          limit.current = {
            x: Math.max(0, (width - BUDDY_SIZE) / 2),
            y: Math.max(0, (height - BUDDY_SIZE) / 2),
          };
        }}
      >
        <Image source={BG} style={{ width: '100%', height: '100%' }} resizeMode="cover" />

        {/* The rim is a gradient, so it is drawn rather than set as a border. */}
        {card.width ? (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="loadRim" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#bcd9ff" />
                <Stop offset="0.5" stopColor="#609EF5" />
                <Stop offset="1" stopColor="#bcd9ff" />
              </LinearGradient>
            </Defs>
            <Rect x={4} y={4} width={card.width - 8} height={card.height - 8} rx={26} fill="none" stroke="url(#loadRim)" strokeWidth={8} />
          </Svg>
        ) : null}


        <GestureDetector gesture={drag}>
          <Animated.Image
            source={BUDDY}
            resizeMode="contain"
            style={[
              styles.buddy,
              {
                transform: [
                  ...pos.getTranslateTransform(),
                  { translateY: lift },
                  { scale },
                  { scaleX: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) },
                  { scaleY: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
                ],
              },
            ]}
          />
        </GestureDetector>

        {/* The count is the child's own doing, so it only appears once they have started poking. */}
        {taps > 0 ? (
          <Text style={styles.taps} pointerEvents="none">{taps}번 톡톡!</Text>
        ) : null}

      </Pressable>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // Same frame as the video screen, pulled in — more off the top and bottom than the sides, so
    // the scene keeps the wide shape of its background picture.
    paddingHorizontal: 56,
    paddingVertical: 92,
    backgroundColor: '#eef5ff',
  },
  stage: {
    flex: 1,
    borderRadius: 30,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleWrap: {
    // Sits above the card rather than inside it: the card clips its children, and the bubble
    // straddles its top edge — the rim runs through the middle of the bubble.
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 4,
  },
  bubble: {
    maxWidth: '92%',
    paddingHorizontal: 44,
    paddingVertical: 15,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    shadowColor: '#2b5aa8',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  bubbleText: {
    fontSize: 23,
    textAlign: 'center',
    fontWeight: '900',
    color: '#171d31',
  },
  buddy: {
    position: 'absolute',
    width: BUDDY_SIZE,
    height: BUDDY_SIZE,
  },
  taps: {
    position: 'absolute',
    bottom: 26,
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    textShadowColor: 'rgba(30,60,120,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
