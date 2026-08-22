import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
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
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [level, setLevel] = useState(0);
  const [hintAtTick, setHintAtTick] = useState(0);

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
    pendingFinish.current = setTimeout(() => {
      pendingFinish.current = null;
      finish(ok);
    }, delay);
  };

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (settled.current) return;
      const next = hintLevel(Date.now() - startedAt);
      setLevel((prev) => (prev === next ? prev : next));
      if (next >= 3 && !solved.current) {
        solved.current = true;
        // The buddy solves it and celebrates with the child rather than leaving them stuck.
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

  // Level 2 hops next to the answer. Level 1 is the buddy simply looking that way, which the
  // art cannot express yet, so it is left silent on purpose. Depends on hintAtTick too, so a
  // setHintAt that arrives after level has already settled at 2 still triggers the hop.
  useEffect(() => {
    if (!hintAt.current || level !== 2) return;
    buddyRef.current?.moveTo({ x: hintAt.current.x, y: Math.max(0.12, hintAt.current.y - 0.18) });
    buddyRef.current?.react('right');
  }, [level, hintAtTick]);

  if (!Body) return null;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={() => finish(false)}
    >
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
            setHintAt={(point) => {
              hintAt.current = point;
              setHintAtTick((n) => n + 1);
            }}
          />
        ) : null}
        <Buddy ref={buddyRef} character={character} stage={stage} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
});
