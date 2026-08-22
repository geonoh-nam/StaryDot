import { AudioModule, RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechPassed } from './rules';

const FLOOR = -35;
const WINDOW_TICK_MS = 250; // real clock, independent of whether metering reports a new value

// Did the child speak? Not what they said. See the spec — scoring a three-year-old's
// pronunciation marks normal speech wrong.
export default function SayIt({ payload, buddy, onSolve, setHintAt, solveRef }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const samples = useRef([]);
  const startedAt = useRef(0);
  const done = useRef(false);
  const windowTimer = useRef(null);
  const denyTimer = useRef(null);
  const wordTimer = useRef(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    setHintAt({ x: 0.5, y: 0.42 });
    // Stand beside the microphone circle instead of at home, same B-frame idea as the other
    // activities: the buddy is who's asking, so it belongs next to the thing it's asking about.
    buddy?.moveTo({ x: 0.72, y: 0.42 });
    let alive = true;
    // Say the word itself first — there's no recording yet, so the bubble text IS the word.
    // Then the invitation, held back so it doesn't overwrite the word before the child reads it.
    buddy?.say(payload.word);
    wordTimer.current = setTimeout(() => {
      if (!alive) return;
      buddy?.say('speak.listen');
    }, 1400);
    (async () => {
      const granted = await AudioModule.requestRecordingPermissionsAsync();
      if (!alive) return;
      // No microphone, no problem: the buddy already said the word and the turn passes anyway.
      if (!granted.granted) {
        denyTimer.current = setTimeout(() => onSolve(), 2500);
        return;
      }
      await recorder.prepareToRecordAsync();
      // Unmount can land here (back button, hint ladder force-solve) while we were awaiting
      // prepareToRecordAsync — the cleanup below already ran and found nothing to stop.
      if (!alive) {
        try { recorder.stop(); } catch (e) { /* already stopped */ }
        return;
      }
      startedAt.current = Date.now();
      recorder.record();
      // The retry window is driven by a real clock, not by metering ticks: a quiet room's
      // noise floor can quantize to the same dB reading across polls, which would otherwise
      // stall the "ask again" check indefinitely.
      windowTimer.current = setInterval(() => {
        if (done.current) return;
        if (Date.now() - startedAt.current > (payload.listenMs || 5000)) {
          samples.current = [];
          startedAt.current = Date.now();
          buddy?.say('speak.quiet');
        }
      }, WINDOW_TICK_MS);
    })();
    return () => {
      alive = false;
      if (wordTimer.current) clearTimeout(wordTimer.current);
      if (windowTimer.current) clearInterval(windowTimer.current);
      if (denyTimer.current) clearTimeout(denyTimer.current);
      try { recorder.stop(); } catch (e) { /* already stopped */ }
    };
  }, []);

  // The stage calls this when it takes the activity over at hint level 3 — fill the meter so
  // the board matches the buddy's line. A child who already spoke is left alone.
  useEffect(() => {
    if (!solveRef) return;
    solveRef.current = () => {
      if (done.current) return;
      done.current = true;
      if (windowTimer.current) clearInterval(windowTimer.current);
      try { recorder.stop(); } catch (e) { /* already stopped */ }
      setLevel(1);
    };
  }, []);

  useEffect(() => {
    if (done.current || !state.isRecording) return;
    const db = state.metering ?? -60;
    setLevel(Math.max(0, Math.min(1, (db - FLOOR) / 25 + 0.3)));
    samples.current.push({ db, atMs: Date.now() - startedAt.current });

    if (speechPassed(samples.current, { floor: FLOOR, holdMs: 400 })) {
      done.current = true;
      if (windowTimer.current) clearInterval(windowTimer.current);
      try { recorder.stop(); } catch (e) { /* already stopped */ }
      buddy?.say('answer.right');
      buddy?.react('right');
      onSolve();
    }
  }, [state.metering, state.isRecording]);

  return (
    <View style={styles.board} pointerEvents="none">
      <View style={styles.mic}>
        <Text style={styles.word}>{payload.word}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '18%',
    alignItems: 'center',
    gap: 20,
  },
  mic: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e6f0ff',
    borderWidth: 5,
    borderColor: '#609EF5',
  },
  word: {
    fontSize: 44,
    fontWeight: '900',
    color: '#171d31',
  },
  meterTrack: {
    width: 360,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#eef2fb',
    overflow: 'hidden',
  },
  meterFill: {
    height: 18,
    borderRadius: 9,
    backgroundColor: '#609EF5',
  },
});
