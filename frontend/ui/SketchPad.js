// The canvas a child actually draws on: strokes go through perfect-freehand, the paint bucket
// walks a wall map built from the line art, and both are painted with Skia.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlphaType, Canvas, ColorType, Group, Image as SkiaImage, Path as SkiaPath, Skia, useImage } from '@shopify/react-native-skia';
import getStroke from 'perfect-freehand';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { COLORS, hexToRgb } from '../theme';
// Bucket fill over the line art. Walls are any pixel that is not near-white; several grown
// copies let a tap pick the strongest gap closing that still leaves its own region reachable,
// which is what stops paint escaping through the hairline breaks in the artwork.
const WALL_LEVELS = 3;

const EMPTY_FILLS = [];

// perfect-freehand outline -> SVG path string (filled shape)
function strokeToSvg(points, size) {
  if (!points || points.length === 0) return '';
  const outline = getStroke(points.map((p) => [p.x, p.y]), {
    size: Math.max(4, size * 2), thinning: 0, smoothing: 0.55, streamline: 0.5, simulatePressure: false, last: true,
  });
  if (!outline.length) return '';
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`;
  for (let i = 0; i < outline.length; i += 1) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`;
  }
  return `${d} Z`;
}

function buildWalls(src, w, h, threshold) {
  const wall = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    if (src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114 < threshold) wall[i] = 1;
  }
  const grown = [];
  let prev = wall;
  for (let level = 0; level < WALL_LEVELS; level += 1) {
    const next = Uint8Array.from(prev);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!prev[i]) continue;
        next[i - 1] = 1;
        next[i + 1] = 1;
        next[i - w] = 1;
        next[i + w] = 1;
      }
    }
    grown.push(next);
    prev = next;
  }
  return { wall, grown };
}

// Paint spreads over the open pixels of the chosen wall map, then creeps back into the walls so
// the anti-aliased edge sits on colour instead of a white halo. It never crosses a wall.
function floodFill(walls, out, w, h, startX, startY, rgb, owner, ownerId) {
  let level = WALL_LEVELS;
  while (level > 0 && walls.grown[level - 1][startY * w + startX]) level -= 1;
  if (level === 0 && walls.wall[startY * w + startX]) return false;
  const open = level === 0 ? walls.wall : walls.grown[level - 1];
  const seen = new Uint8Array(w * h);
  const stack = [startX, startY];
  const edge = [];
  let filled = 0;
  const paint = (i) => {
    const o = i * 4;
    out[o] = rgb[0];
    out[o + 1] = rgb[1];
    out[o + 2] = rgb[2];
    out[o + 3] = 255;
    if (owner) owner[i] = ownerId;
  };
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (seen[y * w + x]) continue;
    let left = x;
    while (left > 0 && !seen[y * w + left - 1] && !open[y * w + left - 1]) left -= 1;
    let right = x;
    while (right < w - 1 && !seen[y * w + right + 1] && !open[y * w + right + 1]) right += 1;
    for (let sx = left; sx <= right; sx += 1) {
      const i = y * w + sx;
      seen[i] = 1;
      paint(i);
      filled += 1;
      if (y > 0 && !seen[i - w] && !open[i - w]) stack.push(sx, y - 1);
      if (y < h - 1 && !seen[i + w] && !open[i + w]) stack.push(sx, y + 1);
      if (sx === left || sx === right || y === 0 || y === h - 1) edge.push(i);
    }
  }
  if (!filled) return false;
  // Creep back exactly as far as the walls were grown, plus the anti-aliased fringe itself.
  let ring = edge;
  for (let step = 0; step < level + 2; step += 1) {
    const next = [];
    for (let k = 0; k < ring.length; k += 1) {
      const i = ring[k];
      const around = [i - 1, i + 1, i - w, i + w];
      for (let n = 0; n < 4; n += 1) {
        const j = around[n];
        if (j < 0 || j >= w * h || seen[j] || !open[j]) continue;
        seen[j] = 1;
        paint(j);
        // Stop at the ink itself: creeping past a printed line would cross into its neighbour.
        if (!walls.wall[j]) next.push(j);
      }
    }
    ring = next;
  }
  return true;
}

// Keeps the zoomed canvas covering its frame: no blank gap, no drifting away at 1x.
function clampPan(value, size, zoom) {
  'worklet';
  const min = size * (1 - zoom);
  return Math.min(0, Math.max(min, value));
}

export function SketchPad({ strokes, onChange, onCanvasSize, placeholder, inkColor, transparent, backgroundImage, thickness = 8, overlayStrokes, bgOpacity = 0.4, straightLine = false, eraser = false, fillMode = false, fillColor = '#111111', fills = EMPTY_FILLS, onFill, onEraseStroke, onEraseFill }) {
  const [layout, setLayout] = useState({ width: 620, height: 380 });
  // In-progress stroke lives in local state so only THIS stroke re-renders per move
  // (committed strokes stay memoized) — that's what keeps writing latency GoodNotes-low.
  const activeRef = useRef(null);
  // 그리는 중인 획은 배열을 키워 가며 쓴다. 매 이벤트마다 통째로 복사하면 점이 N개일 때
  // 한 획에 N² 번 복사하게 되고, 빨리 그릴수록 JS 스레드가 복사에 붙들려 입력이 밀린다.
  // 화면 갱신은 이 눈금으로만 알린다 — 배열 자체는 같은 것을 계속 쓴다.
  const [tick, setTick] = useState(0);
  const redraw = () => setTick((n) => n + 1);
  // Palm rejection: once a stylus touches down, finger touches are ignored for a short
  // window — that window is exactly when a resting palm/knuckle lands next to the pen.
  const rejectRef = useRef(false);
  // Samsung reports a held S-Pen button as MotionEvent TOOL_TYPE_ERASER, which gesture-handler
  // surfaces as pointerType OTHER — so the pen button erases without any native code.
  const penEraseRef = useRef(false);

  // Pinch to zoom, two fingers to move. One finger always stays a pen, so drawing never fights
  // the viewport; stroke coordinates are converted back into canvas space before being stored.
  const scale = useSharedValue(1);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const moveAllowed = useSharedValue(false);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  // Frame size on the UI thread, so panning can be clamped to it.
  const boxW = useSharedValue(620);
  const boxH = useSharedValue(380);
  const viewTransform = useDerivedValue(() => [
    { translateX: originX.value },
    { translateY: originY.value },
    { scale: scale.value },
  ]);
  const toCanvas = (event) => ({
    ...event,
    x: (event.x - originX.value) / scale.value,
    y: (event.y - originY.value) / scale.value,
  });

  // Bucket fill: the line art is read once as raw pixels, and every fill accumulates into one
  // mask buffer that is turned into an SkImage painted between the line art and the strokes.
  const lineArt = useImage(backgroundImage);
  const srcPixelsRef = useRef(null);
  const wallsRef = useRef(null);
  const [fillImage, setFillImage] = useState(null);
  // The line art PNG has an opaque white background, so colour can never go under it. Rebuild it
  // once as ink-on-transparent, which lets the fill sit below the strokes and kills the halo.
  const [inkImage, setInkImage] = useState(null);


  const fillBox = () => {
    if (!lineArt) return null;
    const iw = lineArt.width();
    const ih = lineArt.height();
    const boxW = layout.width;
    const boxH = (boxW * ih) / iw;
    return { iw, ih, boxW, boxH, top: (layout.height - boxH) / 2 };
  };

  const readSource = () => {
    if (!lineArt) return null;
    const info = { width: lineArt.width(), height: lineArt.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
    if (!srcPixelsRef.current) srcPixelsRef.current = lineArt.readPixels(0, 0, info);
    return srcPixelsRef.current ? info : null;
  };

  useEffect(() => {
    if (!lineArt || inkImage) return;
    const info = readSource();
    if (!info) return;
    const src = srcPixelsRef.current;
    const ink = new Uint8Array(src.length);
    for (let i = 0; i < info.width * info.height; i += 1) {
      const o = i * 4;
      const lum = src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114;
      ink[o + 3] = lum >= 250 ? 0 : Math.round(255 - lum);
    }
    setInkImage(Skia.Image.MakeImage(info, Skia.Data.fromBytes(ink), info.width * 4));
  }, [lineArt]);

  // Stroke eraser: delete the item the pen touched — a whole stroke, or a whole bucket fill.
  const eraseAt = (rawEvent) => {
    const event = toCanvas(rawEvent);
    for (let i = (strokes || []).length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (!stroke) continue;
      const reach = Math.max(8, (stroke.thickness || thickness) * 1.5);
      const hit = stroke.some((p) => p && Math.hypot(p.x - event.x, p.y - event.y) <= reach);
      if (hit) {
        if (onEraseStroke) onEraseStroke(i);
        return;
      }
    }
    const box = fillBox();
    const owner = appliedRef.current.owner;
    if (!box || !owner) return;
    const px = Math.round((event.x * box.iw) / box.boxW);
    const py = Math.round(((event.y - box.top) * box.ih) / box.boxH);
    if (px < 0 || py < 0 || px >= box.iw || py >= box.ih) return;
    const id = owner[py * box.iw + px];
    if (id && onEraseFill) onEraseFill(id - 1);
  };

  const doFill = (rawEvent) => {
    const event = toCanvas(rawEvent);
    const box = fillBox();
    if (!box) return;
    const info = readSource();
    if (!info) return;
    if (!wallsRef.current) wallsRef.current = buildWalls(srcPixelsRef.current, box.iw, box.ih, 235);
    const px = Math.round((event.x * box.iw) / box.boxW);
    const py = Math.round(((event.y - box.top) * box.ih) / box.boxH);
    if (px < 0 || py < 0 || px >= box.iw || py >= box.ih) return;
    if (onFill) onFill({ x: px, y: py, color: fillColor });
  };

  // Fills are replayed from the parent's list, which is what makes undo/redo of a bucket work.
  // Appending keeps the previous buffer; only an undo has to replay from scratch.
  const appliedRef = useRef({ ops: [], buf: null, owner: null });
  useEffect(() => {
    const box = fillBox();
    if (!box) return;
    const info = readSource();
    if (!info) return;
    if (!fills.length) {
      appliedRef.current = { ops: [], buf: null, owner: null };
      setFillImage(null);
      return;
    }
    if (!wallsRef.current) wallsRef.current = buildWalls(srcPixelsRef.current, box.iw, box.ih, 235);
    const applied = appliedRef.current;
    const isAppend = applied.buf && applied.ops.length < fills.length
      && applied.ops.every((op, i) => op === fills[i]);
    const buf = isAppend ? applied.buf : new Uint8Array(box.iw * box.ih * 4);
    const owner = isAppend ? applied.owner : new Uint16Array(box.iw * box.ih);
    const offset = isAppend ? applied.ops.length : 0;
    const pending = isAppend ? fills.slice(offset) : fills;
    pending.forEach((op, i) => floodFill(wallsRef.current, buf, box.iw, box.ih, op.x, op.y, hexToRgb(op.color), owner, offset + i + 1));
    appliedRef.current = { ops: fills, buf, owner };
    setFillImage(Skia.Image.MakeImage(info, Skia.Data.fromBytes(buf), box.iw * 4));
  }, [fills, lineArt]);

  // Uniform width: kids want a predictable line, so neither stylus pressure nor speed
  // changes the stroke — only the selected pen size does.
  const makePoint = (event) => ({ x: event.x, y: event.y, w: thickness });

  const begin = (event) => {
    // Fingers only pan and pinch the page; painting is the stylus's job alone, so a resting
    // palm can never leave a mark.
    if (event.pointerType === PointerType.TOUCH) {
      rejectRef.current = true;
      return;
    }
    penEraseRef.current = event.pointerType !== PointerType.TOUCH && event.pointerType !== PointerType.STYLUS;
    if (__DEV__) console.log('[pen] pointerType', event.pointerType, 'stylusData', JSON.stringify(event.stylusData));
    if (fillMode || eraser) {
      // Bucket and eraser both act on whole items, so neither starts a stroke.
      rejectRef.current = true;
      if (eraser) eraseAt(event);
      else doFill(event);
      return;
    }
    rejectRef.current = false;
    activeRef.current = [makePoint(toCanvas(event))];
    redraw();
  };
  const extend = (event) => {
    if (rejectRef.current) {
      if (eraser) eraseAt(event); // dragging the eraser keeps rubbing items out
      return;
    }
    const prev = activeRef.current;
    if (!prev) return begin(event);
    // Ruler mode: keep only the start point and the current point → a straight line.
    const point = makePoint(toCanvas(event));
    if (straightLine) prev.length = 1;
    prev.push(point);
    redraw();
  };
  const end = () => {
    if (rejectRef.current) {
      rejectRef.current = false;
      return;
    }
    const stroke = activeRef.current;
    activeRef.current = null;
    redraw();
    if (stroke && stroke.length) {
      stroke.color = inkColor; // lock each stroke's color so later palette changes don't repaint it
      stroke.thickness = thickness; // lock its width too so later size changes don't repaint it
      stroke.eraser = eraser || penEraseRef.current; // eraser strokes clear ink (blendMode) without touching the background guide
      onChange((prev) => [...prev, stroke]);
    }
  };
  const handlersRef = useRef({ begin, extend, end });
  handlersRef.current = { begin, extend, end };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true) // stroke state lives on the JS thread; no worklet hop needed
        .minDistance(0) // draw from the very first pixel, and allow single-tap dots
        .maxPointers(1)
        .averageTouches(false)
        .onBegin((event) => handlersRef.current.begin(event))
        .onUpdate((event) => handlersRef.current.extend(event))
        .onFinalize(() => handlersRef.current.end()),
    []
  );

  const zoom = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onBegin((e) => {
        startScale.value = scale.value;
        startX.value = originX.value;
        startY.value = originY.value;
        focalX.value = e.focalX;
        focalY.value = e.focalY;
      })
      .onUpdate((e) => {
        const next = Math.min(6, Math.max(1, startScale.value * e.scale));
        const k = next / startScale.value;
        scale.value = next;
        originX.value = clampPan(focalX.value - (focalX.value - startX.value) * k, boxW.value, next);
        originY.value = clampPan(focalY.value - (focalY.value - startY.value) * k, boxH.value, next);
      });
    const move = Gesture.Pan()
      .minPointers(1)
      .averageTouches(true)
      .onBegin((e) => {
        moveAllowed.value = e.pointerType === PointerType.TOUCH;
        startX.value = originX.value;
        startY.value = originY.value;
      })
      .onUpdate((e) => {
        if (!moveAllowed.value) return;
        originX.value = clampPan(startX.value + e.translationX, boxW.value, scale.value);
        originY.value = clampPan(startY.value + e.translationY, boxH.value, scale.value);
      });
    const reset = Gesture.Tap().numberOfTaps(2).onEnd(() => {
      scale.value = 1;
      originX.value = 0;
      originY.value = 0;
    });
    return Gesture.Simultaneous(pinch, move, reset);
  }, []);

  // perfect-freehand outlines as filled SVG path strings; committed + overlay memoized
  // so they are NOT recomputed while an active stroke is being drawn.
  const committedPaths = useMemo(
    () => (strokes || [])
      .map((s, i) => ({ key: `p-${i}`, d: strokeToSvg(s && s.filter(Boolean), (s && s.thickness) || thickness), color: (s && s.color) || inkColor, eraser: !!(s && s.eraser) }))
      .filter((p) => p.d),
    [strokes, thickness, inkColor]
  );
  const overlayPaths = useMemo(
    () => (overlayStrokes || [])
      .map((s, i) => ({ key: `o-${i}`, d: strokeToSvg(s && s.filter(Boolean), thickness) }))
      .filter((p) => p.d),
    [overlayStrokes, thickness]
  );
  const committedLayer = useMemo(
    () => (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group transform={viewTransform}>
        {fillImage && fillGeom ? (
          <SkiaImage image={fillImage} x={0} y={fillGeom.top} width={fillGeom.boxW} height={fillGeom.boxH} fit="fill" />
        ) : null}
        {committedPaths.map((p) => (
          <SkiaPath key={p.key} path={p.d} color={p.eraser ? '#000' : p.color} blendMode={p.eraser ? 'clear' : undefined} />
        ))}
        {overlayPaths.map((p) => (
          <SkiaPath key={p.key} path={p.d} color="#111111" />
        ))}
        </Group>
      </Canvas>
    ),
    [committedPaths, overlayPaths, fillImage, fillGeom && fillGeom.top, fillGeom && fillGeom.boxW, fillGeom && fillGeom.boxH]
  );
  const fillGeom = fillBox();
  // 획 배열은 그리는 내내 같은 것이라 값 비교로는 바뀐 걸 알 수 없다. tick 이 바뀔 때만 다시 그린다.
  const activePath = useMemo(() => {
    const live = activeRef.current;
    return live && live.length ? strokeToSvg(live.filter(Boolean), thickness) : '';
  }, [tick, thickness]);
  const hasInk = committedPaths.length > 0 || overlayPaths.length > 0 || !!activePath;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, zoom)}>
    <View
      collapsable={false}
      style={[styles.sketchPad, transparent && styles.sketchPadTransparent]}
      onLayout={(event) => {
        const next = event.nativeEvent.layout;
        setLayout(next);
        boxW.value = next.width;
        boxH.value = next.height;
        if (onCanvasSize) {
          onCanvasSize({ width: next.width, height: next.height });
        }
      }}
    >
      {!transparent && !backgroundImage ? <View style={styles.gridLayer} pointerEvents="none" /> : null}
      {!hasInk && placeholder ? <Text style={styles.padPlaceholder}>{placeholder}</Text> : null}
      {committedLayer}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group transform={viewTransform}>
          {activePath ? <SkiaPath path={activePath} color={eraser || penEraseRef.current ? '#00000055' : inkColor} /> : null}
        </Group>
      </Canvas>
      {/* The printed lines stay on top: colouring over them must never bury the drawing. */}
      {inkImage && fillGeom ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Group transform={viewTransform}>
            <SkiaImage image={inkImage} x={0} y={fillGeom.top} width={fillGeom.boxW} height={fillGeom.boxH} fit="fill" opacity={bgOpacity} />
          </Group>
        </Canvas>
      ) : null}
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  sketchPad: {
    flex: 1,
    minHeight: 360,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  sketchPadTransparent: {
    flex: 1,
    position: 'relative',
    minHeight: undefined,
    borderWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.01)',
    zIndex: 3,
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    opacity: 0.92,
  },
  padPlaceholder: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    paddingVertical: 13,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: COLORS.blueSoft,
    color: COLORS.blueDark,
    fontSize: 20,
    fontWeight: '900',
  },
});
