// App type: Pretendard for everything the child and the grown-up read; BnviitLasik stays the
// display face for the wordmark (pass fontFamily explicitly there).
// Korean fonts don't synthesize weight, so fontWeight has to be translated into a family name and
// then dropped, otherwise RN either ignores it or fakes it badly.
import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { useFonts } from 'expo-font';

const AGGRO_FONTS = {
  BnviitLasik: require('./assets/fonts/BnviitLasik.ttf'),
  Poppins: require('@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf'),
  PoppinsSemiBold: require('@expo-google-fonts/poppins/600SemiBold/Poppins_600SemiBold.ttf'),
  PoppinsBold: require('@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf'),
  Pretendard: require('./assets/fonts/Pretendard-Regular.otf'),
  PretendardSemiBold: require('./assets/fonts/Pretendard-SemiBold.otf'),
  PretendardBold: require('./assets/fonts/Pretendard-Bold.otf'),
};

export function useAggroFonts() {
  const [loaded, error] = useFonts(AGGRO_FONTS);
  // A font that fails to load must not hold the app hostage: the gate opens either way, and the
  // system face stands in. A child staring at a white screen is worse than the wrong typeface.
  if (error) console.warn('font load failed, continuing with system fonts:', error);
  return loaded || !!error;
}

// Two families, picked per string: Korean text gets Pretendard, Latin-only text gets Poppins.
// React Native applies one font per Text and does not fall back per script, so the choice has to
// be made here — a mixed string keeps Pretendard, whose Latin is the better compromise.
const BY_WEIGHT = {
  ko: {
    100: 'Pretendard', 200: 'Pretendard', 300: 'Pretendard',
    400: 'Pretendard', normal: 'Pretendard',
    500: 'PretendardSemiBold', 600: 'PretendardSemiBold',
    700: 'PretendardBold', 800: 'PretendardBold', 900: 'PretendardBold', bold: 'PretendardBold',
  },
  en: {
    100: 'Poppins', 200: 'Poppins', 300: 'Poppins',
    400: 'Poppins', normal: 'Poppins',
    500: 'PoppinsSemiBold', 600: 'PoppinsSemiBold',
    700: 'PoppinsBold', 800: 'PoppinsBold', 900: 'PoppinsBold', bold: 'PoppinsBold',
  },
};

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

function scriptOf(children) {
  const text = Array.isArray(children) ? children.join('') : String(children ?? '');
  return HANGUL.test(text) ? 'ko' : 'en';
}

function aggroStyle(style, script = 'ko') {
  const flat = StyleSheet.flatten(style) || {};
  const { fontWeight, fontFamily, ...rest } = flat;
  // An explicit fontFamily wins — that is how the wordmark keeps its display face.
  return { ...rest, fontFamily: fontFamily || BY_WEIGHT[script][fontWeight] || BY_WEIGHT[script][400] };
}

export function Text({ style, children, ...rest }) {
  return <RNText {...rest} style={aggroStyle(style, scriptOf(children))}>{children}</RNText>;
}

export function TextInput({ style, value, placeholder, ...rest }) {
  return (
    <RNTextInput
      {...rest}
      value={value}
      placeholder={placeholder}
      style={aggroStyle(style, scriptOf(value || placeholder))}
    />
  );
}
