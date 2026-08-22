import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const ART = {
  hat: require('../assets/scenes/closet.png'),
  candy: require('../assets/scenes/candy.png'),
};

const ITEM_AT = { x: 0.26, y: 0.45 };
const SLOT_AT = { x: 0.68, y: 0.45 };
const SNAP_PX = 130;

// Carry the thing to where it belongs. Dropped short, it springs back — that reads as "not
// yet", where a buzzer would read as "you failed".
export default function DragMatch({ payload, buddy, stage, onSolve, setHintAt }) {
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const placed = useRef(false);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    setHintAt(SLOT_AT);
    buddy?.say(payload.ask || 'quiz.ask');
    // The buddy waits on the far side of the slot so it never sits under the child's finger.
    buddy?.moveTo({ x: Math.min(0.92, SLOT_AT.x + 0.18), y: SLOT_AT.y });
  }, []);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate((e) => {
          if (placed.current) return;
          pos.setValue({ x: e.translationX, y: e.translationY });
        })
        .onEnd((e) => {
          if (placed.current) return;
          const dropX = ITEM_AT.x * stage.w + e.translationX;
          const dropY = ITEM_AT.y * stage.h + e.translationY;
          const near =
            Math.hypot(dropX - SLOT_AT.x * stage.w, dropY - SLOT_AT.y * stage.h) < SNAP_PX;
          if (!near) {
            Animated.spring(pos, { toValue: { x: 0, y: 0 }, friction: 7, useNativeDriver: true }).start();
            // "거의 다 왔어!" — an encouragement, never a verdict.
            buddy?.say('answer.again');
            buddy?.react('again');
            return;
          }
          placed.current = true;
          setFilled(true);
          Animated.spring(pos, {
            toValue: {
              x: (SLOT_AT.x - ITEM_AT.x) * stage.w,
              y: (SLOT_AT.y - ITEM_AT.y) * stage.h,
            },
            friction: 7,
            useNativeDriver: true,
          }).start();
          buddy?.say('answer.right');
          buddy?.react('right');
          onSolve();
        }),
    [stage.w, stage.h]
  );

  return (
    <View style={styles.board} pointerEvents="box-none">
      <View
        style={[
          styles.slot,
          { left: SLOT_AT.x * stage.w - 75, top: SLOT_AT.y * stage.h - 75 },
          filled && styles.slotFilled,
        ]}
      />
      <GestureDetector gesture={drag}>
        <Animated.View
          style={[
            styles.item,
            { left: ITEM_AT.x * stage.w - 60, top: ITEM_AT.y * stage.h - 60 },
            { transform: pos.getTranslateTransform() },
          ]}
        >
          <Image source={ART[payload.item] || ART.candy} style={styles.art} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
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
  slot: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 28,
    borderWidth: 5,
    borderStyle: 'dashed',
    borderColor: '#b6c8e8',
  },
  slotFilled: {
    borderStyle: 'solid',
    borderColor: '#609EF5',
  },
  item: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    width: 110,
    height: 110,
  },
});
