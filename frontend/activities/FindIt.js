import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { isHit } from './rules';

// Rewritten by backend/server/tools/puzzle-frames.mjs — keep the marker comments.
// FIND_IMAGES_START
const FIND_IMAGES = {
  'teenieping-01-27': require('../assets/finds/teenieping-01-27.png'),
};
// FIND_IMAGES_END

// Tap the picture to find something in it. A miss does nothing at all — no buzzer, no shake.
// The child keeps looking instead of learning they got it wrong.
export default function FindIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [found, setFound] = useState(false);

  useEffect(() => {
    setHintAt(payload.target);
    buddy?.say(payload.ask || 'quiz.ask');
  }, []);

  const onTap = (e) => {
    if (found) return;
    const point = {
      x: e.nativeEvent.locationX / stage.w,
      y: e.nativeEvent.locationY / stage.h,
    };
    if (!isHit(point, payload.target)) return;
    setFound(true);
    buddy?.moveTo({ x: payload.target.x, y: Math.max(0.12, payload.target.y - 0.2) });
    buddy?.say('answer.right');
    buddy?.react('right');
    onSolve();
  };

  const ring = payload.target.r * stage.w;

  return (
    <Pressable style={styles.board} onPress={onTap}>
      {FIND_IMAGES[payload.image] ? (
        <Image source={FIND_IMAGES[payload.image]} style={styles.art} resizeMode="cover" />
      ) : null}
      {found ? (
        <View
          style={[
            styles.ring,
            {
              left: payload.target.x * stage.w - ring,
              top: payload.target.y * stage.h - ring,
              width: ring * 2,
              height: ring * 2,
              borderRadius: ring,
            },
          ]}
        />
      ) : null}
    </Pressable>
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
  art: {
    width: '100%',
    height: '100%',
  },
  ring: {
    position: 'absolute',
    borderWidth: 6,
    borderColor: '#609EF5',
  },
});
