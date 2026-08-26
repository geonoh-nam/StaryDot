// The buddy's speech bubble: one drawn shape with its tail, stretched to fit the line inside it.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../Typography';

// The drawn bubble, stretched to whatever the line needs. Its tail hangs off the lower left, so
// the artwork is nine-patched by hand: the padding below leaves room for it.
const ART = require('../assets/scenes/bubble.png');

export function Bubble({ children, style, textStyle }) {
  return (
    <View style={[styles.bubble, style]}>
      <Image source={ART} style={StyleSheet.absoluteFill} resizeMode="stretch" pointerEvents="none" />
      <Text style={[styles.text, textStyle]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: 54,
    // The tail lives in the lower part of the artwork, so the words sit above it.
    paddingTop: 20,
    paddingBottom: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 25,
    fontWeight: '900',
    color: '#171d31',
  },
});
