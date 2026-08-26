// Time is up. The screen belongs to the buddy waving goodbye; the only way on is a button in the
// far corner, worded for the grown-up who has to be the one to unlock it.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../Typography';
import { playSound } from '../sound';
import { StaryLogo } from '../ui/Logo';
import { Bubble } from '../ui/Bubble';
import { sayLine } from '../activities/voice';

const BUDDY = require('../assets/characters/bye.png');
// A tailless bubble: nothing on this screen for a tail to point at.
const GOODBYE_BUBBLE = require('../assets/scenes/goodbyement.png');

export function ByeScreen({ profile, onUnlock }) {
  const name = profile?.name || '친구';
  // Both friends say goodbye together — one slot each, so the two recordings overlap.
  const [line, setLine] = useState('');
  useEffect(() => {
    setLine(sayLine('bunny', 'bye.see') || '');
    sayLine('dino', 'bye.see');
  }, []);
  const bob = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.logo} pointerEvents="none"><StaryLogo size={30} /></View>

      <View style={styles.middle} pointerEvents="none">
        {/* A soft halo behind the buddy, breathing so the still screen keeps a pulse. */}
        <Animated.View
          style={[
            styles.halo,
            {
              opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0.95] }),
              transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] }) }],
            },
          ]}
        >
          {/* Blurred at the edges, so the light pools behind the buddy instead of ringing it. */}
          <Svg width={640} height={640}>
            <Defs>
              <RadialGradient id="byeGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#bcd9ff" stopOpacity="0.95" />
                <Stop offset="0.55" stopColor="#cfe3ff" stopOpacity="0.5" />
                <Stop offset="1" stopColor="#eef5ff" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx={320} cy={320} r={320} fill="url(#byeGlow)" />
          </Svg>
        </Animated.View>
        <Animated.Image
          source={BUDDY}
          resizeMode="contain"
          style={[
            styles.buddy,
            { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }] },
          ]}
        />
        <Bubble art={GOODBYE_BUBBLE} style={styles.line} textStyle={styles.lineText}>{name}아 {line}</Bubble>
      </View>

      {/* Two presses, not one: a child who finds the button still cannot get past it alone. */}
      <Pressable
        style={styles.unlock}
        onPress={() => {
          playSound('pop');
          if (!asking) { setAsking(true); return; }
          setAsking(false);
          onUnlock && onUnlock();
        }}
      >
        <Text style={styles.unlockText}>{asking ? '정말 해제할까요?' : '해제하기'}</Text>
        <Svg width={26} height={26} viewBox="0 0 24 24">
          <Path d="M8 10V7a4 4 0 1 1 8 0v3" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
          <Rect x={5} y={10} width={14} height={10} rx={3} fill="#ffffff" />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#eef5ff',
  },
  logo: {
    position: 'absolute',
    top: 30,
    left: 34,
  },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  halo: {
    position: 'absolute',
    width: 640,
    height: 640,
  },
  buddy: {
    width: 420,
    height: 420,
  },
  line: {
    // Pulled up into the space the buddy's artwork leaves empty above its head.
    marginTop: -100,
  },
  lineText: {
    // Sits lower than the middle of the box: the drawn oval's round part is below its centre.
    marginTop: 60,
  },
  unlock: {
    position: 'absolute',
    right: 40,
    bottom: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 30,
    paddingVertical: 18,
    borderRadius: 999,
    backgroundColor: '#7EAAF5',
  },
  unlockText: {
    fontSize: 19,
    fontWeight: '900',
    color: '#ffffff',
  },
});
