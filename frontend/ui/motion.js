// Small movements the whole app shares: a press that gives under the finger, a screen that
// arrives rather than appearing, and the gradient rim that frames a card.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Button that dips slightly when pressed for tactile feedback.
export function TapScale({ style, onPress, children, activeScale = 0.94 }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(s, { toValue: v, friction: 7, tension: 200, useNativeDriver: true }).start();
  return (
    <Pressable onPressIn={() => to(activeScale)} onPressOut={() => to(1)} onPress={onPress}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Soft fade+rise on every screen change so navigation never hard-cuts.
export function ScreenFade({ screenKey, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [screenKey]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View style={{ flex: 1, opacity: anim, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export function GradientRim({ radius = 34, width = 6 }) {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="rimTheme" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#609EF5" />
          <Stop offset="0.55" stopColor="#609EF5" />
          <Stop offset="1" stopColor="#ffffff" />
        </LinearGradient>
      </Defs>
      {/* Drawn on the edge at double width so the outer half clips away, leaving an inner rim. */}
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} fill="none" stroke="url(#rimTheme)" strokeWidth={width * 2} />
    </Svg>
  );
}
