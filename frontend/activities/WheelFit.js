import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';
import { Text } from '../Typography';
import { playSound, speak } from '../sound';
import { CenterPopup } from '../ui/CenterPopup';
import { nearestWheelSlot, wheelLayout } from './wheel-layout';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export default function WheelFit({ image, holes = [], onDone, inline = false, reserveDock = false, buddy }) {
  const [layout, setLayout] = useState(null);
  const [placed, setPlaced] = useState(() => holes.map(() => false));
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(-1);
  const [settling, setSettling] = useState(false);
  const [complete, setComplete] = useState(false);
  const placedRef = useRef(placed);
  const selectedRef = useRef(null);
  const busy = useRef(false);
  const positions = useRef([]);
  const start = useRef(null);
  const timer = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const motion = useRef(holes.map(() => ({
    position: new Animated.ValueXY(),
    fitted: new Animated.Value(0),
    lift: new Animated.Value(1),
  }))).current;
  const geometry = useMemo(() => layout ? wheelLayout(layout.w, layout.h, holes, inline, reserveDock) : null, [layout, holes, inline, reserveDock]);
  const count = placed.filter(Boolean).length;

  useEffect(() => () => {
    clearTimeout(timer.current);
    motion.forEach((m) => { m.position.stopAnimation(); m.fitted.stopAnimation(); m.lift.stopAnimation(); });
  }, [motion]);

  useEffect(() => {
    if (!geometry) return;
    busy.current = false;
    setSettling(false);
    selectedRef.current = null;
    setSelected(null);
    setHover(-1);
    positions.current = holes.map((_, i) => {
      const position = placedRef.current[i] ? geometry.targets[i] : geometry.homes[i];
      motion[i].position.stopAnimation();
      motion[i].position.setValue(position);
      motion[i].fitted.stopAnimation();
      motion[i].fitted.setValue(placedRef.current[i] ? 1 : 0);
      motion[i].lift.setValue(1);
      return position;
    });
  }, [geometry, holes, motion]);

  function select(i) {
    selectedRef.current = i;
    setSelected(i);
  }

  function settle(i, slot) {
    if (i === null || busy.current || placedRef.current[i]) return;
    busy.current = true;
    setSettling(true);
    setHover(-1);
    select(null);
    const correct = slot === i;
    const destination = correct ? geometry.targets[i] : geometry.homes[i];
    positions.current[i] = destination;
    // Position and size settle together without overshooting the original frame.
    const timing = { duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false };
    Animated.parallel([
      Animated.timing(motion[i].position, { ...timing, toValue: destination }),
      Animated.timing(motion[i].fitted, { ...timing, toValue: correct ? 1 : 0 }),
      Animated.timing(motion[i].lift, { ...timing, toValue: 1 }),
    ]).start(({ finished }) => {
      if (!finished) return;
      busy.current = false;
      setSettling(false);
      if (!correct) return;
      const next = placedRef.current.map((value, index) => value || index === i);
      placedRef.current = next;
      setPlaced(next);
      const all = next.length > 0 && next.every(Boolean);
      if (!all) playSound('success');
      if (all) {
        setComplete(true);
        speak('bunnyGood');
        timer.current = setTimeout(() => onDoneRef.current(true), 1800);
      }
    });
  }

  const responders = useMemo(() => geometry ? holes.map((_, i) => PanResponder.create({
    onStartShouldSetPanResponder: () => !busy.current && !placedRef.current[i],
    onMoveShouldSetPanResponder: () => !busy.current && !placedRef.current[i],
    onPanResponderGrant: () => {
      start.current = { ...positions.current[i] };
      select(i);
      playSound('pop');
      Animated.spring(motion[i].lift, { toValue: 1.08, speed: 30, bounciness: 3, useNativeDriver: false }).start();
    },
    onPanResponderMove: (_, gesture) => {
      if (!start.current || busy.current) return;
      const position = {
        x: clamp(start.current.x + gesture.dx, -geometry.size / 2, layout.w - geometry.size / 2),
        y: clamp(start.current.y + gesture.dy, -geometry.size / 2, layout.h - geometry.size / 2),
      };
      positions.current[i] = position;
      motion[i].position.setValue(position);
      setHover(nearestWheelSlot(position, geometry.targets, placedRef.current, geometry.snap));
    },
    onPanResponderRelease: (_, gesture) => {
      if (Math.hypot(gesture.dx, gesture.dy) < 6) {
        Animated.spring(motion[i].lift, { toValue: 1, useNativeDriver: false }).start();
        return;
      }
      settle(i, nearestWheelSlot(positions.current[i], geometry.targets, placedRef.current, geometry.snap));
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => settle(i, -1),
  })) : [], [geometry]);

  return (
    <View style={styles.root} onLayout={({ nativeEvent: { layout: next } }) => {
      setLayout((old) => old?.w === next.width && old?.h === next.height ? old : { w: next.width, h: next.height });
    }}>
      {geometry ? <>
        <Image source={image} resizeMode="stretch" style={[styles.board, {
          left: geometry.board.x, top: geometry.board.y, width: geometry.board.w, height: geometry.board.h,
        }]} />

        {holes.map((h, i) => placed[i] ? null : <Pressable
          key={h.id + '-slot'}
          accessibilityRole="button"
          accessibilityLabel={(i + 1) + '번째 빈자리'}
          disabled={selected === null || settling}
          onPress={() => settle(selectedRef.current, i)}
          style={[styles.slot, { left: geometry.targets[i].x, top: geometry.targets[i].y, width: geometry.size, height: geometry.size }]}
        >
          {h.crop ? <View pointerEvents="none" style={{ width: h.w * geometry.fit, height: h.h * geometry.fit }}>
            <PotArt hole={h} source={image} silhouette={hover === i ? '#31866F' : '#334457'} />
          </View> : <><Image source={h.image} resizeMode="stretch" style={{
            width: h.w * geometry.fit + 6, height: h.h * geometry.fit + 6,
            tintColor: hover === i ? '#86E3BC' : '#FFFFFF', opacity: hover === i ? 1 : 0.9,
          }} />
          <Image source={h.image} resizeMode="stretch" style={[styles.silhouette, {
            width: h.w * geometry.fit, height: h.h * geometry.fit,
            tintColor: hover === i ? '#31866F' : '#334457',
          }]} /></>}
        </Pressable>)}

        {!complete && <View pointerEvents="none" style={[styles.dock, {
          left: geometry.dock.x, top: geometry.dock.y, width: geometry.dock.w, height: geometry.dock.h,
        }]}>
          {holes.map((h, i) => <View key={h.id} style={[styles.home, {
            left: geometry.homes[i].x - geometry.dock.x, top: 8, width: geometry.size, height: geometry.size,
          }]}>{placed[i] ? <Text style={styles.check}>✓</Text> : null}</View>)}
        </View>}

        {holes.map((h, i) => {
          if (h.crop && placed[i]) return null;
          const m = motion[i];
          const artW = h.w * geometry.fit;
          const artH = h.h * geometry.fit;
          const enlarged = (geometry.size - 22) / Math.max(artW, artH);
          return <Animated.View key={h.id} {...responders[i].panHandlers}
            accessible={!placed[i]} accessibilityRole="button" accessibilityLabel={(i + 1) + '번째 조각 선택'}
            accessibilityState={{ selected: selected === i, disabled: placed[i] || settling }}
            accessibilityActions={[{ name: 'activate' }]}
            onAccessibilityAction={() => { if (!busy.current && !placedRef.current[i]) select(i); }}
            pointerEvents={placed[i] ? 'none' : 'auto'}
            style={[styles.piece, {
              width: geometry.size, height: geometry.size,
              zIndex: placed[i] ? 2 : selected === i ? 12 : 8,
              transform: [...m.position.getTranslateTransform(), { scale: m.lift }],
            }]}
          >
            <Animated.View pointerEvents="none" style={{
              width: m.fitted.interpolate({ inputRange: [0, 1], outputRange: [artW * enlarged, artW] }),
              height: m.fitted.interpolate({ inputRange: [0, 1], outputRange: [artH * enlarged, artH] }),
            }}>
              {h.crop ? <PotArt hole={h} source={image} /> : <Image source={h.image} resizeMode="stretch" resizeMethod="scale" style={styles.fill} />}
            </Animated.View>
          </Animated.View>;
        })}
        {complete ? <CenterPopup text="잘했어!" buddy={buddy} /> : null}
      </> : null}
    </View>
  );
}

function PotArt({ hole, source, silhouette }) {
  const { crop, outline, id } = hole;
  const clipId = 'pot-' + id;
  return <Svg width="100%" height="100%" viewBox={'0 0 ' + crop.w + ' ' + crop.h} preserveAspectRatio="none">
    {silhouette ? <Path d={outline} fill={silhouette} stroke="#F7FAFC" strokeWidth={1.2} /> : <>
      <Defs><ClipPath id={clipId}><Path d={outline} /></ClipPath></Defs>
      <SvgImage href={source} x={-crop.x} y={-crop.y} width={1920} height={1080}
        preserveAspectRatio="none" clipPath={'url(#' + clipId + ')'} />
    </>}
  </Svg>;
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#F3F6F8' },
  // 판 좌우로 남는 자리만 검게 둔다 — 영상이 contain 으로 앉을 때 생기는 그 검은 띠와 같은 자리다.
  // 위아래까지 검게 칠하면 조각을 놓아 두는 줄까지 어두워져 화면이 무거워진다.
  letterbox: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#000000' },
  board: { position: 'absolute' },
  header: {
    position: 'absolute', top: 12, left: 16, right: 16, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
  },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, borderRadius: 8, backgroundColor: '#FFFFFF' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#E2E8ED' },
  dotDone: { backgroundColor: '#329C7B' },
  count: { fontSize: 14, fontWeight: '800', color: '#496273', marginLeft: 5 },
  slot: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  silhouette: { position: 'absolute' },
  dock: {
    // 판 위에 겹쳐 뜨므로 반투명 어둠으로 깔아 조각이 그림에 묻히지 않게 한다.
    position: 'absolute', zIndex: 4, borderRadius: 18, backgroundColor: 'rgba(8,17,61,0.38)',
    shadowColor: '#152D40', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 4,
  },
  home: { position: 'absolute', borderRadius: 8, backgroundColor: '#EDF4F2', alignItems: 'center', justifyContent: 'center' },
  check: { color: '#329C7B', fontSize: 28, fontWeight: '800' },
  piece: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
});
