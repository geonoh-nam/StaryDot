import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Typography';
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Line,
  LinearGradient,
  Oval,
  Path,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Storyboard beats, as a share of the total run. Tune here, not in the bodies below.
const TOTAL = 6200;
const T = {
  skyIn: [0.0, 0.12],      // 1. quiet night sky: yellow stars, crescent moon, slow push-in
  spark: [0.13, 0.19],     // 2. a flash up high, then the cyan star peels away
  fall: [0.19, 0.50],      // 3. it falls, the sea surfaces beneath it, it lands softly
  seaIn: [0.21, 0.40],
  impact: [0.50, 0.56],
  gather: [0.54, 0.68],    // 4. cyan fog closes around the star...
  disperse: [0.68, 0.86],  //    ...then opens up and the wordmark resolves out of it
  logo: [0.68, 0.84],
  wave: [0.82, 0.94],      // 5. a blue ring sweeps out from the wordmark, recolouring stars
  // 0.94-1.0 holds on the finished blue sky before handing over.
};

// Scene bands, as a share of screen height. Everything sits well clear of the bottom
// so the landing flash and wordmark are not crowded by the system task bar.
const HORIZON = 0.52;
const SHORE = 0.66;
const LAND_X = 0.5;
const LAND_Y = 0.73;

const STAR_YELLOW = '#FFD76A';
const STAR_CYAN = '#5FE3F5';
const BRAND_CYAN = '#00CFE9';
const SKY_TOP = '#04081c';
const SKY_LOW = '#0e1a48';
const SEA_TOP = '#0a1640';
const SEA_LOW = '#04091d';
const GROUND = '#02040d';
const RIDGE = '#071230';
const FOG = '#8fe4f4';
const MOON_X = 0.78;

// Deterministic star field — a seeded LCG keeps the layout identical on every run.
const STARS = (() => {
  let seed = 20260819;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: 52 }, () => ({
    x: rand(),
    y: rand() * (HORIZON - 0.05) + 0.02,
    r: 0.9 + rand() * 1.9,
    phase: rand() * Math.PI * 2,
    speed: 1.5 + rand() * 1.9,
  }));
})();

// Fog puffs: offsets are relative to the landing point, in points.
const PUFFS = [
  { dx: -108, dy: -8, r: 46 },
  { dx: -64, dy: -36, r: 36 },
  { dx: -26, dy: -12, r: 44 },
  { dx: 4, dy: -42, r: 38 },
  { dx: 36, dy: -14, r: 44 },
  { dx: 72, dy: -38, r: 34 },
  { dx: 114, dy: -6, r: 48 },
  { dx: -14, dy: 16, r: 54 },
  { dx: 54, dy: 18, r: 40 },
];

// Progress within a beat, clamped to 0..1.
function seg(v, range) {
  'worklet';
  return Math.min(1, Math.max(0, (v - range[0]) / (range[1] - range[0])));
}

function easeOut(p) {
  'worklet';
  return 1 - Math.pow(1 - p, 3);
}

// Slow start, quick middle, soft settle — the fall wants to land, not hit.
function smooth(p) {
  'worklet';
  return p * p * (3 - 2 * p);
}

// Quadratic bezier, so the fall bows instead of running dead straight.
function bezier(a, c, b, p) {
  'worklet';
  const q = 1 - p;
  return q * q * a + 2 * q * p * c + p * p * b;
}

// Tangent of the same curve, used to point the trail along the direction of travel.
function bezierSlope(a, c, b, p) {
  'worklet';
  return 2 * (1 - p) * (c - a) + 2 * p * (b - c);
}

// Where along the fall the star crosses the middle of the water. Solved numerically
// against the actual curve so the ripple lands on the crossing, not near it.
function crossingProgress(startY, ctrlY, landY, targetY) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 26; i += 1) {
    const mid = (lo + hi) / 2;
    const y = bezier(startY, ctrlY, landY, mid * mid * (3 - 2 * mid));
    if (y < targetY) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export default function IntroScreen({ onDone, logo }) {
  const [size, setSize] = useState(null);
  const t = useSharedValue(0);

  useEffect(() => {
    if (!size) return undefined;
    t.value = withTiming(1, { duration: TOTAL, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    return undefined;
  }, [size]);

  const h = size ? size.height : 0;
  const w = size ? size.width : 0;
  const landY = h * LAND_Y;

  // One slow push-in for the whole scene. The wordmark rides the same move so it
  // stays glued to the landing point.
  const camera = useDerivedValue(() => {
    const p = t.value;
    return { scale: 1.05 + 0.08 * p, pan: -6 + 16 * p };
  });

  const sceneTransform = useDerivedValue(() => [
    { scale: camera.value.scale },
    { translateY: camera.value.pan },
  ]);

  const logoStyle = useAnimatedStyle(() => {
    const p = smooth(seg(t.value, T.logo));
    const { scale, pan } = camera.value;
    return {
      opacity: p,
      transform: [
        { translateY: (landY - h / 2) * (scale - 1) + pan * scale },
        { scale: scale * (0.93 + 0.07 * p) },
      ],
    };
  });

  if (!size) {
    return <View style={styles.screen} onLayout={(e) => setSize(e.nativeEvent.layout)} />;
  }

  const horizonY = h * HORIZON;
  const shoreY = h * SHORE;
  const landX = w * LAND_X;

  // The star starts off the top-left and runs diagonally into the landing point.
  const startX = landX - w * 0.44;
  const startY = -h * 0.08;
  // Bow the trajectory out to the side so the descent reads as an arc.
  const BOW = 0.13;
  const ctrlX = startX + (landX - startX) * 0.5 + (landY - startY) * BOW;
  const ctrlY = startY + (landY - startY) * 0.5 - (landX - startX) * BOW;

  const seaMidY = (horizonY + shoreY) / 2;
  const crossP = crossingProgress(startY, ctrlY, landY, seaMidY);
  const seaHitX = bezier(startX, ctrlX, landX, smooth(crossP));
  const crossAt = T.fall[0] + crossP * (T.fall[1] - T.fall[0]);
  const maxR = Math.hypot(w, h);

  return (
    <View style={styles.screen}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={sceneTransform} origin={vec(w / 2, h / 2)}>
          {/* sky */}
          <Rect x={-w} y={-h} width={w * 3} height={horizonY + h}>
            <LinearGradient start={vec(0, -h)} end={vec(0, horizonY)} colors={[SKY_TOP, SKY_LOW]} />
          </Rect>

          <SkyDepth t={t} w={w} h={h} horizonY={horizonY} />

          <Moon t={t} w={w} h={h} />

          {STARS.map((s, i) => (
            <FieldStar key={i} t={t} star={s} w={w} h={h} landX={landX} landY={landY} maxR={maxR} />
          ))}

          <Sea t={t} w={w} h={h} horizonY={horizonY} shoreY={shoreY} moonX={w * MOON_X} />
          <SeaRipple t={t} x={seaHitX} y={seaMidY} at={crossAt} />

          {/* far ridge, then the near bank — two tones so the shore reads as depth
              rather than a flat black bar */}
          <Path
            path={`M${-w} ${shoreY + 6} Q ${w * 0.18} ${shoreY - 30} ${w * 0.44} ${shoreY - 4} T ${w * 0.9} ${shoreY - 16} L ${w * 2} ${shoreY + 8} L ${w * 2} ${h * 2} L ${-w} ${h * 2} Z`}
            color={RIDGE}
          />
          <Path
            path={`M${-w} ${shoreY + 30} Q ${w * 0.32} ${shoreY - 2} ${w * 0.6} ${shoreY + 22} T ${w * 2} ${shoreY + 14} L ${w * 2} ${h * 2} L ${-w} ${h * 2} Z`}
            color={GROUND}
          />

          <FallingStar
            t={t}
            startX={startX}
            startY={startY}
            ctrlX={ctrlX}
            ctrlY={ctrlY}
            landX={landX}
            landY={landY}
          />
          <Impact t={t} x={landX} y={landY} />

          {PUFFS.map((p, i) => (
            <FogPuff key={i} t={t} puff={p} x={landX} y={landY} />
          ))}

          <WaveRing t={t} x={landX} y={landY} maxR={maxR} />
        </Group>
      </Canvas>

      {/* Sits above the landing glow rather than centred in it, so the wordmark reads clearly. */}
      <Animated.View style={[styles.logoWrap, { top: landY - 104, width: w }, logoStyle]}>
        {logo}
      </Animated.View>

      <Pressable
        style={styles.skip}
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="인트로 건너뛰기"
      >
        <Text style={styles.skipText}>건너뛰기</Text>
      </Pressable>
    </View>
  );
}

// A background star: twinkles on its own phase, then flips from yellow to the brand
// cyan at the moment the expanding ring reaches it.
function FieldStar({ t, star, w, h, landX, landY, maxR }) {
  const cx = star.x * w;
  const cy = star.y * h;
  const dist = Math.hypot(cx - landX, cy - landY);

  const opacity = useDerivedValue(() => {
    const born = easeOut(seg(t.value, T.skyIn));
    const secs = (t.value * TOTAL) / 1000;
    const tw = 0.5 + 0.5 * Math.sin(secs * star.speed + star.phase);
    return born * (0.35 + 0.65 * tw);
  });

  // The ring front and the colour change share one radius, so stars flip exactly as
  // the light passes over them rather than on a parallel timer.
  const flip = useDerivedValue(() => {
    const front = easeOut(seg(t.value, T.wave)) * maxR;
    return Math.min(1, Math.max(0, (front - dist) / 110));
  });

  const color = useDerivedValue(() =>
    interpolateColor(flip.value, [0, 1], [STAR_YELLOW, STAR_CYAN])
  );

  const glow = useDerivedValue(() => star.r * (0.9 + flip.value * 1.4));

  // Only the brightest few get a glint; on all of them it would read as a grid.
  const spike = star.r * 4.2;

  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={star.r} color={color}>
        <BlurMask blur={glow} style="solid" />
      </Circle>
      {star.r > 2.2 ? (
        <Group opacity={0.45}>
          <Line
            p1={vec(cx - spike, cy)}
            p2={vec(cx + spike, cy)}
            color={color}
            style="stroke"
            strokeWidth={0.9}
          >
            <BlurMask blur={2} style="normal" />
          </Line>
          <Line
            p1={vec(cx, cy - spike)}
            p2={vec(cx, cy + spike)}
            color={color}
            style="stroke"
            strokeWidth={0.9}
          >
            <BlurMask blur={2} style="normal" />
          </Line>
        </Group>
      ) : null}
    </Group>
  );
}

// Depth for the backdrop: a soft galactic band plus airglow gathering at the horizon,
// so the sky is not one flat gradient.
function SkyDepth({ t, w, h, horizonY }) {
  const opacity = useDerivedValue(() => easeOut(seg(t.value, T.skyIn)));
  const bandW = w * 1.6;
  const bandX = w * 0.4 - bandW / 2;
  const bandY = h * 0.2;

  return (
    <Group opacity={opacity}>
      <Group transform={[{ rotate: -0.42 }]} origin={vec(w * 0.4, bandY)}>
        {/* wide haze, then a tighter core, so the band has a spine instead of a smudge */}
        <Rect x={bandX} y={bandY - 96} width={bandW} height={192} opacity={0.2}>
          <LinearGradient
            start={vec(bandX, 0)}
            end={vec(bandX + bandW, 0)}
            colors={['rgba(126,150,255,0)', 'rgba(170,188,255,0.9)', 'rgba(126,150,255,0)']}
          />
          <BlurMask blur={58} style="normal" />
        </Rect>
        <Rect x={bandX} y={bandY - 26} width={bandW} height={52} opacity={0.22}>
          <LinearGradient
            start={vec(bandX, 0)}
            end={vec(bandX + bandW, 0)}
            colors={['rgba(150,170,255,0)', 'rgba(206,218,255,0.95)', 'rgba(150,170,255,0)']}
          />
          <BlurMask blur={22} style="normal" />
        </Rect>
      </Group>
      {/* airglow — tall with a mid stop, otherwise the top edge reads as a hard band */}
      <Rect x={-w} y={horizonY - 210} width={w * 3} height={210}>
        <LinearGradient
          start={vec(0, horizonY - 210)}
          end={vec(0, horizonY)}
          colors={['rgba(70,100,195,0)', 'rgba(84,116,205,0.1)', 'rgba(104,142,224,0.34)']}
          positions={[0, 0.55, 1]}
        />
      </Rect>
    </Group>
  );
}

// Crescent: a lit disc with a second disc punched out of it.
function Moon({ t, w, h }) {
  const cx = w * MOON_X;
  const cy = h * 0.16;
  const opacity = useDerivedValue(() => easeOut(seg(t.value, T.skyIn)));
  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={58} color="#fff3c4" opacity={0.14}>
        <BlurMask blur={44} style="normal" />
      </Circle>
      <Group layer>
        <Circle cx={cx} cy={cy} r={30} color="#f7f1cf">
          <BlurMask blur={3} style="solid" />
        </Circle>
        <Circle cx={cx + 15} cy={cy - 9} r={27} color="#000" blendMode="dstOut" />
      </Group>
    </Group>
  );
}

// Broken glints making up the moon's reflection. Uniform full-width rules read as a
// loading skeleton, so these are short, jittered and unevenly lit.
const GLINTS = [
  { y: 0.08, dx: -6, len: 26, a: 0.16 },
  { y: 0.17, dx: 14, len: 44, a: 0.26 },
  { y: 0.26, dx: -22, len: 34, a: 0.14 },
  { y: 0.35, dx: 8, len: 62, a: 0.3 },
  { y: 0.45, dx: -34, len: 40, a: 0.15 },
  { y: 0.55, dx: 20, len: 74, a: 0.26 },
  { y: 0.65, dx: -12, len: 52, a: 0.14 },
  { y: 0.76, dx: 30, len: 86, a: 0.22 },
  { y: 0.87, dx: -26, len: 58, a: 0.12 },
];

// Faint texture away from the reflection, so the rest of the water is not dead flat.
const RIPPLES = [
  { x: 0.14, y: 0.3, len: 54, a: 0.07 },
  { x: 0.26, y: 0.62, len: 38, a: 0.06 },
  { x: 0.4, y: 0.44, len: 46, a: 0.05 },
  { x: 0.62, y: 0.72, len: 42, a: 0.06 },
  { x: 0.9, y: 0.38, len: 36, a: 0.05 },
];

// The water surfaces while the star is falling toward it.
function Sea({ t, w, h, horizonY, shoreY, moonX }) {
  const band = shoreY - horizonY;
  const reveal = useDerivedValue(() => easeOut(seg(t.value, T.seaIn)));

  return (
    <Group opacity={reveal}>
      <Rect x={-w} y={horizonY} width={w * 3} height={band}>
        <LinearGradient
          start={vec(0, horizonY)}
          end={vec(0, shoreY)}
          colors={[SEA_TOP, SEA_LOW]}
        />
      </Rect>

      {/* the soft column of moonlight the glints sit on */}
      <Rect x={moonX - 58} y={horizonY} width={116} height={band} opacity={0.12}>
        <LinearGradient
          start={vec(0, horizonY)}
          end={vec(0, shoreY)}
          colors={['#fff3c4', 'rgba(255,243,196,0)']}
        />
        <BlurMask blur={26} style="normal" />
      </Rect>

      {GLINTS.map((g, i) => (
        <Line
          key={`g${i}`}
          p1={vec(moonX + g.dx - g.len / 2, horizonY + band * g.y)}
          p2={vec(moonX + g.dx + g.len / 2, horizonY + band * g.y)}
          color="#fff6d4"
          opacity={g.a}
          style="stroke"
          strokeWidth={1.6}
        >
          <BlurMask blur={2.5} style="normal" />
        </Line>
      ))}

      {RIPPLES.map((r, i) => (
        <Line
          key={`r${i}`}
          p1={vec(w * r.x - r.len / 2, horizonY + band * r.y)}
          p2={vec(w * r.x + r.len / 2, horizonY + band * r.y)}
          color="#9fd8ff"
          opacity={r.a}
          style="stroke"
          strokeWidth={1.2}
        >
          <BlurMask blur={3} style="normal" />
        </Line>
      ))}
    </Group>
  );
}

// Starlight touching the water: a soft reflection plus two rings easing outward.
function SeaRipple({ t, x, y, at }) {
  const window = [at - 0.02, at + 0.2];

  const glow = useDerivedValue(() => {
    const p = seg(t.value, window);
    return p === 0 || p === 1 ? 0 : Math.sin(p * Math.PI) * 0.55;
  });

  const ringA = useDerivedValue(() => 8 + easeOut(seg(t.value, window)) * 120);
  const ringB = useDerivedValue(() => 8 + easeOut(seg(t.value, [window[0] + 0.06, window[1] + 0.06])) * 90);
  const fade = useDerivedValue(() => (1 - seg(t.value, window)) * 0.5);

  return (
    <Group opacity={glow}>
      <Oval x={x - 70} y={y - 9} width={140} height={18} color={BRAND_CYAN} opacity={0.4}>
        <BlurMask blur={16} style="normal" />
      </Oval>
      <RippleRing cx={x} cy={y} r={ringA} opacity={fade} />
      <RippleRing cx={x} cy={y} r={ringB} opacity={fade} />
    </Group>
  );
}

// Ripples read as flattened rings because the water is seen at a glancing angle.
function RippleRing({ cx, cy, r, opacity }) {
  const x = useDerivedValue(() => cx - r.value);
  const y = useDerivedValue(() => cy - r.value * 0.18);
  const width = useDerivedValue(() => r.value * 2);
  const height = useDerivedValue(() => r.value * 0.36);
  return (
    <Oval
      x={x}
      y={y}
      width={width}
      height={height}
      color="#bdeeff"
      opacity={opacity}
      style="stroke"
      strokeWidth={1.6}
    >
      <BlurMask blur={4} style="normal" />
    </Oval>
  );
}

// The cyan star: flashes into being among the yellow ones, then falls and settles.
function FallingStar({ t, startX, startY, ctrlX, ctrlY, landX, landY }) {
  const cx = useDerivedValue(() => bezier(startX, ctrlX, landX, smooth(seg(t.value, T.fall))));
  const cy = useDerivedValue(() => bezier(startY, ctrlY, landY, smooth(seg(t.value, T.fall))));

  const head = useDerivedValue(() => vec(cx.value, cy.value));
  // The tail lags along the curve's tangent and shortens as the star settles.
  const tail = useDerivedValue(() => {
    const p = seg(t.value, T.fall);
    const sp = smooth(p);
    const gx = bezierSlope(startX, ctrlX, landX, sp);
    const gy = bezierSlope(startY, ctrlY, landY, sp);
    const g = Math.max(1e-3, Math.hypot(gx, gy));
    const reach = 170 * Math.sin(Math.min(1, p) * Math.PI * 0.9);
    return vec(cx.value - (gx / g) * reach, cy.value - (gy / g) * reach);
  });

  const birth = useDerivedValue(() => {
    const flash = seg(t.value, T.spark);
    return flash === 0 || flash === 1 ? 0 : Math.sin(flash * Math.PI);
  });
  const birthR = useDerivedValue(() => 6 + seg(t.value, T.spark) * 44);

  const opacity = useDerivedValue(() => {
    const spark = easeOut(seg(t.value, T.spark));
    const swallowed = seg(t.value, T.gather);
    return spark * (1 - swallowed * 0.4);
  });

  const trailOpacity = useDerivedValue(() => {
    const p = seg(t.value, T.fall);
    return p > 0 && p < 1 ? Math.min(1, p * 5) * (1 - p * 0.25) : 0;
  });

  return (
    <>
      {/* the `반짝` that announces it */}
      <Circle cx={startX} cy={startY + 40} r={birthR} color="#ffffff" opacity={birth}>
        <BlurMask blur={18} style="normal" />
      </Circle>

      <Group opacity={opacity}>
        <Group opacity={trailOpacity}>
          <Line p1={tail} p2={head} style="stroke" strokeWidth={4} color={BRAND_CYAN}>
            <LinearGradient start={tail} end={head} colors={['rgba(0,207,233,0)', BRAND_CYAN]} />
            <BlurMask blur={7} style="normal" />
          </Line>
        </Group>
        <Circle cx={cx} cy={cy} r={17} color={BRAND_CYAN} opacity={0.32}>
          <BlurMask blur={20} style="normal" />
        </Circle>
        <Circle cx={cx} cy={cy} r={5} color="#eafcff">
          <BlurMask blur={3} style="solid" />
        </Circle>
      </Group>
    </>
  );
}

// Touchdown: two rings in the brand colour, plus a pool of light that outlives them
// so the wordmark reads as being born from the landing rather than fading in over it.
function Impact({ t, x, y }) {
  const ring = useDerivedValue(() => {
    const p = seg(t.value, T.impact);
    return p === 0 || p === 1 ? 0 : Math.sin(p * Math.PI) * 0.85;
  });
  const rOuter = useDerivedValue(() => 12 + easeOut(seg(t.value, T.impact)) * 122);
  const rInner = useDerivedValue(
    () => 10 + easeOut(seg(t.value, [T.impact[0] + 0.015, T.impact[1] + 0.03])) * 76
  );

  const after = useDerivedValue(() => {
    const rise = seg(t.value, T.impact);
    const fade = seg(t.value, [T.logo[1], 1.0]);
    return rise * (1 - fade) * 0.45;
  });
  const afterR = useDerivedValue(() => 58 + easeOut(seg(t.value, T.gather)) * 48);

  return (
    <>
      <Circle cx={x} cy={y} r={afterR} color={BRAND_CYAN} opacity={after}>
        <BlurMask blur={46} style="normal" />
      </Circle>
      <Group opacity={ring}>
        <Circle cx={x} cy={y} r={rOuter} color={BRAND_CYAN} style="stroke" strokeWidth={2.5}>
          <BlurMask blur={14} style="normal" />
        </Circle>
        <Circle cx={x} cy={y} r={rInner} color="#eafcff" style="stroke" strokeWidth={2}>
          <BlurMask blur={8} style="normal" />
        </Circle>
      </Group>
    </>
  );
}

// Cyan fog: draws inward around the star, holds, then opens and thins away so the
// wordmark resolves through it instead of popping in front of it.
function FogPuff({ t, puff, x, y }) {
  const k = useDerivedValue(() => {
    const gather = easeOut(seg(t.value, T.gather));
    const disperse = easeOut(seg(t.value, T.disperse));
    return 1 - 0.74 * gather + disperse * 1.8;
  });

  const opacity = useDerivedValue(() => {
    const gather = seg(t.value, T.gather);
    const disperse = seg(t.value, T.disperse);
    return Math.min(1, gather * 2.4) * (1 - disperse) * 0.42;
  });

  const cx = useDerivedValue(() => x + puff.dx * k.value);
  const cy = useDerivedValue(() => y + puff.dy * k.value);
  const r = useDerivedValue(() => puff.r * (0.68 + 0.62 * k.value));

  return (
    <Circle cx={cx} cy={cy} r={r} color={FOG} opacity={opacity}>
      <BlurMask blur={30} style="normal" />
    </Circle>
  );
}

// The blue light that spreads from the wordmark. Its radius drives the star recolour,
// so the ring and the colour change are the same event.
function WaveRing({ t, x, y, maxR }) {
  const front = useDerivedValue(() => easeOut(seg(t.value, T.wave)) * maxR);
  const trail = useDerivedValue(() => easeOut(seg(t.value, [T.wave[0] + 0.04, T.wave[1]])) * maxR);
  const opacity = useDerivedValue(() => {
    const p = seg(t.value, T.wave);
    return p === 0 ? 0 : (1 - p) * 0.75;
  });
  const soft = useDerivedValue(() => opacity.value * 0.4);

  return (
    <>
      <Circle cx={x} cy={y} r={front} color={BRAND_CYAN} style="stroke" strokeWidth={2.5} opacity={opacity}>
        <BlurMask blur={14} style="normal" />
      </Circle>
      <Circle cx={x} cy={y} r={trail} color="#bdeeff" style="stroke" strokeWidth={1.4} opacity={soft}>
        <BlurMask blur={8} style="normal" />
      </Circle>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: SKY_TOP,
  },
  logoWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skip: {
    position: 'absolute',
    top: 28,
    right: 28,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  skipText: {
    color: '#dbe6ff',
    fontSize: 14,
  },
});
