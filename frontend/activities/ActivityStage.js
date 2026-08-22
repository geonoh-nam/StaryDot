import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Buddy from './Buddy';
import CountIt from './CountIt';
import DragMatch from './DragMatch';
import FindIt from './FindIt';
import SayIt from './SayIt';
import { hintLevel } from './rules';

const KINDS = { findit: FindIt, drag: DragMatch, count: CountIt, say: SayIt };
const CHARACTERS = ['bunny', 'dino'];

// The frame every activity sits in. It owns the buddy and the hint ladder; the activity owns
// only its own board. One ladder in one place — four activities each running their own timer
// would drift apart.
export default function ActivityStage({ activity, onDone }) {
  const win = useWindowDimensions();
  const buddyRef = useRef(null);
  const hintAt = useRef(null);
  const settled = useRef(false);
  const solved = useRef(false);
  const pendingFinish = useRef(null);
  const solveRef = useRef(null);
  const hoppedAtLevel = useRef(null);
  // The ladder's clock: restarted whenever a fresh hint target arrives (see setHintAt below),
  // so it measures time without progress, not time since the activity opened.
  const startedAt = useRef(Date.now());
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [level, setLevel] = useState(0);

  // Picked once and kept for the whole activity: a voice that changes mid-sentence confuses
  // a three-year-old.
  const character = useMemo(
    () => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)],
    [activity]
  );

  const Body = KINDS[activity.type];

  const unmounted = useRef(false);
  useEffect(() => () => {
    unmounted.current = true;
  }, []);

  const finish = (ok) => {
    if (settled.current || unmounted.current) return;
    settled.current = true;
    onDone(ok);
  };

  const scheduleFinish = (ok, delay) => {
    // Mark solved right away, not just when the timeout fires — otherwise a child who finishes
    // a moment before the ladder's own timeout still gets the takeover line on top of their
    // own celebration.
    solved.current = true;
    pendingFinish.current = setTimeout(() => {
      pendingFinish.current = null;
      finish(ok);
    }, delay);
  };

  useEffect(() => {
    const id = setInterval(() => {
      if (settled.current) return;
      const next = hintLevel(Date.now() - startedAt.current);
      setLevel((prev) => (prev === next ? prev : next));
      if (next >= 3 && !solved.current) {
        solved.current = true;
        // The buddy solves it and celebrates with the child rather than leaving them stuck —
        // let the activity draw its own finished state first (ring drawn, item snapped, etc.).
        solveRef.current?.();
        if (hintAt.current) buddyRef.current?.moveTo(hintAt.current);
        buddyRef.current?.say('hint.solved');
        buddyRef.current?.react('right');
        scheduleFinish(true, 1800);
      }
    }, 500);
    return () => {
      clearInterval(id);
      if (pendingFinish.current) clearTimeout(pendingFinish.current);
    };
  }, [activity]);

  // Level 2 hops next to the answer, once per climb to level 2 — not once per hint change,
  // which used to fire on every CountIt tap and race CountIt's own move. Level 1 is the buddy
  // simply looking that way, which the art cannot express yet, so it is left silent on purpose.
  useEffect(() => {
    if (level < 2) {
      hoppedAtLevel.current = null;
      return;
    }
    if (level !== 2 || hoppedAtLevel.current === 2 || !hintAt.current) return;
    hoppedAtLevel.current = 2;
    buddyRef.current?.moveTo({ x: hintAt.current.x, y: hintAt.current.y - 0.18 });
    buddyRef.current?.react('right');
  }, [level]);

  if (!Body) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => finish(false)}
    >
      {/* A Modal mounts into its own native hierarchy, so a GestureHandlerRootView outside
          the Modal never reaches the gestures rendered inside it (react-native-gesture-handler
          docs, and see App.js's TraceWord/other Modal for the same fix). Without one here,
          DragMatch's Pan gesture receives no touches at all. */}
      <GestureHandlerRootView style={[styles.stage, { width: win.width, height: win.height }]}>
        <View
          style={[styles.stage, { width: win.width, height: win.height }]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setStage({ w: width, h: height });
          }}
        >
          {stage.w ? (
            <Body
              payload={activity.payload}
              buddy={buddyRef.current}
              stage={stage}
              onSolve={() => scheduleFinish(true, 1400)}
              solveRef={solveRef}
              setHintAt={(point) => {
                // A fresh target is progress — a counting child re-triggering this on every
                // tap should never lose ground toward the takeover, only a stalled child should.
                const prev = hintAt.current;
                const isNew = !prev || prev.x !== point.x || prev.y !== point.y;
                hintAt.current = point;
                if (isNew) startedAt.current = Date.now();
              }}
            />
          ) : null}
          <Buddy ref={buddyRef} character={character} stage={stage} />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
