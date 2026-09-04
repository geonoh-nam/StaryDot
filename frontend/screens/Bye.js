// Time is up. The screen belongs to the buddy waving goodbye; the only way on is a button in the
// far corner, worded for the grown-up who has to be the one to unlock it.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Text } from '../Typography';
import { playSound } from '../sound';
import { StoryDotLogo } from '../ui/Logo';
import { Bubble } from '../ui/Bubble';
import { sayLine } from '../activities/voice';

const BUDDY = require('../assets/characters/bye.png');
// A tailless bubble: nothing on this screen for a tail to point at.
const GOODBYE_BUBBLE = require('../assets/scenes/goodbyement.png');

export function ByeScreen({ profile, mission, onUnlock }) {
  const name = profile?.name || '친구';
  // Both friends say goodbye together — one slot each, so the two recordings overlap.
  const [line, setLine] = useState('');
  // A React Native border takes one flat colour, so the card's rim is drawn at its measured size.
  const [cardBox, setCardBox] = useState({ width: 0, height: 0 });
  // Poking the buddy is the only thing left to do on this screen: it wobbles and turns around.
  const boing = useRef(new Animated.Value(0)).current;
  const face = useRef(new Animated.Value(1)).current;
  const facing = useRef(1);
  const poke = () => {
    playSound('star');
    facing.current = -facing.current;
    // Turning passes through zero width, so it reads as spinning on the spot.
    Animated.timing(face, { toValue: facing.current, duration: 300, useNativeDriver: true }).start();
    boing.setValue(0);
    Animated.sequence([
      Animated.timing(boing, { toValue: 1, duration: 130, useNativeDriver: true }),
      Animated.spring(boing, { toValue: 0, friction: 3, tension: 140, useNativeDriver: true }),
    ]).start();
  };
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
      <View style={styles.logo} pointerEvents="none"><StoryDotLogo size={30} /></View>

      <View style={styles.middle} pointerEvents="box-none">
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
        <Bubble art={GOODBYE_BUBBLE} flip style={styles.line} textStyle={styles.lineText}>{name}아 {line}</Bubble>
        <Pressable onPress={poke}>
          <Animated.Image
            source={BUDDY}
            resizeMode="contain"
            style={[
              styles.buddy,
              {
                transform: [
                  { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) },
                  { scaleX: Animated.multiply(face, boing.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] })) },
                  { scaleY: boing.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) },
                ],
              },
            ]}
          />
        </Pressable>
        {/* What the planner asks the grown-up to do with the child once the screen is off. */}
        <View style={styles.card} onLayout={(e) => setCardBox(e.nativeEvent.layout)}>
          {cardBox.width ? (
            <Svg width={cardBox.width} height={cardBox.height} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="byeCardRim" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor="#8FBAF8" />
                  <Stop offset="1" stopColor="#DFECFF" />
                </LinearGradient>
              </Defs>
              <Rect
                x={2}
                y={2}
                width={cardBox.width - 4}
                height={cardBox.height - 4}
                rx={30}
                fill="#ffffff"
                stroke="url(#byeCardRim)"
                strokeWidth={4}
              />
            </Svg>
          ) : null}
          {mission ? (
            <View style={styles.missionText}>
              <Text style={styles.missionTitle} numberOfLines={1}>{mission.title}</Text>
              <Text style={styles.missionBody}>{mission.description}</Text>
            </View>
          ) : null}
        </View>
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
    // Nudged down off the wordmark.
    paddingTop: 70,
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
    // Above the buddy, tucked down into the space its artwork leaves empty over the head.
    marginBottom: -70,
  },
  lineText: {
    // The turned-over artwork puts its round part above the middle, and its tail off to one side,
    // so the words sit a little right of centre and a little lower than the middle of the box.
    marginBottom: 0,
    marginTop: 14,
    marginLeft: 24,
  },
  card: {
    // As wide as the buddy standing above it, so the two read as one column.
    width: 560,
    height: 150,
    marginTop: -40,
    justifyContent: 'center',
  },
  missionText: {
    paddingHorizontal: 28,
    gap: 6,
  },
  missionTitle: {
    textAlign: 'center',
    fontSize: 21,
    fontFamily: 'PretendardExtraBold',
    color: '#2C4A7C',
  },
  missionBody: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 21,
    color: '#6C86AE',
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
