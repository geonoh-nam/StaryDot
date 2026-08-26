import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './Typography';
import Svg, { Polygon, Rect, Defs, ClipPath, Image as SvgImage } from 'react-native-svg';

const FRAME = require('./assets/puzzle_frame.png');
const BW = 940;
const BH = 529;
const SNAP_DIST = 55;

const computeGeom = (p) => {
  const xs = p.pts.map((q) => q[0]);
  const ys = p.pts.map((q) => q[1]);
  const minx = Math.min(...xs);
  const miny = Math.min(...ys);
  const maxx = Math.max(...xs);
  const maxy = Math.max(...ys);
  return {
    ...p,
    home: { x: minx, y: miny },
    w: maxx - minx,
    h: maxy - miny,
    local: p.pts.map((q) => [q[0] - minx, q[1] - miny]),
  };
};

// Random cut each round: grid of cells, each kept square or split into 2 triangles (random diagonal).
function makePieces() {
  const cols = 2 + Math.floor(Math.random() * 2); // 2-3
  const rows = 2;
  const cw = BW / cols;
  const ch = BH / rows;
  const raw = [];
  let id = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x0 = c * cw;
      const y0 = r * ch;
      const x1 = x0 + cw;
      const y1 = y0 + ch;
      const roll = Math.random();
      if (roll < 0.28) {
        // square / rectangle
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
      } else if (roll < 0.46) {
        // two triangles (diagonal ↘)
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [x1, y0], [x1, y1]] });
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [x1, y1], [x0, y1]] });
      } else if (roll < 0.64) {
        // two triangles (diagonal ↙)
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [x1, y0], [x0, y1]] });
        raw.push({ id: `p${id++}`, pts: [[x1, y0], [x1, y1], [x0, y1]] });
      } else if (roll < 0.82) {
        // slanted vertical cut → two parallelogram/trapezoid pieces
        const a = x0 + cw * 0.62;
        const b = x0 + cw * 0.38;
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [a, y0], [b, y1], [x0, y1]] });
        raw.push({ id: `p${id++}`, pts: [[a, y0], [x1, y0], [x1, y1], [b, y1]] });
      } else {
        // slanted horizontal cut → two parallelogram/trapezoid pieces
        const a = y0 + ch * 0.62;
        const b = y0 + ch * 0.38;
        raw.push({ id: `p${id++}`, pts: [[x0, y0], [x1, y0], [x1, b], [x0, a]] });
        raw.push({ id: `p${id++}`, pts: [[x0, a], [x1, b], [x1, y1], [x0, y1]] });
      }
    }
  }
  return raw.map(computeGeom);
}

const ptsStr = (pts) => pts.map((q) => `${q[0]},${q[1]}`).join(' ');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function PuzzleScreen({ image, onDone }) {
  // The scene the child just watched, when the activity carries one; the sample art otherwise.
  const ART = image || FRAME;
  const PIECES = useMemo(makePieces, []);
  const [layout, setLayout] = useState(null);
  const posRef = useRef(null); // [{x,y,placed}]
  const animRef = useRef(PIECES.map(() => new Animated.ValueXY({ x: 0, y: 0 })));
  const startRef = useRef({});
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  // Board geometry stays in BW/BH units; `fit` scales it to whatever room the screen gives, so a
  // bigger board never runs off the edges and the loose pieces keep a lane above and below it.
  const fit = layout ? Math.min((layout.w - 40) / BW, (layout.h - 260) / BH, 1) : 1;
  const bw = BW * fit;
  const bh = BH * fit;
  const boardLeft = layout ? (layout.w - bw) / 2 : 0;
  const boardTop = layout ? (layout.h - bh) / 2 : 0;

  // Scatter pieces around the board once we know the screen size (clamped on-screen).
  useEffect(() => {
    if (!layout || posRef.current) return;
    const step = (layout.w - 120) / 3;
    posRef.current = PIECES.map((pc, i) => {
      const col = Math.floor(i / 2);
      const bottom = i % 2 === 0;
      const x = clamp(24 + col * step, 8, layout.w - pc.w * fit - 8);
      const y = bottom ? layout.h - pc.h * fit - 16 : 16;
      animRef.current[i].setValue({ x, y });
      return { x, y, placed: false };
    });
    rerender();
  }, [layout, fit]);

  const responders = useMemo(() => {
    if (!layout) return [];
    return PIECES.map((pc, idx) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!posRef.current && !posRef.current[idx].placed,
        onMoveShouldSetPanResponder: () => !!posRef.current && !posRef.current[idx].placed,
        onPanResponderGrant: () => {
          startRef.current[idx] = { ...posRef.current[idx] };
        },
        onPanResponderMove: (e, g) => {
          const s = startRef.current[idx];
          if (!s) return;
          const next = {
            placed: false,
            x: clamp(s.x + g.dx, 0, layout.w - pc.w * fit),
            y: clamp(s.y + g.dy, 0, layout.h - pc.h * fit),
          };
          posRef.current[idx] = next;
          // Move the view directly: a React re-render per finger sample is what made it stutter.
          animRef.current[idx].setValue({ x: next.x, y: next.y });
        },
        onPanResponderRelease: () => {
          const tx = boardLeft + pc.home.x * fit;
          const ty = boardTop + pc.home.y * fit;
          const p = posRef.current[idx];
          if (Math.hypot(p.x - tx, p.y - ty) < SNAP_DIST) {
            posRef.current[idx] = { x: tx, y: ty, placed: true };
            // Snap home with a spring so the piece settles instead of jumping.
            Animated.spring(animRef.current[idx], {
              toValue: { x: tx, y: ty },
              useNativeDriver: false,
              speed: 20,
              bounciness: 8,
            }).start();
            rerender();
          }
          if (posRef.current.every((q) => q.placed)) {
            setTimeout(() => onDone(true), 700);
          }
        },
      })
    );
  }, [layout, boardLeft, boardTop, fit]);

  return (
    <View style={styles.overlay} onLayout={(e) => setLayout({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={styles.topic}>
        <Text style={styles.topicText}>조각을 알맞은 곳에 맞춰봐! 🧩</Text>
      </View>

      {layout ? (
        <Svg style={[styles.board, { left: boardLeft, top: boardTop }]} width={bw} height={bh} viewBox={`0 0 ${BW} ${BH}`}>
          <Rect x={0} y={0} width={BW} height={BH} fill="#dfe7f5" />
          <SvgImage href={ART} x={0} y={0} width={BW} height={BH} preserveAspectRatio="xMidYMid slice" opacity={0.3} />
          {/* Square frame: a thick outer rim with a thin inner line, so the board reads as a tray. */}
          <Rect x={5} y={5} width={BW - 10} height={BH - 10} fill="none" stroke="#609EF5" strokeWidth={10} />
          <Rect x={16} y={16} width={BW - 32} height={BH - 32} fill="none" stroke="#b9c8e6" strokeWidth={2} />
          {PIECES.map((pc) => (
            <Polygon key={pc.id} points={ptsStr(pc.pts)} fill="none" stroke="#ffffff" strokeWidth={2} />
          ))}
        </Svg>
      ) : null}

      {layout && posRef.current
        ? PIECES.map((pc, i) => {
            const p = posRef.current[i];
            return (
              <Animated.View
                key={pc.id}
                {...responders[i].panHandlers}
                style={[
                  styles.piece,
                  { width: pc.w * fit, height: pc.h * fit, transform: animRef.current[i].getTranslateTransform() },
                  p.placed && styles.piecePlaced,
                ]}
              >
                <Svg width={pc.w * fit} height={pc.h * fit} viewBox={`0 0 ${pc.w} ${pc.h}`}>
                  <Defs>
                    <ClipPath id={`clip-${pc.id}`}>
                      <Polygon points={ptsStr(pc.local)} />
                    </ClipPath>
                  </Defs>
                  <SvgImage
                    href={ART}
                    x={-pc.home.x}
                    y={-pc.home.y}
                    width={BW}
                    height={BH}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#clip-${pc.id})`}
                  />
                  <Polygon points={ptsStr(pc.local)} fill="none" stroke="#ffffff" strokeWidth={3} />
                </Svg>
              </Animated.View>
            );
          })
        : null}

      <TouchableOpacity style={styles.skip} onPress={() => onDone(false)}>
        <Text style={styles.skipText}>건너뛰기</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#f4f7fe',
  },
  board: {
    position: 'absolute',
  },
  piece: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 4,
  },
  piecePlaced: {
    zIndex: 3,
  },
  topic: {
    position: 'absolute',
    top: 22,
    alignSelf: 'center',
    zIndex: 6,
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: '#eef2ff',
    borderWidth: 1.5,
    borderColor: '#7c93f5',
  },
  topicText: {
    color: '#3a52c4',
    fontSize: 22,
    fontWeight: '900',
  },
  skip: {
    position: 'absolute',
    right: 34,
    bottom: 30,
    zIndex: 6,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe8f7',
  },
  skipText: {
    color: '#3a52c4',
    fontSize: 16,
    fontWeight: '900',
  },
});
