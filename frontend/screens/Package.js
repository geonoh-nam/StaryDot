// What the buddy picked for today. The child sees the whole plan before anything starts, and can
// send it back for a different set — that is the only choice they get here, so it is a big button.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Typography';
import { playSound } from '../sound';
import { Bubble } from '../ui/Bubble';
import { sayLine } from '../activities/voice';
import { CHARACTER_IMAGES, STAGE1_ART } from '../data/character';

// The buddy that leans on the shelf of stills.
const BUDDY = require('../assets/characters/play.png');
const BACK_ICON = require('../assets/characters/back.png');
const PLAY_ICON = require('../assets/characters/playicon.png');

export function PackageScreen({ profile, videos = [], onBack, onStart }) {
  const bob = useRef(new Animated.Value(0)).current;
  // The words come from lines.json so a recording can be added without touching this screen.
  const [ask, setAsk] = useState('');
  useEffect(() => {
    setAsk(sayLine(profile?.species === 'dino' ? 'dino' : 'bunny', 'pack.ask') || '');
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
                  <Text style={styles.labelText} numberOfLines={1}>{v.title}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Drawn last and lifted above everything: the bubble is never covered by the card. */}
        <View style={styles.bubbleWrap} pointerEvents="none">
          <Bubble>{ask}</Bubble>
        </View>
      </View>

      <View style={styles.actions}>
        {/* Sending the set back is the child's one real choice here, so it sits beside Start. */}
        {/* Back to the friends, for a child who picked the wrong one. */}
        <Pressable onPress={() => { playSound('pop'); onBack && onBack(); }}>
          <Image source={BACK_ICON} style={styles.knob} resizeMode="contain" />
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
    left: 26,
    top: -108,
  },
  buddy: {
    width: 200,
    height: 200,
  },
  bubbleWrap: {
    position: 'absolute',
    top: -58,
    left: 236,
    right: 120,
    alignItems: 'stretch',
    zIndex: 9,
    elevation: 9,
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
    gap: 20,
    // 편수가 적으면 카드가 늘어나는 대신 가운데로 모인다.
    justifyContent: 'center',
  },
  item: {
    flex: 1,
    // 카드는 폭에 맞춰 늘어나고 높이는 16:9 로 따라온다. 상한이 없으면 한 편짜리 편성에서
    // 카드가 화면 폭을 통째로 먹고 높이가 1200px 을 넘겨, 재생 버튼이 화면 밖으로 밀린다.
    // 세 편일 때 나오는 폭(약 33%)을 상한으로 두면 3편 배치는 그대로고 1·2편만 잡힌다.
    maxWidth: '33%',
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
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  labelText: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
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
