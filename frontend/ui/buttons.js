// The two buttons the whole app shares: a solid one for the action that moves things on, and a
// quiet one for the choice beside it.
import { StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export const buttons = StyleSheet.create({
  darkButton: {
    minHeight: 58,
    paddingHorizontal: 30,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dark,
    shadowColor: COLORS.dark,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  darkButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  lightButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f6ff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  lightButtonText: {
    color: '#609EF5',
    fontSize: 18,
    fontWeight: '900',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
});
