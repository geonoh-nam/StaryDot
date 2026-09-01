// What the buddy picked for today. The child sees the whole plan before anything starts, and can
// send it back for a different set — that is the only choice they get here, so it is a big button.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Typography';
import { playSound, speak, stopSpeaking } from '../sound';
import { Bubble } from '../ui/Bubble';
import LINES from '../assets/lines.json';
import { pickLine } from '../activities/lines';

// The buddy that leans on the shelf of stills.
const BUDDY = require('../assets/characters/play.png');
const BACK_ICON = require('../assets/characters/back.png');
const PLAY_ICON = require('../assets/characters/playicon.png');

// "11:39" 또는 "1:02:10" — 초 단위 합을 아이 옆의 어른이 읽을 수 있는 길이로.
function spellDuration(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}

export function PackageScreen({ profile, videos = [], onBack, onStart }) {
  const total = spellDuration(videos.reduce((sum, v) => sum + (v.durationSec || 0), 0));
  const bob = useRef(new Animated.Value(0)).current;
  // The words come from lines.json so a recording can be added without touching this screen.
  const [ask, setAsk] = useState('');
  useEffect(() => {
    setAsk(pickLine(LINES['pack.ask'] || []) || '');
    stopSpeaking();
    speak('dinoLoading');
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.middle}>
        <View style={styles.card}>
          {/* Drawn before the stills and inside the card: in front of its blue ground, behind the
              row of pictures, so the buddy's legs disappear behind them. */}
          <View style={styles.headRow} pointerEvents="none">
            <Animated.Image
              source={BUDDY}
              resizeMode="contain"
              style={[
                styles.buddy,
                { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }] },
              ]}
            />
          </View>

          <View style={styles.row}>
            {videos.map((v, i) => (
              <View key={v.id || i} style={styles.item}>
                <View style={styles.still}>
                  {v.still ? (
                    <Image source={v.still} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: v.color || '#cfe0fb' }]} />
                  )}
                </View>
                <View style={styles.label}>
                  <Text style={styles.labelText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{v.title}</Text>
                  {v.duration ? <Text style={styles.labelTime}>{v.duration}</Text> : null}
                </View>
              </View>
            ))}
          </View>

          {/* What the day adds up to, so a grown-up can see it against the time they set. */}
          {total ? <Text style={styles.total}>오늘은 모두 {total}</Text> : null}
        </View>

        {/* Drawn last and lifted above everything: the bubble is never covered by the card. */}
        <View style={styles.bubbleWrap} pointerEvents="none">
          <Bubble textStyle={styles.askText}>{ask}</Bubble>
        </View>
      </View>

      <View style={styles.actions}>
        {/* Sending the set back is the child's one real choice here, so it sits beside Start. */}
        {/* Back to the friends, for a child who picked the wrong one. */}
        <Pressable onPress={() => { playSound('pop'); onBack && onBack(); }}>
          <Image source={BACK_ICON} style={[styles.knob, styles.knobBig]} resizeMode="contain" />
        </Pressable>

        <Pressable onPress={() => { playSound('pop'); onStart && onStart(); }}>
          <Image source={PLAY_ICON} style={[styles.knob, styles.knobBig]} resizeMode="contain" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: 120,
    paddingBottom: 26,
    backgroundColor: '#eef5ff',
  },
  middle: {
    flex: 1,
    justifyContent: 'center',
  },
  headRow: {
    // Straddles the card's top edge: head and arms clear of it, legs behind the stills.
    position: 'absolute',
    left: 130,
    top: -142,
  },
  buddy: {
    width: 200,
    height: 200,
  },
  bubbleWrap: {
    position: 'absolute',
    top: -46,
    left: 306,
    right: 50,
    alignItems: 'stretch',
    zIndex: 9,
    elevation: 9,
  },
  askText: {
    // Nudged off the centre of the box: the drawn bubble's round part sits low and left of it.
    marginTop: 10,
    marginRight: 180,
  },
  // The tail that points back at the buddy, drawn as a rotated square tucked under the bubble.
  card: {
    // Above the buddy in the stack, which is what hides its lower half.
    zIndex: 2,
    padding: 26,
    paddingTop: 54,
    // Runs off the bottom of its frame, so the row of stills reads as a shelf that continues.
    paddingBottom: 46,
    marginBottom: -22,
    borderRadius: 30,
    backgroundColor: '#d8e8fd',
    borderWidth: 5,
    borderColor: '#9fc5f8',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  item: {
    flex: 1,
    // Two videos must not grow into three videos' worth of width: the stills are 16:9, so a wider
    // card is a taller card, and the buttons underneath get pushed off the screen.
    maxWidth: 372,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#609EF5',
  },
  still: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#bcd4f5',
  },
  label: {
    paddingVertical: 12,
    // 제목이 잘리지 않게 좌우를 좁혔다 — 카드가 넓어질 수 없으니 여백을 내준다.
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  labelText: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
  },
  labelTime: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.82)',
  },
  total: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '900',
    color: '#4570CD',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
    paddingTop: 22,
  },
  knob: {
    width: 92,
    height: 92,
  },
  knobBig: {
    width: 112,
    height: 112,
  },
});
