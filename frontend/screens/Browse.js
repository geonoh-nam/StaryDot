// Choosing what to watch: the ring of series cards on the main screen, the episode grid inside
// one series, and the still that plays it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SERIES_ART, THUMBS } from '../data/library';
import { playSound } from '../sound';
import { TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { TapScale } from '../ui/motion';

export const CARD_W = 300;

export const CARD_H = 420;

export const CARD_GAP = 18;

export const CARD_RADIUS = 26;

export const CARD_BORDER = 3.5;

export const CARD_OVERLAP = 58;

// The cards ride the rim of one big circle whose centre sits far below the screen: they keep
// facing the viewer, the middle one rides highest and largest, the outer ones sink along the arc.
export const RING_RADIUS = 1500;

export const RING_ANGLE = 9; // degrees between neighbouring cards

export const RING_SAMPLES = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

export const SERIES_HERO_W = 330;

export const STAR_BUDDY = require('../assets/characters/star-buddy.png');

export const BUDDY_MENU = [
  { key: 'character', label: '캐릭터', icon: '★' },
  { key: 'parent', label: '부모 리포트', icon: '▤' },
  { key: 'words', label: '단어장', icon: '가' },
  { key: 'settings', label: '설정', art: SETTINGS_ICON },
];

// Cards wear a lighter ring of their own colour, like the mockup.
export function lighten(hex, amount) {
  const rgb = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * amount));
  return rgbToHex(rgb);
}

// A light wash over the flat card colour, plus a gradient rim — svg keeps it dependency-free.
// React Native borders take a single colour, so the rim is drawn rather than set as a border.
export function CardSheen({ color }) {
  const rim = 'rim-' + color.slice(1);
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0.45" />
        </LinearGradient>
        <LinearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} />
          <Stop offset="1" stopColor={lighten(color, 0.8)} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={CARD_RADIUS} fill="url(#sheen)" />
      {/* Drawn on the edge at double width so the outer half clips away: the rim then follows
          whatever size the card is, instead of the main screen's fixed card. */}
      <Rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        rx={CARD_RADIUS}
        fill="none"
        stroke={`url(#${rim})`}
        strokeWidth={CARD_BORDER * 2}
      />
    </Svg>
  );
}

export function RingCard({ video, index, offset, step, total, centerX, focused, onPress }) {
  const facet = ringFacet();
  const style = useAnimatedStyle(() => {
    const half = total / 2;
    const raw = index * step - offset.value;
    // Wrap into [-half, half): every card is always shown on its nearest side of the ring.
    const d = (((raw + half) % total) + total) % total - half;
    const k = d / step;
    return {
      opacity: interpolate(k, RING_SAMPLES, facet.opacity, Extrapolation.CLAMP),
      transform: [
        { translateX: centerX + d },
        { translateY: interpolate(k, RING_SAMPLES, facet.translateY, Extrapolation.CLAMP) },
        { scale: interpolate(k, RING_SAMPLES, facet.scale, Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Rea.View
      pointerEvents={focused ? 'auto' : 'none'}
      style={[styles.ringCard, { zIndex: focused ? 20 : 1, elevation: focused ? 12 : 0 }, style]}
    >
      <VideoCard video={video} onPress={onPress} />
    </Rea.View>
  );
}

// Any character image, breathing and squashing on tap — the same feel as the mascot.
export function BouncyCharacter({ source, size = 200 }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const tap = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.92, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }),
    ]).start();
    playSound('pop');
  };
  return (
    <Pressable onPress={tap}>
      <Animated.Image
        source={source}
        resizeMode="contain"
        style={{
          width: size,
          height: size,
          transform: [
            { translateY: breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
            { scale },
          ],
        }}
      />
    </Pressable>
  );
}

export function Spark({ spark, burst }) {
  const style = useAnimatedStyle(() => {
    const t = burst.value;
    const distance = 60 + t * 130;
    return {
      opacity: t > 0 ? 1 - t : 0,
      transform: [
        { translateX: Math.cos(spark.angle) * distance },
        { translateY: Math.sin(spark.angle) * distance },
        { scale: 0.4 + (1 - t) * 0.9 },
      ],
    };
  });
  return <Rea.View pointerEvents="none" style={[styles.spark, style]} />;
}

// The star drifts and twinkles; tapping it opens the menu bubble that the screen owns, so the
// bubble can live in the free space bottom-right instead of being clipped beside the greeting.
export function StarBuddy({ onPress }) {
  const float = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const tap = () => {
    playSound('pop');
    Animated.sequence([
      Animated.timing(press, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 14 }),
    ]).start();
    onPress();
  };

  return (
    <Pressable onPress={tap}>
      <Animated.Image
        source={STAR_BUDDY}
        resizeMode="contain"
        style={{
          width: 190,
          height: 190,
          transform: [
            { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }) },
            { rotate: float.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '4deg'] }) },
            { scale: press },
          ],
        }}
      />
    </Pressable>
  );
}

export function MainScreen({ series, profile, onStart, onMenu, onJump, onReset, contentUp }) {
  const win = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const bubble = useRef(new Animated.Value(0)).current;
  const toggleMenu = (next) => {
    setMenuOpen(next);
    Animated.spring(bubble, { toValue: next ? 1 : 0, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
  };
  const base = series;
  // Cards overlap, so one step is narrower than a card.
  const step = CARD_W - CARD_OVERLAP;
  const total = base.length * step;
  // Scroll position in pixels, unbounded: the ring wraps it, so there is no end to hit.
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // Stacking cannot be animated, so the settled index is tracked to lift the front card.
  const [focus, setFocus] = useState(0);

  const ring = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragStart.value = offset.value;
        })
        .onUpdate((e) => {
          offset.value = dragStart.value - e.translationX;
        })
        .onEnd((e) => {
          // Fling, then settle: one continuous motion on the UI thread, so nothing hitches.
          offset.value = withDecay({ velocity: -e.velocityX, deceleration: 0.9985 }, () => {
            const snapped = Math.round(offset.value / step) * step;
            offset.value = withSpring(snapped, { damping: 18, stiffness: 90, mass: 0.5 });
            runOnJS(setFocus)((((snapped / step) % base.length) + base.length) % base.length);
          });
        }),
    [step, base.length]
  );

  return (
    <View style={styles.mainScreen}>
      <DebugJump onJump={onJump} onTab={onMenu} onReset={onReset} contentUp={contentUp} />
      {/* Whose tablet this is: the child's own photo and name, top-left. */}
      <View style={styles.mainWho}>
        {profile.photo ? (
          <Image source={{ uri: profile.photo }} style={styles.mainWhoPhoto} />
        ) : (
          <View style={[styles.mainWhoPhoto, styles.mainWhoBlank]}>
            <Image source={STAR_BUDDY} style={styles.mainWhoStar} resizeMode="contain" />
          </View>
        )}
        <Text style={styles.mainWhoName} numberOfLines={1}>{profile.name || '친구'}</Text>
      </View>
      <StaryLogo size={30} textColor={BG} />

      <View style={styles.mainGreetRow}>
      <View style={styles.buddySpacer} />
      <View style={styles.mainGreetBlock}>
        <View style={styles.mainGreetLine}>
          <Text style={styles.mainGreeting}>안녕! </Text>
          <View>
            <Text style={styles.mainGreeting}>{profile.name || '친구'}!</Text>
            <View style={styles.mainUnderline} />
          </View>
        </View>
        <Text style={styles.mainGreeting}>오늘은 우리 뭐 할까?</Text>
      </View>
      <View style={styles.buddyAnchor} collapsable={false}>
        <StarBuddy onPress={() => toggleMenu(!menuOpen)} />
        {menuOpen ? (
          <Animated.View
            style={[
              styles.buddyBubble,
              {
                opacity: bubble,
                transform: [
                  { translateX: bubble.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
                  { scale: bubble },
                ],
              },
            ]}
          >
            <View style={styles.buddyTail} />
            <Text style={styles.buddyText}>어디로 갈까?</Text>
            <View style={styles.buddyMenu}>
              {BUDDY_MENU.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={styles.buddyMenuItem}
                  onPress={() => { toggleMenu(false); playSound('pop'); onMenu(m.key); }}
                >
                  {m.art ? (
                    <Image source={m.art} style={styles.buddyMenuArt} resizeMode="contain" />
                  ) : (
                    <Text style={styles.buddyMenuIcon}>{m.icon}</Text>
                  )}
                  <Text style={styles.buddyMenuText}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        ) : null}
      </View>
      </View>

      <GestureDetector gesture={ring}>
        <View style={styles.carousel} collapsable={false}>
          {base.map((v, i) => (
            <RingCard
              key={v.id}
              video={v}
              index={i}
              offset={offset}
              step={step}
              total={total}
              centerX={(win.width - CARD_W) / 2}
              focused={i === focus}
              onPress={onStart}
            />
          ))}
        </View>
      </GestureDetector>

    </View>
  );
}

// Series screen: the character sits on the left inviting the child, episodes fill the grid.
export function SeriesScreen({ series, onBack, onStart }) {
  // Percentage basis was letting a fourth item squeeze in, so the width is measured.
  const win = useWindowDimensions();
  // 3 per row: screen padding, the hero column, the body gap and the two grid gaps come off first.
  const episodeW = Math.floor((win.width - 48 - SERIES_HERO_W - 24 - 32) / 3);
  const episodes = series.episodes || [];
  return (
    <View style={styles.seriesScreen}>
      <View style={styles.seriesHeader}>
        <TouchableOpacity style={styles.seriesBack} onPress={onBack}>
          <Text style={styles.seriesBackText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.seriesTitle}>{series.title}</Text>
        <Text style={styles.seriesCount}>동영상 {episodes.length}개</Text>
      </View>

      <View style={styles.seriesBody}>
        <View style={[styles.seriesHero, { backgroundColor: series.color }]}>
          <CardSheen color={series.color} />
          {/* Line sits on the floor of the card; the character takes every pixel left above it. */}
          <View style={styles.seriesHeroArt}>
            <BouncyCharacter source={series.thumb} size={SERIES_HERO_W - 40} />
          </View>
          <Text style={styles.seriesHeroLine}>{series.line || '“나랑 같이 놀자”'}</Text>
        </View>

        <View style={styles.seriesRight}>
          <ScrollView contentContainerStyle={styles.seriesGrid} showsVerticalScrollIndicator={false}>
            {episodes.map((v, i) => (
              <TapScale key={v.id} style={[styles.episode, { width: episodeW }]} onPress={() => { playSound('pop'); onStart(v); }}>
                <View style={[styles.episodeThumb, { backgroundColor: v.color || series.color }]}>
                  <Image source={v.still || THUMBS[i % THUMBS.length]} style={styles.episodeImg} resizeMode="cover" />
                </View>
                <Text style={styles.episodeTitle} numberOfLines={1}>{v.title}</Text>
              </TapScale>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

// What the child sees after picking an episode: a big still, one start button, and what waits inside.
export function VideoDetailScreen({ video, series, onClose, onStart }) {
  const accent = (series && series.accent) || '#609EF5';
  return (
    <View style={[styles.detailScreen, { backgroundColor: (series && series.tint) || '#f5f8ff' }]}>
      <TouchableOpacity style={styles.detailClose} onPress={onClose}>
        <Text style={styles.detailCloseText}>✕</Text>
      </TouchableOpacity>

      <View style={styles.detailThumb}>
        <GradientRim radius={24} width={6} />
        {/* Until per-video stills exist, frames pulled from the demo video stand in. */}
        <Image source={video.still || THUMBS[0]} style={styles.detailThumbImg} resizeMode="cover" />
        {/* Absolute overlay, so the button centres on the still instead of being pushed below it. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.detailOverlay}>
            <TapScale style={styles.detailStart} onPress={() => { playSound('pop'); onStart(video); }}>
              <View style={[styles.detailPlay, { backgroundColor: accent }]}>
                <Text style={styles.detailPlayGlyph}>▶</Text>
              </View>
              <Text style={styles.detailStartText}>시작하기</Text>
            </TapScale>
          </View>
        </View>
      </View>

      <Text style={styles.detailTitle}>
        {video.title}
        <Text style={styles.detailMeta}>  {video.duration} · 만 5~6세</Text>
      </Text>
      {/* ponytail: fixed counts until activities are authored per video. */}
      <Text style={styles.detailCounts}>질문 1개 · 퍼즐 1개 · 그림 1개</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  buddyAnchor: {
    position: 'relative',
  },
  buddyBubble: {
    // Hangs off the star's right side; the anchor keeps it glued there.
    position: 'absolute',
    left: 198,
    top: 24,
    zIndex: 40,
    minWidth: 230,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: '#609EF5',
  },
  buddyMenu: {
    marginTop: 10,
    gap: 8,
  },
  buddyMenuArt: {
    width: 18,
    height: 18,
  },
  buddyMenuIcon: {
    fontSize: 16,
    color: '#609EF5',
  },
  buddyMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  buddyMenuText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#171d31',
  },
  buddySpacer: {
    width: 128,
  },
  buddyTail: {
    position: 'absolute',
    left: -8,
    top: 26,
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#609EF5',
    transform: [{ rotate: '45deg' }],
  },
  buddyText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  carousel: {
    // Children are absolutely placed, so the row needs its own size to catch the drag.
    flex: 1,
    alignSelf: 'stretch',
    // Pushed down so the cards run off the bottom edge — the fan should feel like it continues.
    marginTop: 64,
    marginBottom: -70,
  },
  detailClose: {
    position: 'absolute',
    top: 22,
    right: 28,
    padding: 10,
  },
  detailCloseText: {
    fontSize: 26,
    fontWeight: '900',
    color: BG,
  },
  detailCounts: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  detailMeta: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  detailOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPlay: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  detailPlayGlyph: {
    fontSize: 34,
    marginLeft: 6,
    color: '#ffffff',
  },
  detailScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  detailStart: {
    alignItems: 'center',
    gap: 10,
  },
  detailStartText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowRadius: 6,
  },
  detailThumb: {
    // Real video shape, so the still is not letterboxed or stretched.
    width: '82%',
    aspectRatio: 16 / 9,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    overflow: 'hidden',
  },
  detailThumbImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  detailTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: BG,
  },
  episode: {
    gap: 8,
  },
  episodeImg: {
    width: '100%',
    height: '100%',
  },
  episodeThumb: {
    height: 190,
    borderRadius: 18,
    overflow: 'hidden',
  },
  episodeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: BG,
  },
  mainGreetBlock: {
    alignItems: 'center',
    marginTop: 44,
  },
  mainGreetLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mainGreetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  mainGreeting: {
    fontSize: 40,
    lineHeight: 54,
    fontWeight: '900',
    color: BG,
  },
  mainScreen: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 40,
    backgroundColor: '#ffffff',
  },
  mainUnderline: {
    height: 8,
    borderRadius: 4,
    marginTop: -6,
    backgroundColor: '#609EF5',
  },
  mainWho: {
    position: 'absolute',
    top: 26,
    left: 30,
    zIndex: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mainWhoBlank: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fe',
  },
  mainWhoName: {
    maxWidth: 130,
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  mainWhoPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  mainWhoStar: {
    width: 34,
    height: 34,
  },
  ringCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: CARD_W,
    justifyContent: 'center',
  },
  seriesBack: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  seriesBackText: {
    fontSize: 18,
    fontWeight: '800',
    color: BG,
  },
  seriesBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 24,
  },
  seriesCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  seriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    paddingBottom: 20,
  },
  seriesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  seriesHero: {
    width: SERIES_HERO_W,
    // Runs the full column, so its bottom lines up with the last row of videos.
    alignSelf: 'stretch',
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 20,
    // Line rides a little above the floor, halfway between the character and the card edge.
    paddingBottom: 110,
  },
  seriesHeroArt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesHeroLine: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
  },
  seriesRight: {
    flex: 1,
    gap: 14,
  },
  seriesScreen: {
    flex: 1,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  seriesTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#171d31',
  },
  spark: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ffffff',
    shadowColor: '#bcd8ff',
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
});
