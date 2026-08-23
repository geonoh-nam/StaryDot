// What the character says when it is standing still: the same bordered bubble everywhere.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, TEXT_ON_DARK } from '../theme';

export function Quote({ children }) {
  return (
    <View style={styles.quoteBox}>
      <Text style={styles.quoteMark}>“</Text>
      <Text style={styles.quoteText}>{children}</Text>
      <Text style={styles.quoteMark}>”</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  quoteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.blue,
  },
  quoteMark: {
    color: COLORS.blue,
    fontSize: 21,
    fontWeight: '900',
    marginHorizontal: 8,
  },
  quoteText: {
    color: TEXT_ON_DARK,
    fontSize: 22,
    fontWeight: '900',
  },
});
