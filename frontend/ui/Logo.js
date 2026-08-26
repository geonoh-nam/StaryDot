// The wordmark: two words and a star, all sized from one number so it scales as a unit.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { TEXT_ON_DARK } from '../theme';

// Distance from a Text box's top edge down to the cap line, as a share of font size.
const CAP_TOP_RATIO = -0.11;

// Wordmark: "Story" with a ringed star riding as a superscript — ring and star share the brand blue.
export function StaryLogo({ size = 26, color = '#609EF5', textColor = TEXT_ON_DARK }) {
  const mark = size * 0.5;
  return (
    <View style={styles.logoRow}>
      <Text style={[styles.logoWord, { fontSize: size, color: textColor }]}>Story</Text>
      <Text style={[styles.logoWord, { fontSize: size, color, marginLeft: size * 0.16 }]}>Dot</Text>
      <Svg width={mark} height={mark} viewBox="0 0 32 32" // The text box starts above the cap line, so nudge the mark down to sit level with the S.
        style={{ marginLeft: size * 0.06, marginTop: size * CAP_TOP_RATIO }}>
        <Circle cx={16} cy={16} r={16} fill={color} />
        <Polygon
          points="16,5.6 19.1,12.4 26.5,13.2 20.9,18.2 22.5,25.5 16,21.8 9.5,25.5 11.1,18.2 5.5,13.2 12.9,12.4"
          fill="#ffffff"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  logoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  logoWord: {
    fontFamily: 'BnviitLasik',
    letterSpacing: -0.5,
  },
});
