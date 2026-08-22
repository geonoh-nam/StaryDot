import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { sayCount, sayLine } from './voice';

const ART = {
  bunny: require('../assets/characters/bunny.png'),
  dino: require('../assets/characters/dino.png'),
};

const SIZE = 130;
// The bubble sits ~129px above the buddy's centre (its own height plus the gap to the art).
// Any caller asking the buddy to stand near the top edge would otherwise push the bubble off
// screen — clamp here, once, since only Buddy knows its own size and its bubble's height.
const BUBBLE_CLEARANCE = 129;

// The buddy knows how to move, bounce and speak. It knows nothing about any activity — an
// activity tells it where to go, never how to draw itself.
const Buddy = forwardRef(function Buddy({ character, stage }, ref) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const hop = useRef(new Animated.Value(0)).current;
  const celebrate = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const [bubble, setBubble] = useState(null);
  const lastLine = useRef(null);

  // stage is measured by the parent's onLayout and can change (or arrive late as {w:0,h:0}
  // on the very first render). useImperativeHandle has no deps array, so ref.current only
  // picks up a new closure after a render commits — mirror stage into a ref so goTo always
  // reads the latest value even when called synchronously inside that same onLayout.
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Home is the middle of the bottom edge — the B frame from the spec.
  const HOME = { x: 0.5, y: 0.9 };
  const placedRef = useRef(false);

  // The parent's onLayout calls home() synchronously in the same handler that sets stage
  // state, so that home() call still races the prop update (see stageRef above). Once the
  // stage becomes measurable, place the buddy at HOME ourselves — but only the first time;
  // a later resize (rotation, keyboard) must not yank the buddy back while it's standing
  // wherever an activity sent it. No spring here — a visible slide from the top-left corner
  // on every activity open would be worse than just appearing in place.
  useEffect(() => {
    if (placedRef.current || !stage.w || !stage.h) return;
    placedRef.current = true;
    pos.setValue({ x: HOME.x * stage.w - SIZE / 2, y: HOME.y * stage.h - SIZE / 2 });
  }, [stage.w, stage.h]);

  const goTo = (point) => {
    const s = stageRef.current;
    if (!s.w || !s.h) return; // nothing meaningful to move to on a zero-sized stage
    placedRef.current = true;
    // Never let the centre get so close to the top edge that the bubble above it clips off screen.
    const minY = (SIZE / 2 + BUBBLE_CLEARANCE) / s.h;
    const y = Math.max(point.y, minY);
    Animated.spring(pos, {
      toValue: { x: point.x * s.w - SIZE / 2, y: y * s.h - SIZE / 2 },
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    }).start();
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 220, easing: Easing.bounce, useNativeDriver: true }),
    ]).start();
  };

  useImperativeHandle(ref, () => ({
    say(key) {
      const text = key.startsWith('count.n:')
        ? sayCount(character, Number(key.slice('count.n:'.length)))
        : sayLine(character, key, lastLine.current);
      if (text === null) {
        setBubble(null);
        return;
      }
      lastLine.current = text;
      setBubble(text);
    },
    moveTo: goTo,
    home: () => {
      setBubble(null);
      goTo(HOME);
    },
    react(kind) {
      if (kind === 'right') {
        Animated.sequence([
          Animated.timing(celebrate, { toValue: 1, duration: 140, useNativeDriver: true }),
          Animated.timing(celebrate, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
        ]).start();
      } else {
        Animated.sequence([
          Animated.timing(tilt, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -1, duration: 220, useNativeDriver: true }),
          Animated.timing(tilt, { toValue: 0, duration: 160, useNativeDriver: true }),
        ]).start();
      }
    },
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          transform: [
            ...pos.getTranslateTransform(),
            { translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) },
            { translateY: celebrate.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) },
            { rotate: tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) },
          ],
        },
      ]}
    >
      {bubble ? (
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{bubble}</Text>
        </View>
      ) : null}
      <Image source={ART[character] || ART.bunny} style={styles.art} resizeMode="contain" />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
  },
  art: {
    width: SIZE,
    height: SIZE,
  },
  bubble: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    marginBottom: 12,
    minWidth: 180,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#609EF5',
  },
  bubbleText: {
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: '#171d31',
  },
});

export default Buddy;
