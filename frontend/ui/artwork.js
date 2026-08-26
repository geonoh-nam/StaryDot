// The child's own drawing, replayed as strokes, and the character it turns into. Three screens
// show these, so none of them owns the code.
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { CHARACTER_IMAGES } from '../data/character';

const CHARACTER_BASE = 150;

function characterImageFor(species, level) {
  if (level < 2) return CHARACTER_IMAGES.star;
  return CHARACTER_IMAGES[species] || CHARACTER_IMAGES.star;
}

// Replays the child's own strokes, so a saved drawing needs no image capture.
export function StrokeArt({ drawing, size = 230 }) {
  const strokes = drawing.strokes || [];
  const pts = strokes.flatMap((st) => st.points || st);
  const pad = 24;
  const box = pts.length
    ? {
        x: Math.min(...pts.map((p) => p.x)) - pad,
        y: Math.min(...pts.map((p) => p.y)) - pad,
        w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + pad * 2,
        h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + pad * 2,
      }
    : { x: 0, y: 0, w: drawing.size?.width || 620, h: drawing.size?.height || 380 };
  const scale = size / Math.max(box.w, box.h);
  return (
    <Svg width={box.w * scale} height={box.h * scale} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
      {strokes.map((stroke, i) => (
        <Path
          key={i}
          d={(stroke.points || stroke).map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}
          stroke={stroke.color || '#171d31'}
          strokeWidth={stroke.thickness || 8}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

export function GeneratedCharacter({ uri, size }) {
  return (
    <View style={[styles.generatedWrap, { width: size, height: size }]}>
      <Image source={{ uri }} style={styles.generatedImage} resizeMode="contain" />
    </View>
  );
}

// The mascot: breathes on its own, squashes when tapped, jumps when something good happens.
// ponytail: RN Animated stand-in until the Rive file lands — same props, so the swap is local.
export function PattiCharacter({ tone = 'blue', size = 1, onPress, celebrate = 0, species = 'star', level = 1 }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const hop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    if (!celebrate) return;
    Animated.sequence([
      Animated.spring(hop, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 14 }),
      Animated.spring(hop, { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 10 }),
    ]).start();
  }, [celebrate]);

  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.9, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }),
    ]).start();
    if (onPress) onPress();
  };

  const px = CHARACTER_BASE * size;
  const translateY = Animated.add(
    breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }),
    hop.interpolate({ inputRange: [0, 1], outputRange: [0, -px * 0.18] })
  );

  return (
    <Pressable onPress={tap} hitSlop={12}>
      <Animated.Image
        source={characterImageFor(species, level)}
        resizeMode="contain"
        style={{ width: px, height: px, transform: [{ translateY }, { scale }] }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  generatedWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatedImage: {
    width: '100%',
    height: '100%',
  },
});
