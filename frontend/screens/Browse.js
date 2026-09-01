// Choosing what to watch: the ring of series cards on the main screen, the episode grid inside
// one series, and the still that plays it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SERIES_ART, THUMBS } from '../data/library';
import { playSound } from '../sound';
import { BG, hexToRgb, rgbToHex, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { TapScale } from '../ui/motion';
import Rea, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDecay, withSpring } from 'react-native-reanimated';
import { DebugJump } from '../ui/DebugJump';
import { StaryLogo } from '../ui/Logo';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

export const CARD_W = 300;

export const CARD_H = 420;

export const CARD_GAP = 18;

export const CARD_RADIUS = 26;

const CARD_BORDER = 3.5;

const CARD_OVERLAP = 58;

// The cards ride the rim of one big circle whose centre sits far below the screen: they keep
// facing the viewer, the middle one rides highest and largest, the outer ones sink along the arc.
const RING_RADIUS = 1500;

const RING_ANGLE = 9; // degrees between neighbouring cards

const RING_SAMPLES = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

const SERIES_HERO_W = 330;

const STAR_BUDDY = require('../assets/characters/star-buddy.png');

// How far below its resting place the star may be dragged before the cards begin.
const BUDDY_DROP = 120;

// How much speed a thrown star keeps off a wall, and how fast it coasts to a stop.
const BUDDY_BOUNCE = 0.55;

const BUDDY_FRICTION = 0.93;

// 이름을 부를 때 붙는 조사. 받침이 있으면 "아", 없으면 "야" — 한글이 아니면 붙이지 않는다.
function callSuffix(name) {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return '';
  return code % 28 ? '아' : '야';
}

const BUDDY_MENU = [
  { key: 'character', label: '마이 캐릭터', art: require('../assets/scenes/mycharacter.png') },
  { key: 'parent', label: '부모 리포트', art: require('../assets/scenes/report.png') },
  { key: 'settings', label: '설정', art: require('../assets/scenes/setting.png') },
];

// Cards wear a lighter ring of their own colour, like the mockup.
function lighten(hex, amount) {
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


// Where each card sits on the ring: how far it drops, how small it gets, when it fades out.
const ringFacet = () => {
  const rad = (deg) => (deg * Math.PI) / 180;
  return {
    translateY: RING_SAMPLES.map((d) => RING_RADIUS * (1 - Math.cos(rad(d * RING_ANGLE)))),
    scale: RING_SAMPLES.map((d) => Math.max(0.6, Math.cos(rad(d * RING_ANGLE)) ** 3 * 1.06)),
    opacity: RING_SAMPLES.map((d) => (Math.abs(d) > 2.5 ? 0 : 1)),
  };
};
// How many cards away this one sits, going the short way round the ring. Counted in cards, so the
// pair either side of the wrap are neighbours here too.
function ringGap(index, focus, count) {
  const raw = ((index - focus) % count + count) % count;
  return Math.min(raw, count - raw);
}

function RingCard({ video, index, offset, step, total, count, centerX, focused, focus, onPress }) {
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
      // Nearer the middle means nearer the front. The distance has to wrap the same way the
      // position does, or the card where the ring closes jumps to the back.
      style={[
        styles.ringCard,
        // Android stacks by elevation, not zIndex, so both carry the same number: the middle card
        // sits highest, its two neighbours next, the pair beyond them lowest.
        { zIndex: 20 - ringGap(index, focus, count), elevation: 20 - ringGap(index, focus, count) },
        style,
      ]}
    >
      <VideoCard video={video} onPress={onPress} />
    </Rea.View>
  );
}

// Any character image, breathing and squashing on tap — the same feel as the mascot.
function BouncyCharacter({ source, size = 200 }) {
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
function StarBuddy({ onPress }) {
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
    playSound('star');
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
  // The star can be dragged, but only around the greeting: below it the cards begin.
  const buddyPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  // Where the star was left, so a new drag continues from there rather than snapping back.
  const buddyAt = useRef({ x: 0, y: 0 });
  // Measured from where the star actually sits, so it can never be thrown off the screen.
  const buddyRange = useRef({ left: 0, right: 0, up: 0, down: BUDDY_DROP });
  const buddyRef = useRef(null);
  const measureBuddy = () => {
    buddyRef.current?.measureInWindow((x, y, w, h) => {
      if (!w) return;
      const restX = x - buddyAt.current.x;
      const restY = y - buddyAt.current.y;
      buddyRange.current = {
        left: -(restX - 8),
        right: win.width - restX - w - 8,
        up: -(restY - 8),
        down: BUDDY_DROP,
      };
    });
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Let go mid-swing and the star keeps flying, bouncing off the edges of its band until it
  // runs out of speed. The frame loop lives in a ref so a re-render never starts a second one.
  const flight = useRef(null);
  const fling = (vx, vy) => {
    if (flight.current) cancelAnimationFrame(flight.current);
    let dx = vx;
    let dy = vy;
    const step = () => {
      dx *= BUDDY_FRICTION;
      dy *= BUDDY_FRICTION;
      let x = buddyAt.current.x + dx;
      let y = buddyAt.current.y + dy;
      if (x < buddyRange.current.left || x > buddyRange.current.right) {
        x = clamp(x, buddyRange.current.left, buddyRange.current.right);
        dx = -dx * BUDDY_BOUNCE;
      }
      if (y < buddyRange.current.up || y > buddyRange.current.down) {
        y = clamp(y, buddyRange.current.up, buddyRange.current.down);
        dy = -dy * BUDDY_BOUNCE;
      }
      buddyAt.current = { x, y };
      buddyPos.setValue({ x, y });
      if (Math.hypot(dx, dy) < 0.4) { flight.current = null; return; }
      flight.current = requestAnimationFrame(step);
    };
    if (Math.hypot(dx, dy) > 1) flight.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (flight.current) cancelAnimationFrame(flight.current); }, []);

  const buddyDrag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.hypot(g.dx, g.dy) > 6,
      onPanResponderGrant: () => { if (flight.current) { cancelAnimationFrame(flight.current); flight.current = null; } },
      onPanResponderMove: (_e, g) => {
        buddyPos.setValue({
          x: clamp(buddyAt.current.x + g.dx, buddyRange.current.left, buddyRange.current.right),
          y: clamp(buddyAt.current.y + g.dy, buddyRange.current.up, buddyRange.current.down),
        });
      },
      onPanResponderRelease: (_e, g) => {
        buddyAt.current = {
          x: clamp(buddyAt.current.x + g.dx, buddyRange.current.left, buddyRange.current.right),
          y: clamp(buddyAt.current.y + g.dy, buddyRange.current.up, buddyRange.current.down),
        };
        fling(g.vx * 16, g.vy * 16);
      },
    })
  ).current;
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
      <Animated.View
        style={[styles.buddyAnchor, { transform: buddyPos.getTranslateTransform() }]}
        collapsable={false}
        ref={buddyRef}
        onLayout={measureBuddy}
        {...buddyDrag.panHandlers}
      >
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
            <Text style={styles.buddyText}>
              {profile?.name ? `${profile.name}${callSuffix(profile.name)}\n` : ''}우리 어디로 갈까?
            </Text>
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
                  <Text style={styles.buddyMenuText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        ) : null}
      </Animated.View>
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
              count={base.length}
              centerX={(win.width - CARD_W) / 2}
              focused={i === focus}
              focus={focus}
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

const VideoCard = React.memo(function VideoCard({ video, onPress }) {
  return (
    <TapScale style={[styles.card, { backgroundColor: video.color }]} onPress={() => { playSound('pop'); onPress(video); }}>
      <CardSheen color={video.color} />
      <Text style={styles.cardTitle} numberOfLines={2}>{video.title}</Text>
      <Text style={styles.cardSub} numberOfLines={1}>{video.duration}</Text>
      <View style={styles.cardBadge}><Text style={styles.cardBadgeText}>!</Text></View>
      {/* Some art fills its PNG edge to edge; artScale pulls those back in line with the rest. */}
      <Image source={video.thumb} style={[styles.cardArt, video.artScale ? { height: 260 * video.artScale } : null]} resizeMode="contain" />
    </TapScale>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    // Fills down to the character card's baseline instead of stopping short.
    height: CARD_H + 80,
    borderRadius: CARD_RADIUS,
    paddingTop: 26,
    paddingHorizontal: 22,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
  },
  cardSub: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },
  cardBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  cardBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  },
  cardArt: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 14,
    height: 320,
  },
  buddyAnchor: {
    position: 'relative',
    // Above the card ring on Android, which stacks by elevation rather than zIndex.
    zIndex: 40,
    elevation: 24,
  },
  buddyBubble: {
    // Hangs off the star's right side; the anchor keeps it glued there.
    position: 'absolute',
    left: 198,
    top: 24,
    zIndex: 40,
    // Android stacks by elevation, not zIndex: without this the cards swallow the taps.
    elevation: 24,
    width: 222,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: '#609EF5',
  },
  buddyMenu: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  buddyMenuArt: {
    width: 40,
    height: 40,
  },
  buddyMenuIcon: {
    fontSize: 30,
    lineHeight: 34,
    color: '#609EF5',
  },
  buddyMenuItem: {
    // 두 칸씩 내려앉는 타일. 아이콘이 위, 글이 아래.
    width: 88,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 3,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#446ECB',
  },
  buddyMenuText: {
    // 카드 폭(88) 안에서 한 줄로 앉는 한계. 넘치면 아래 adjustsFontSizeToFit 이 살짝 좁힌다.
    fontSize: 13,
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
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '900',
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
