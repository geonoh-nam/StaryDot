// App type: Pretendard for everything the child and the grown-up read; BnviitLasik stays the
// display face for the wordmark (pass fontFamily explicitly there).
// Korean fonts don't synthesize weight, so fontWeight has to be translated into a family name and
// then dropped, otherwise RN either ignores it or fakes it badly.
import React from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput } from 'react-native';
import { useFonts } from 'expo-font';

const AGGRO_FONTS = {
  BnviitLasik: require('./assets/fonts/BnviitLasik.ttf'),
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

// One family for everything the app reads — Korean and Latin alike. Only the wordmark passes its
// own fontFamily, and an explicit family always wins below.
const BY_WEIGHT = {
  100: 'Pretendard', 200: 'Pretendard', 300: 'Pretendard',
  400: 'Pretendard', normal: 'Pretendard',
  500: 'PretendardSemiBold', 600: 'PretendardSemiBold',
  700: 'PretendardBold', 800: 'PretendardBold', 900: 'PretendardBold', bold: 'PretendardBold',
};

function aggroStyle(style) {
  const flat = StyleSheet.flatten(style) || {};
  const { fontWeight, fontFamily, ...rest } = flat;
  // An explicit fontFamily wins — that is how the wordmark keeps its display face.
  return { ...rest, fontFamily: fontFamily || BY_WEIGHT[fontWeight] || BY_WEIGHT[400] };
}

export function Text({ style, children, ...rest }) {
  return <RNText {...rest} style={aggroStyle(style)}>{children}</RNText>;
}

export function TextInput({ style, value, placeholder, ...rest }) {
  return (
    <RNTextInput
      {...rest}
      value={value}
      placeholder={placeholder}
      style={aggroStyle(style)}
    />
  );
}
