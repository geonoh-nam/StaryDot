// What the buddy says when something goes right: a card that springs in over a dimmed screen
// and takes no touches, so it never blocks what the child is doing.
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

// Speech bubble with the buddy leaning in from the left, per the mockup.
const POPUP_BUDDY = require('../assets/characters/dino.png');

export function CenterPopup({ text, emoji = '✨' }) {
  const a = useRef(new Animated.Value(0)).current;
  const win = useWindowDimensions();
  useEffect(() => {
    Animated.spring(a, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  }, []);
  return (
    <Modal transparent visible animationType="fade" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ width: win.width, height: win.height, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        <View style={styles.praiseScrim} />
        <Animated.View
          style={[styles.praiseRow, { opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
        >
          <Image source={POPUP_BUDDY} style={styles.praiseBuddy} resizeMode="contain" />
          <View style={styles.praiseCard}>
            <Text style={styles.praiseText}>{text}</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  praiseScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,28,48,0.18)',
  },
  praiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  praiseBuddy: {
    width: 190,
    height: 190,
    // Leans over the bubble's left edge instead of sitting beside it.
    marginRight: -84,
    zIndex: 2,
  },
  praiseCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 520,
    paddingVertical: 30,
    paddingLeft: 120,
    paddingRight: 56,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    borderWidth: 4,
    borderColor: '#609EF5',
    shadowColor: '#1b2a4a',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  praiseText: {
    color: '#171d31',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
  },
});
