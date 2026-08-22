import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

const ITEM_ART = {
  apple: require('../assets/scenes/candy.png'),
  star: require('../assets/characters/star-buddy.png'),
};

const ROW_Y = 0.34;
const DONE_DELAY_MS = 900; // let the spoken number land before the finishing line

// Counting is the activity — there is no number to pick. Each tap moves the buddy onto the
// thing just counted and it says the number out loud.
export default function CountIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [counted, setCounted] = useState(0);
  const slots = Array.from({ length: payload.n }, (_, i) => (i + 1) / (payload.n + 1));
  const doneTimer = useRef(null);

  // cells shrink once the row is crowded, so neighbours always keep a real gap
  const spacingPx = stage.w / (payload.n + 1);
  const cellSize = Math.min(120, spacingPx * 0.85);
  const artSize = cellSize * (96 / 120);

  useEffect(() => {
    setHintAt({ x: slots[0], y: ROW_Y });
    buddy?.say(payload.ask || 'quiz.ask');
    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, []);

  const tap = (index) => {
    if (index !== counted) return; // out-of-order taps are ignored, not punished
    const next = counted + 1;
    setCounted(next);
    buddy?.moveTo({ x: slots[index], y: Math.max(0.12, ROW_Y - 0.16) });
    buddy?.say(`count.n:${next}`);
    if (next >= payload.n) {
      doneTimer.current = setTimeout(() => {
        buddy?.say('count.done');
        buddy?.react('right');
        onSolve();
      }, DONE_DELAY_MS);
    } else {
      setHintAt({ x: slots[next], y: ROW_Y });
    }
  };

  return (
    <View style={styles.board} pointerEvents="box-none">
      {slots.map((x, i) => (
        <Pressable
          key={i}
          style={[
            styles.cell,
            {
              width: cellSize,
              height: cellSize,
              left: x * stage.w - cellSize / 2,
              top: ROW_Y * stage.h - cellSize / 2,
            },
            i < counted && styles.cellDone,
          ]}
          onPress={() => tap(i)}
        >
          <Image
            source={ITEM_ART[payload.item] || ITEM_ART.star}
            style={{ width: artSize, height: artSize }}
            resizeMode="contain"
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  cell: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  cellDone: {
    backgroundColor: '#e6f0ff',
  },
});
