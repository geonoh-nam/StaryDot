import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

// Rewritten by backend/server/tools/puzzle-frames.mjs — keep the marker comments.
// FIND_IMAGES_START
const FIND_IMAGES = {
  'teenieping-01-27': require('../assets/finds/teenieping-01-27.png'),
};
// FIND_IMAGES_END

// Every frame the tool extracts is cropped to this size (see puzzle-frames.mjs), so this is
// the image's real aspect ratio — the box below letterboxes to it, not to the stage's.
const IMAGE_W = 940;
const IMAGE_H = 529;

// The picture is drawn "contain"ed inside the stage, so it letterboxes on one axis. Both the
// tap and the ring must be measured against that inner box, not the stage — otherwise they
// drift apart on any stage whose aspect ratio differs from the image's.
function imageBox(stage) {
  const ratio = IMAGE_W / IMAGE_H;
  let w = stage.w;
  let h = w / ratio;
  if (h > stage.h) {
    h = stage.h;
    w = h * ratio;
  }
  return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
}

// Tap the picture to find something in it. A miss does nothing at all — no buzzer, no shake.
// The child keeps looking instead of learning they got it wrong.
export default function FindIt({ payload, buddy, stage, onSolve, setHintAt }) {
  const [found, setFound] = useState(false);

  useEffect(() => {
    setHintAt(payload.target);
    buddy?.say(payload.ask || 'quiz.ask');
  }, []);

  const box = imageBox(stage);

  const ring = payload.target.r * box.w;

  const onTap = (e) => {
    if (found) return;
    // Hit-test in the box's own pixels so the circle the child sees is the circle that counts —
    // isHit compares fractions of possibly different-length axes, which isn't circular here
    // since the box's aspect ratio (940:529) is never square.
    const dx = e.nativeEvent.locationX - (box.x + payload.target.x * box.w);
    const dy = e.nativeEvent.locationY - (box.y + payload.target.y * box.h);
    if (Math.hypot(dx, dy) > ring) return;
    setFound(true);
    buddy?.moveTo({ x: payload.target.x, y: Math.max(0.12, payload.target.y - 0.2) });
    buddy?.say('answer.right');
    buddy?.react('right');
    onSolve();
  };

  return (
    <Pressable style={styles.board} onPress={onTap}>
      {FIND_IMAGES[payload.image] ? (
        <Image
          source={FIND_IMAGES[payload.image]}
          style={[styles.art, { left: box.x, top: box.y, width: box.w, height: box.h }]}
          resizeMode="contain"
        />
      ) : null}
      {found ? (
        <View
          style={[
            styles.ring,
            {
              left: box.x + payload.target.x * box.w - ring,
              top: box.y + payload.target.y * box.h - ring,
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
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    borderWidth: 6,
    borderColor: '#609EF5',
  },
});
