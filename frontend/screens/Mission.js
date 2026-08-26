// 세션의 마지막 화면. 오늘의 오프라인 미션 카드 하나.
//
// 이 앱은 스크린타임 충돌을 시간 통제가 아니라 **착지 설계**로 푼다. 마지막 영상 뒤에
// 화면 밖에서 할 일을 하나 주면 아이는 "빼앗겼다"가 아니라 "끝냈다"로 세션을 닫는다.
// 그래서 여기에는 이어보기 버튼이 없다 — 나가는 문 하나뿐이다.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { Text } from '../Typography';
import { playSound } from '../sound';
import { buttons } from '../ui/buttons';
import { TapScale } from '../ui/motion';
import { Bubble } from '../ui/Bubble';

const BUDDY = require('../assets/characters/star-buddy.png');

export function MissionScreen({ mission, onDone }) {
  const enter = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    playSound('fanfare');
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.screen}>
      <Animated.Image
        source={BUDDY}
        style={[styles.buddy, { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) }] }]}
        resizeMode="contain"
      />
      <Bubble>오늘은 여기까지! 이건 화면 밖에서 해 보는 거야</Bubble>
      <Animated.View
        style={[
          styles.card,
          { opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] },
        ]}
      >
        <Text style={styles.title}>{mission.title}</Text>
        <Text style={styles.body}>{mission.description}</Text>
      </Animated.View>
      <TapScale style={buttons.darkButton} onPress={onDone}>
        <Text style={buttons.darkButtonText}>알겠어요!</Text>
      </TapScale>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: '#f4f7fe', padding: 28 },
  buddy: { width: 150, height: 150 },
  card: {
    maxWidth: 620,
    paddingVertical: 26,
    paddingHorizontal: 34,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  title: { fontSize: 30, fontWeight: '900', color: '#1b3a7a', textAlign: 'center' },
  body: { fontSize: 21, lineHeight: 30, color: '#3d4a63', textAlign: 'center' },
});
