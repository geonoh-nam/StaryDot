// The buddy's speech bubble: one drawn shape with its tail, stretched to fit the line inside it.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../Typography';

// The drawn bubble, stretched to whatever the line needs. Its tail hangs off the lower left, so
// the artwork is nine-patched by hand: the padding below leaves room for it.
const ART = require('../assets/scenes/bubble.png');

// `art` swaps in a different bubble picture. A tailless one needs no room left below it, so the
// padding evens out when one is passed.
export function Bubble({ children, style, textStyle, art, flip }) {
  return (
    <View style={[styles.bubble, art && styles.noTail, style]}>
      {/* Only the picture turns over — the words stay the right way up. */}
      <Image
        source={art || ART}
        style={[StyleSheet.absoluteFill, flip && { transform: [{ scaleY: -1 }] }]}
        resizeMode="stretch"
        pointerEvents="none"
      />
      <Text style={[styles.text, textStyle]} numberOfLines={1}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: 54,
    // The tail lives in the lower part of the artwork, so the words sit above it. The two paddings
    // differ by exactly the tail's height, which is what leaves the line centred in the round part.
    paddingTop: 8,
    paddingBottom: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noTail: {
    paddingVertical: 20,
  },
  text: {
    fontSize: 34,
    fontFamily: 'PretendardExtraBold',
    textAlign: 'center',
    color: '#171d31',
  },
});
