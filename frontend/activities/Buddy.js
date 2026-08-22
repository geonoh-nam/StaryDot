import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { sayCount, sayLine } from './voice';

const ART = {
  bunny: require('../assets/characters/bunny.png'),
  dino: require('../assets/characters/dino.png'),
};

const SIZE = 130;

// The buddy knows how to move, bounce and speak. It knows nothing about any activity — an
// activity tells it where to go, never how to draw itself.
const Buddy = forwardRef(function Buddy({ character, stage }, ref) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const hop = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const [bubble, setBubble] = useState(null);
  const lastLine = useRef(null);

  // Home is the middle of the bottom edge — the B frame from the spec.
  const HOME = { x: 0.5, y: 0.9 };

  const goTo = (point) => {
    Animated.spring(pos, {
      toValue: { x: point.x * stage.w - SIZE / 2, y: point.y * stage.h - SIZE / 2 },
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
      if (text === null) return;
      lastLine.current = text;
      setBubble(text);
    },
    moveTo: goTo,
    home: () => goTo(HOME),
    react(kind) {
      if (kind === 'right') {
        Animated.sequence([
          Animated.timing(hop, { toValue: 1, duration: 140, useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 260, easing: Easing.bounce, useNativeDriver: true }),
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
    alignItems: 'center',
  },
  art: {
    width: SIZE,
    height: SIZE,
  },
  bubble: {
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
