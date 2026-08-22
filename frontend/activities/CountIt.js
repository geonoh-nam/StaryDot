import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

const ITEM_ART = {
  apple: require('../assets/scenes/candy.png'),
  star: require('../assets/characters/star-buddy.png'),
};

const ROW_Y = 0.34;

// Counting is the activity — there is no number to pick. Each tap moves the buddy onto the
// thing just counted and it says the number out loud.
export default function CountIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [counted, setCounted] = useState(0);
  const slots = Array.from({ length: payload.n }, (_, i) => (i + 1) / (payload.n + 1));

  useEffect(() => {
    setHintAt({ x: slots[0], y: ROW_Y });
    buddy?.say(payload.ask || 'quiz.ask');
  }, []);

  const tap = (index) => {
    if (index !== counted) return; // out-of-order taps are ignored, not punished
    const next = counted + 1;
    setCounted(next);
    buddy?.moveTo({ x: slots[index], y: Math.max(0.12, ROW_Y - 0.16) });
    buddy?.say(`count.n:${next}`);
    if (next >= payload.n) {
      buddy?.say('count.done');
      buddy?.react('right');
      onSolve();
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
            { left: x * stage.w - 60, top: ROW_Y * stage.h - 60 },
            i < counted && styles.cellDone,
          ]}
          onPress={() => tap(i)}
        >
          <Image
            source={ITEM_ART[payload.item] || ITEM_ART.star}
            style={styles.art}
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
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
  },
  cellDone: {
    backgroundColor: '#e6f0ff',
  },
  art: {
    width: 96,
    height: 96,
  },
});
