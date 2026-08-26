// Everything that happens on a canvas: the sketch pad itself, its toolbar and colour picker,
// the drawing screen, and the tracing overlays.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Modal, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Canvas, Path as SkiaPath, Skia, useFont } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { playSound, speak } from '../sound';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK, hexToRgb, rgbToHex } from '../theme';
import { buttons } from '../ui/buttons';
import { TapScale } from '../ui/motion';
import { Quote } from '../ui/Quote';
import { GeneratedCharacter, PattiCharacter, StrokeArt } from '../ui/artwork';
import { CenterPopup } from '../ui/CenterPopup';
import { SketchPad } from '../ui/SketchPad';
import { ACT_MSG } from '../data/activities';

// Recently mixed colours live outside React so every canvas screen shares one list.
const RECENT_COLORS = { list: [] };

const PICKER_LEVELS = [0.93, 0.85, 0.75, 0.65, 0.55, 0.45, 0.36, 0.27, 0.18];

// Grid of standard colours, mirroring the picker kids already see in Samsung Notes.
const PICKER_HUES = [0, 20, 40, 55, 80, 120, 160, 180, 200, 220, 245, 275, 300, 330];

const PEN_MIN = 1;

const PEN_MAX = 100;

// Slider units are 1-100, but a 100px radius is absurd on canvas: map it onto the pen radius
// range the fixed-size buttons used to cover (drawn width is about twice this).
const penPx = (value) => 1 + (value - 1) * 0.25;

// The four crayons every canvas offers before the mixer is opened.
const DRAW_COLORS = ['#111111', '#e5484d', '#00CFE9', '#f5c518'];


const TRACE_TOLERANCE = 26; // a five-year-old's hand wobbles; count near-misses as on the letter

const TRACE_GRID = 18;

// Trace a word over its own outline: the guide letters are a real glyph path, so "did the child
// stay on the letters?" is answered by asking the path, not by eyeballing a picture.
const TRACE_FONT = require('../assets/fonts/Pretendard-Bold.otf');

const TRACE_SIZE = 150;

const TRACE_LINEART = require('../assets/trace_lineart_v2.png');


function useRecentColors() {
  const [, bump] = useState(0);
  const add = (hex) => {
    if (!RECENT_COLORS.list.includes(hex)) RECENT_COLORS.list = [hex, ...RECENT_COLORS.list].slice(0, 8);
    bump((n) => n + 1);
  };
  return [RECENT_COLORS.list, add];
}

// One RGB channel, dragged like the pen-size rail.
function ChannelSlider({ label, value, tint, onChange }) {
  const [trackW, setTrackW] = useState(160);
  const pickRef = useRef(null);
  pickRef.current = (x) => onChange(Math.round(Math.min(1, Math.max(0, x / trackW)) * 255));
  const pan = useMemo(
    () => Gesture.Pan().runOnJS(true).minDistance(0).maxPointers(1)
      .onBegin((e) => pickRef.current(e.x))
      .onUpdate((e) => pickRef.current(e.x)),
    []
  );
  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelLabel}>{label}</Text>
      <GestureDetector gesture={pan}>
        <View style={styles.channelHit} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={styles.channelTrack} />
          <View style={[styles.channelFill, { width: `${(value / 255) * 100}%`, backgroundColor: tint }]} />
          <View style={[styles.channelThumb, { left: `${(value / 255) * 100}%` }]} />
        </View>
      </GestureDetector>
      <Text style={styles.channelValue}>{value}</Text>
    </View>
  );
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

function ColorPickerModal({ visible, initial, onCancel, onDone }) {
  const [tab, setTab] = useState('standard');
  const [color, setColor] = useState(initial);
  const [recent, addRecent] = useRecentColors();
  useEffect(() => {
    if (visible) setColor(initial);
  }, [visible, initial]);
  const rgb = hexToRgb(color);
  const setChannel = (i, v) => {
    const next = [...rgb];
    next[i] = v;
    setColor(rgbToHex(next));
  };
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel} supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      {/* Modal renders in its own native hierarchy, so gesture-handler needs a root here too. */}
      <GestureHandlerRootView style={styles.pickerBackdrop}>
        <View style={styles.pickerCard}>
          <View style={styles.pickerTabs}>
            {[{ k: 'standard', t: '표준' }, { k: 'custom', t: '사용자 지정' }].map((x) => (
              <TouchableOpacity key={x.k} style={[styles.pickerTab, tab === x.k && styles.pickerTabOn]} onPress={() => setTab(x.k)}>
                <Text style={styles.pickerTabText}>{x.t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'standard' ? (
            <View style={styles.pickerGrid}>
              <View style={styles.pickerCol}>
                {PICKER_LEVELS.map((l) => {
                  const c = hslToHex(0, 0, l);
                  return <TouchableOpacity key={`g${l}`} style={[styles.pickerCell, { backgroundColor: c }, color === c && styles.pickerCellOn]} onPress={() => setColor(c)} />;
                })}
              </View>
              {PICKER_HUES.map((h) => (
                <View key={h} style={styles.pickerCol}>
                  {PICKER_LEVELS.map((l) => {
                    const c = hslToHex(h, 0.85, l);
                    return <TouchableOpacity key={`${h}-${l}`} style={[styles.pickerCell, { backgroundColor: c }, color === c && styles.pickerCellOn]} onPress={() => setColor(c)} />;
                  })}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.pickerCustom}>
              <ChannelSlider label="R" value={rgb[0]} tint="#e5484d" onChange={(v) => setChannel(0, v)} />
              <ChannelSlider label="G" value={rgb[1]} tint="#46a758" onChange={(v) => setChannel(1, v)} />
              <ChannelSlider label="B" value={rgb[2]} tint="#3b82f6" onChange={(v) => setChannel(2, v)} />
            </View>
          )}

          <View style={styles.pickerReadout}>
            <View style={[styles.pickerPreview, { backgroundColor: color }]} />
            {[['색상 코드', color.toUpperCase()], ['빨간색', rgb[0]], ['녹색', rgb[1]], ['파란색', rgb[2]]].map(([label, value]) => (
              <View key={label} style={styles.pickerReadoutItem}>
                <Text style={styles.pickerReadoutLabel}>{label}</Text>
                <Text style={styles.pickerReadoutValue}>{value}</Text>
              </View>
            ))}
          </View>

          {recent.length ? (
            <View style={styles.swatchRow}>
              <Text style={styles.recentLabel}>자주 쓰는 색</Text>
              {recent.map((c) => (
                <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} onPress={() => setColor(c)} />
              ))}
            </View>
          ) : null}

          <View style={styles.pickerFooter}>
            <TouchableOpacity style={styles.pickerFooterBtn} onPress={onCancel}>
              <Text style={styles.pickerFooterText}>취소</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity style={styles.pickerFooterBtn} onPress={() => { addRecent(color); onDone(color); }}>
              <Text style={[styles.pickerFooterText, { color: '#609EF5' }]}>완료</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Toolbar palette: a few presets, the colours the child saved, and the full picker.
function ColorControls({ value, onChange, swatches }) {
  const [recent] = useRecentColors();
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.swatchRow}>
      {swatches.slice(0, 4).map((c) => (
        <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, value === c && styles.swatchOn]} onPress={() => onChange(c)} />
      ))}
      {recent.slice(0, 3).map((c) => (
        <TouchableOpacity key={c} style={[styles.swatchSmall, { backgroundColor: c }, value === c && styles.swatchOn]} onPress={() => onChange(c)} />
      ))}
      <TouchableOpacity style={[styles.swatch, styles.swatchMore, { backgroundColor: value }]} onPress={() => setPicking(true)}>
        <Text style={styles.swatchMoreText}>＋</Text>
      </TouchableOpacity>
      <ColorPickerModal
        visible={picking}
        initial={value}
        onCancel={() => setPicking(false)}
        onDone={(c) => { onChange(c); setPicking(false); }}
      />
    </View>
  );
}

// Strokes and bucket fills share one timeline so undo/redo walks them in the order they happened.
function useCanvasHistory() {
  const [strokes, setStrokes] = useState([]);
  const [fills, setFills] = useState([]);
  const [order, setOrder] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const addStroke = (updater) => {
    setStrokes(updater);
    setOrder((o) => [...o, 's']);
    setRedoStack([]);
  };
  const addFill = (op) => {
    setFills((f) => [...f, op]);
    setOrder((o) => [...o, 'f']);
    setRedoStack([]);
  };
  const undo = () => {
    const kind = order[order.length - 1];
    if (!kind) return;
    setOrder((o) => o.slice(0, -1));
    if (kind === 's') {
      setStrokes((prev) => {
        setRedoStack((r) => [...r, { kind, item: prev[prev.length - 1] }]);
        return prev.slice(0, -1);
      });
    } else {
      setFills((prev) => {
        setRedoStack((r) => [...r, { kind, item: prev[prev.length - 1] }]);
        return prev.slice(0, -1);
      });
    }
  };
  const redo = () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack((r) => r.slice(0, -1));
    setOrder((o) => [...o, last.kind]);
    if (last.kind === 's') setStrokes((prev) => [...prev, last.item]);
    else setFills((prev) => [...prev, last.item]);
  };
  // Stroke eraser: whichever item the pen touched disappears whole, so remove its slot from the
  // timeline too or undo would step onto an item that is no longer there.
  const dropAt = (kind, index) => {
    let seen = -1;
    setOrder((o) => {
      const at = o.findIndex((k) => k === kind && ++seen === index);
      return at < 0 ? o : [...o.slice(0, at), ...o.slice(at + 1)];
    });
    setRedoStack([]);
    if (kind === 's') setStrokes((prev) => prev.filter((_, i) => i !== index));
    else setFills((prev) => prev.filter((_, i) => i !== index));
  };
  const eraseStroke = (index) => dropAt('s', index);
  const eraseFill = (index) => dropAt('f', index);
  const clear = () => {
    setStrokes([]);
    setFills([]);
    setOrder([]);
    setRedoStack([]);
  };
  return { strokes, fills, addStroke, addFill, eraseStroke, eraseFill, undo, redo, clear, canUndo: order.length > 0, canRedo: redoStack.length > 0, setStrokes };
}

// Horizontal thickness control that lives in the toolbar strip, not on the canvas.
function SizeSlider({ value, color, onChange }) {
  const [trackW, setTrackW] = useState(120);
  const pickRef = useRef(null);
  pickRef.current = (x) => onChange(Math.round(PEN_MIN + Math.min(1, Math.max(0, x / trackW)) * (PEN_MAX - PEN_MIN)));
  const pan = useMemo(
    () => Gesture.Pan().runOnJS(true).minDistance(0).maxPointers(1)
      .onBegin((e) => pickRef.current(e.x))
      .onUpdate((e) => pickRef.current(e.x)),
    []
  );
  const ratio = (value - PEN_MIN) / (PEN_MAX - PEN_MIN);
  const dot = Math.max(4, Math.min(26, penPx(value) * 2));
  return (
    <View style={styles.sizeSlider}>
      <View style={styles.sizeDotWrap}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
      </View>
      <GestureDetector gesture={pan}>
        <View style={styles.channelHitSm} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={styles.channelTrack} />
          <View style={[styles.channelFill, { width: `${ratio * 100}%`, backgroundColor: '#609EF5' }]} />
          <View style={[styles.channelThumb, { left: `${ratio * 100}%` }]} />
        </View>
      </GestureDetector>
      <Text style={styles.channelValue}>{value}</Text>
    </View>
  );
}

// One toolbar strip above every canvas: tools, colours, thickness, undo/redo.
function CanvasToolbar({ tool, onTool, tools, color, onColor, swatches, size, onSize, onUndo, onRedo, canUndo, canRedo, onClear, right }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <TouchableOpacity style={styles.toolPeek} onPress={() => setOpen(true)}>
        <Text style={styles.toolChipIcon}>🎨</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.toolStrip}>
      <TouchableOpacity style={styles.iconBtn} onPress={() => setOpen(false)}>
        <Text style={styles.iconBtnText}>▾</Text>
      </TouchableOpacity>
      {tools.map((t) => (
        <TouchableOpacity key={t.key} style={[styles.toolChip, tool === t.key && styles.toolChipOn]} onPress={() => onTool(t.key)}>
          <Text style={styles.toolChipIcon}>{t.icon}</Text>
          <Text style={styles.toolChipText}>{t.label}</Text>
        </TouchableOpacity>
      ))}
      <View style={styles.toolDivider} />
      <ColorControls value={color} onChange={onColor} swatches={swatches} />
      <View style={styles.toolDivider} />
      <SizeSlider value={size} color={color} onChange={onSize} />
      <View style={styles.toolDivider} />
      <TouchableOpacity style={[styles.iconBtn, !canUndo && styles.iconBtnOff]} disabled={!canUndo} onPress={onUndo}>
        <Text style={styles.iconBtnText}>←</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.iconBtn, !canRedo && styles.iconBtnOff]} disabled={!canRedo} onPress={onRedo}>
        <Text style={styles.iconBtnText}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={onClear}>
        <Text style={styles.iconBtnText}>🗑</Text>
      </TouchableOpacity>
      {right}
    </View>
  );
}

export function DrawingScreen({ topic = '오늘의 그림', strokes, status, error, characterImage, onChangeStrokes, onCanvasSize, onConvert, onSave, onDone, onSkip }) {
  const [choosing, setChoosing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 620, height: 380 });
  const converting = status === 'loading' || (status === 'done' && !!characterImage) || status === 'error';
  const [brushColor, setBrushColor] = useState('#111111');
  const [brushSize, setBrushSize] = useState(5);
  const [eraserSize, setEraserSize] = useState(40);
  const [tool, setTool] = useState('brush'); // 'brush' | 'eraser' | 'ruler'
  const [redoStack, setRedoStack] = useState([]);
  const inkColor = tool === 'eraser' ? '#ffffff' : brushColor;
  const thickness = penPx(tool === 'eraser' ? eraserSize : brushSize);
  return (
    <View style={styles.drawingScreen}>
      {!converting && !choosing ? (
      <>
      <View style={styles.padRow}>
      <View style={styles.drawingCanvasCard}>
        <SketchPad
          strokes={strokes}
          onChange={onChangeStrokes}
          onCanvasSize={(size) => { setCanvasSize(size); onCanvasSize(size); }}
          placeholder={`여기에 ${topic}을 그려보세요`}
          inkColor={inkColor}
          thickness={thickness}
          straightLine={tool === 'ruler'}
          eraser={tool === 'eraser'}
          onEraseStroke={(i) => onChangeStrokes((prev) => prev.filter((_, k) => k !== i))}
        />
        <View style={styles.drawingTopic}>
          <Text style={styles.drawingTopicText}>주제 : {topic}</Text>
        </View>
      </View>
      </View>
      <CanvasToolbar
        tool={tool}
        onTool={setTool}
        tools={[{ key: 'brush', icon: '✏️', label: '붓' }, { key: 'eraser', icon: '🩹', label: '지우개' }, { key: 'ruler', icon: '📏', label: '자' }]}
        color={brushColor}
        onColor={(c) => { setBrushColor(c); setTool('brush'); }}
        swatches={DRAW_COLORS}
        size={tool === 'eraser' ? eraserSize : brushSize}
        onSize={tool === 'eraser' ? setEraserSize : setBrushSize}
        onUndo={() => onChangeStrokes((prev) => {
          if (!prev.length) return prev;
          setRedoStack((r) => [...r, prev[prev.length - 1]]);
          return prev.slice(0, -1);
        })}
        onRedo={() => {
          const last = redoStack[redoStack.length - 1];
          if (!last) return;
          setRedoStack((r) => r.slice(0, -1));
          onChangeStrokes((prev) => [...prev, last]);
        }}
        canUndo={strokes.length > 0}
        canRedo={redoStack.length > 0}
        onClear={() => { onChangeStrokes([]); setRedoStack([]); }}
        right={(
          <TouchableOpacity style={styles.checkTool} onPress={() => strokes.length && setChoosing(true)}>
            <Text style={styles.checkText}>✓</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.skipFloat} onPress={onSkip}>
        <Text style={styles.skipFloatText}>건너뛰기</Text>
      </TouchableOpacity>
      </>
      ) : null}
      {choosing ? (
        <View style={styles.reviewScreen}>
          <Text style={styles.reviewTitle}>다 그렸어요!</Text>
          <View style={styles.reviewFrame}>
            <StrokeArt drawing={{ strokes, size: canvasSize }} size={420} />
          </View>
          <View style={styles.creatorActions}>
            <TouchableOpacity style={buttons.lightButton} onPress={() => { playSound('pop'); setChoosing(false); onSave(); }}>
              <Text style={buttons.lightButtonText}>그림 저장</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.blueButton} onPress={() => { playSound('pop'); setChoosing(false); onConvert(); }}>
              <Text style={styles.blueButtonText}>그림 변환</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setChoosing(false)}>
            <Text style={styles.reviewBack}>더 그릴래요</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {converting ? (
        <View style={styles.convertOverlay}>
          <View style={styles.convertCard}>
            {status === 'loading' ? (
              <>
                <PattiCharacter tone="purple" size={0.9} />
                <Text style={styles.convertTitle}>그림 변환중...</Text>
                <Text style={styles.convertCopy}>그림을 귀여운 그림으로 만들고 있어요.</Text>
              </>
            ) : null}
            {status === 'done' && characterImage ? (
              <>
                <Text style={styles.convertTitle}>완성! 멋진 그림이 됐어요</Text>
                {/* Shown at canvas size: the child should see the picture, not a thumbnail. */}
                <View style={styles.convertFrame}>
                  <GeneratedCharacter uri={characterImage} size={Math.min(canvasSize.width, 560)} />
                </View>
                <View style={styles.creatorActions}>
                  <TouchableOpacity style={buttons.lightButton} onPress={() => { playSound('pop'); onSave(); }}>
                    <Text style={buttons.lightButtonText}>그림 저장</Text>
                  </TouchableOpacity>
                  <TapScale style={buttons.darkButton} onPress={() => { playSound('pop'); onDone(); }}>
                    <Text style={buttons.darkButtonText}>마무리하기</Text>
                  </TapScale>
                </View>
              </>
            ) : null}
            {status === 'error' ? (
              <>
                <Text style={styles.convertTitle}>앗, 변환에 실패했어요</Text>
                <Text style={styles.errorText}>{error}</Text>
                <View style={styles.creatorActions}>
                  <TouchableOpacity style={buttons.lightButton} onPress={onSkip}>
                    <Text style={buttons.lightButtonText}>건너뛰기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.blueButton} onPress={onConvert}>
                    <Text style={styles.blueButtonText}>다시 시도</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}


function judgeTrace(glyph, points) {
  if (!glyph || points.length < 12) return null;
  const near = (x, y) => {
    if (glyph.contains(x, y)) return true;
    for (let a = 0; a < 8; a += 1) {
      const t = (a * Math.PI) / 4;
      if (glyph.contains(x + Math.cos(t) * TRACE_TOLERANCE, y + Math.sin(t) * TRACE_TOLERANCE)) return true;
    }
    return false;
  };

  // How much of the writing landed on the letters.
  let on = 0;
  for (const p of points) if (near(p.x, p.y)) on += 1;
  const onRatio = on / points.length;

  // How much of the letters got written over: one scribble in a corner must not pass.
  const b = glyph.getBounds();
  let cells = 0;
  let covered = 0;
  for (let x = b.x; x < b.x + b.width; x += TRACE_GRID) {
    for (let y = b.y; y < b.y + b.height; y += TRACE_GRID) {
      if (!glyph.contains(x, y)) continue;
      cells += 1;
      if (points.some((p) => Math.abs(p.x - x) < TRACE_GRID * 1.6 && Math.abs(p.y - y) < TRACE_GRID * 1.6)) covered += 1;
    }
  }
  const coverRatio = cells ? covered / cells : 0;
  return { onRatio, coverRatio, pass: onRatio >= 0.7 && coverRatio >= 0.45 };
}

export function TraceWordOverlay({ word, onDone }) {
  const font = useFont(TRACE_FONT, TRACE_SIZE);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [strokes, setStrokes] = useState([]);
  const [live, setLive] = useState([]);
  const [verdict, setVerdict] = useState(null);

  const glyph = useMemo(() => {
    if (!font || !box.width) return null;
    const w = font.measureText(word).width;
    return Skia.Path.MakeFromText(word, (box.width - w) / 2, box.height / 2 + TRACE_SIZE * 0.35, font);
  }, [font, box.width, box.height, word]);

  const pen = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => setLive([{ x: e.x, y: e.y }]))
        .onUpdate((e) => setLive((prev) => [...prev, { x: e.x, y: e.y }]))
        .onEnd(() => {
          setLive((prev) => {
            if (prev.length) setStrokes((all) => [...all, prev]);
            return [];
          });
        }),
    []
  );

  const toPath = (pts) => {
    const p = Skia.Path.Make();
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    return p;
  };

  const check = () => {
    const result = judgeTrace(glyph, strokes.flat());
    if (!result) return;
    setVerdict(result);
    if (result.pass) {
      playSound('success');
      speak('correct');
    } else {
      playSound('wrong');
      speak('retry');
    }
  };

  return (
    <Modal transparent visible animationType="fade" presentationStyle="overFullScreen" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={onDone}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={styles.traceWordScrim}>
    <View style={styles.traceWord}>
      <Text style={styles.traceWordTitle}>{verdict ? (verdict.pass ? '잘 썼어요!' : '조금만 더 또박또박!') : `'${word}' 를 따라 써 볼까?`}</Text>

      <GestureDetector gesture={pen}>
        <View style={styles.traceWordPad} onLayout={(e) => setBox(e.nativeEvent.layout)} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill}>
            {glyph ? <SkiaPath path={glyph} color="#dfe6f5" /> : null}
            {strokes.map((st, i) => (
              <SkiaPath key={i} path={toPath(st)} color="#171d31" style="stroke" strokeWidth={12} strokeCap="round" strokeJoin="round" />
            ))}
            {live.length ? (
              <SkiaPath path={toPath(live)} color="#171d31" style="stroke" strokeWidth={12} strokeCap="round" strokeJoin="round" />
            ) : null}
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.traceWordActions}>
        <TouchableOpacity style={buttons.lightButton} onPress={() => { setStrokes([]); setVerdict(null); }}>
          <Text style={buttons.lightButtonText}>지우고 다시</Text>
        </TouchableOpacity>
        {verdict?.pass ? (
          <TapScale style={buttons.darkButton} onPress={() => { playSound('pop'); onDone(); }}>
            <Text style={buttons.darkButtonText}>영상 이어보기</Text>
          </TapScale>
        ) : (
          <TapScale style={styles.blueButton} onPress={check}>
            <Text style={styles.blueButtonText}>다 썼어요</Text>
          </TapScale>
        )}
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.traceWordSkip}>건너뛰기</Text>
        </TouchableOpacity>
      </View>
    </View>
    </View>
    </GestureHandlerRootView>
    </Modal>
  );
}

export function TraceOverlay({ onDone }) {
  const [mode, setMode] = useState('intro');
  const history = useCanvasHistory();
  const { strokes, fills } = history;
  const [color, setColor] = useState('#111111');
  const [penWidth, setPenWidth] = useState(5);
  const [eraserWidth, setEraserWidth] = useState(40);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser' | 'fill'
  const [showTopic, setShowTopic] = useState(false);
  const erasing = tool === 'eraser';
  const win = useWindowDimensions();
  const enter = useRef(new Animated.Value(0)).current;
  const praiseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, []);

  // Show a "한번 그려볼까?" intro page first, then reveal the tracing canvas.
  useEffect(() => {
    if (mode !== 'intro') return;
    const id = setTimeout(() => setMode('trace'), 2400);
    return () => clearTimeout(id);
  }, [mode]);

  // The prompt is a greeting, not a label: show it for two seconds when a stage starts.
  useEffect(() => {
    if (mode !== 'trace' && mode !== 'color') return undefined;
    setShowTopic(true);
    const id = setTimeout(() => setShowTopic(false), 2000);
    return () => clearTimeout(id);
  }, [mode]);

  const toColor = () => {
    playSound('success');
    setMode('praise');
  };

  // After tracing: "참 잘했어요" → "이제 색칠하러 가자!" → coloring.
  useEffect(() => {
    if (mode !== 'praise') return undefined;
    praiseAnim.setValue(0);
    Animated.spring(praiseAnim, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
    const id = setTimeout(() => setMode('colorIntro'), 1400);
    return () => clearTimeout(id);
  }, [mode]);
  useEffect(() => {
    if (mode !== 'colorIntro') return undefined;
    const id = setTimeout(() => {
      history.clear();
      setMode('color');
    }, 1500);
    return () => clearTimeout(id);
  }, [mode]);

  return (
    <Animated.View style={[styles.traceOverlay, { opacity: enter }]}>
        {mode === 'trace' || mode === 'color' ? (
          <CanvasToolbar
            tool={tool}
            onTool={setTool}
            tools={mode === 'color'
              ? [{ key: 'pen', icon: '✏️', label: '펜' }, { key: 'eraser', icon: '🩹', label: '지우개' }, { key: 'fill', icon: '🪣', label: '채우기' }]
              : [{ key: 'pen', icon: '✏️', label: '펜' }, { key: 'eraser', icon: '🩹', label: '지우개' }]}
            color={erasing ? '#9aa6bf' : color}
            onColor={setColor}
            swatches={DRAW_COLORS}
            size={erasing ? eraserWidth : penWidth}
            onSize={erasing ? setEraserWidth : setPenWidth}
            onUndo={history.undo}
            onRedo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onClear={history.clear}
            right={(
              <TapScale
                style={styles.checkTool}
                onPress={() => {
                  if (mode === 'trace') {
                    playSound('pop');
                    toColor();
                  } else {
                    playSound('fanfare');
                    onDone();
                  }
                }}
              >
                <Text style={styles.checkText}>✓</Text>
              </TapScale>
            )}
          />
        ) : null}

        {mode !== 'intro' ? (
          <View style={styles.padRow}>
          <SketchPad
            strokes={strokes}
            onChange={history.addStroke}
            placeholder=""
            inkColor={mode === 'color' ? color : '#111111'}
            backgroundImage={TRACE_LINEART}
            bgOpacity={mode === 'color' ? 1 : 0.4}
            thickness={penPx(erasing ? eraserWidth : penWidth)}
            eraser={erasing}
            fillMode={mode === 'color' && tool === 'fill'}
            fillColor={color}
            fills={fills}
            onFill={history.addFill}
            onEraseStroke={history.eraseStroke}
            onEraseFill={history.eraseFill}
          />
          </View>
        ) : null}

        {showTopic && (mode === 'trace' || mode === 'color') ? (
          <View style={styles.traceTopic}>
            <Text style={styles.traceTopicText}>{mode === 'trace' ? '선을 따라 그려봐! ✏️' : '원하는 색으로 칠해봐! 🎨'}</Text>
          </View>
        ) : null}

        {mode === 'praise' ? <CenterPopup text="참 잘했어요!" emoji="✓" /> : null}

        {mode === 'colorIntro' ? <CenterPopup text={ACT_MSG.color.text} emoji={ACT_MSG.color.emoji} /> : null}

        {mode === 'intro' ? (
          <TouchableOpacity activeOpacity={0.9} style={[styles.traceIntro, { width: win.width, height: win.height }]} onPress={() => setMode('trace')}>
            <PattiCharacter tone="purple" size={0.95} />
            <Quote>한번 그려볼까?</Quote>
            <Text style={styles.traceIntroHint}>화면을 톡 누르면 시작해요</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
  );
}

const styles = StyleSheet.create({
  blueButton: {
    minHeight: 58,
    paddingHorizontal: 24,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.blue,
  },
  blueButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  creatorActions: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  errorText: {
    marginTop: 12,
    color: '#c03744',
    fontSize: 15,
    fontWeight: '800',
  },
  traceWordScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    // Same as the quiz: the video stays visible behind the activity.
    backgroundColor: 'rgba(20,28,48,0.28)',
  },
  traceWord: {
    width: '82%',
    height: '88%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    borderRadius: 34,
    backgroundColor: '#ffffff',
  },
  traceWordTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#171d31',
  },
  traceWordPad: {
    width: '86%',
    flex: 1,
    borderRadius: 24,
    backgroundColor: '#f8faff',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  traceWordActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  traceWordSkip: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
  },
  traceOverlay: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  traceIntro: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: '#f4f7fe',
  },
  traceIntroHint: {
    marginTop: 6,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 18,
    fontWeight: '800',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  swatchOn: {
    borderColor: COLORS.ink,
    transform: [{ scale: 1.15 }],
  },
  traceTopic: {
    position: 'absolute',
    top: 22,
    alignSelf: 'center',
    zIndex: 5,
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 999,
    backgroundColor: '#eaf4ff',
    borderWidth: 1.5,
    borderColor: COLORS.blue,
  },
  traceTopicText: {
    color: COLORS.blueDark,
    fontSize: 22,
    fontWeight: '900',
  },
  reviewScreen: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 30,
    backgroundColor: '#ffffff',
    zIndex: 10,
  },
  reviewTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#171d31',
  },
  reviewFrame: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 10,
    borderColor: '#d9b382',
    shadowColor: '#171d31',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  reviewBack: {
    fontSize: 14,
    fontWeight: '800',
    color: '#5b6b8c',
  },
  convertOverlay: {
    // Fills the screen the way the review page does; absolute fill left it half-height.
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    backgroundColor: '#f1f5ff',
    zIndex: 10,
  },
  convertFrame: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 10,
    borderColor: '#d9b382',
  },
  convertCard: {
    minWidth: 420,
    maxWidth: '92%',
    padding: 28,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#f4f7fe',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
  },
  convertTitle: {
    color: TEXT_ON_DARK,
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
  },
  convertCopy: {
    color: TEXT_MUTED_ON_DARK,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  drawingScreen: {
    flex: 1,
    padding: 14,
    backgroundColor: '#ffffff',
  },
  drawingCanvasCard: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#188ddd',
    backgroundColor: '#ffffff',
  },
  drawingTopic: {
    position: 'absolute',
    top: 18,
    right: 22,
  },
  drawingTopicText: {
    color: '#171d31',
    fontSize: 20,
    fontWeight: '900',
  },
  checkTool: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#609EF5',
  },
  checkText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  skipFloat: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#f1f6ff',
  },
  skipFloatText: {
    color: COLORS.blueDark,
    fontSize: 16,
    fontWeight: '900',
  },
  padRow: {
    flex: 1,
  },
  toolPeek: {
    position: 'absolute',
    bottom: 14,
    left: 18,
    zIndex: 50,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  toolStrip: {
    alignSelf: 'center',
    marginTop: 10,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  toolChipOn: {
    backgroundColor: '#609EF5',
  },
  toolChipIcon: {
    fontSize: 16,
  },
  toolChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  toolDivider: {
    width: 1,
    height: 24,
    borderRadius: 1,
    backgroundColor: '#e6ecfa',
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  iconBtnOff: {
    opacity: 0.35,
  },
  iconBtnText: {
    fontSize: 17,
    color: TEXT_ON_DARK,
  },
  sizeSlider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sizeDotWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f1f5ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelHitSm: {
    width: 120,
    height: 26,
    justifyContent: 'center',
  },
  swatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  swatchMore: {
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#609EF5',
    borderWidth: 2,
  },
  swatchMoreText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  pickerBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,25,40,0.35)',
  },
  pickerCard: {
    gap: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#f4f7fe',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  pickerTabs: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'center',
  },
  pickerTab: {
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f1f5ff',
  },
  pickerTabOn: {
    backgroundColor: '#609EF5',
  },
  pickerTabText: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  pickerGrid: {
    flexDirection: 'row',
    alignSelf: 'center',
  },
  pickerCol: {
    flexDirection: 'column',
  },
  pickerCell: {
    width: 30,
    height: 26,
  },
  pickerCellOn: {
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  pickerCustom: {
    gap: 6,
    paddingVertical: 6,
  },
  pickerReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  pickerPreview: {
    width: 54,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  pickerReadoutItem: {
    alignItems: 'center',
  },
  pickerReadoutLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
  },
  pickerReadoutValue: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  pickerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 6,
  },
  pickerFooterBtn: {
    paddingHorizontal: 30,
    paddingVertical: 8,
  },
  pickerFooterText: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  swatchSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  recentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  channelLabel: {
    width: 14,
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  channelHit: {
    width: 170,
    height: 26,
    justifyContent: 'center',
  },
  channelTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#e3e9f7',
  },
  channelFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
  },
  channelThumb: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: '#f4f7fe',
    borderWidth: 3,
    borderColor: '#609EF5',
  },
  channelValue: {
    width: 30,
    fontSize: 11,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
    textAlign: 'right',
  },
});
