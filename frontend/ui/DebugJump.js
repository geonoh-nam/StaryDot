// A developer's shortcut panel: jump to any screen or activity without walking the whole app.
// Rendered only in development builds.
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ActivityStage from '../activities/ActivityStage';
import WheelFit from '../activities/WheelFit';
import { WHEEL_FRAMES } from '../data/wheels';
import { SERIES_ART } from '../data/library';

// Landing screen, per the mockup: wordmark, a greeting with the child's name highlighted,
// and the video cards fanned out underneath.
// Dev-only shortcut: every screen is one tap away while the flow is being built.
const DEBUG_SCREENS = [
  ['intro', '인트로'],
  ['welcome', '온보딩 안내'],
  ['loading', '로딩(패키지)'],
  ['package', '오늘의 묶음'],
  ['bye', '오늘 끝'],
  ['profile', '아이 프로필'],
  ['guardian', '보호자 설정'],
  ['main', '메인'],
  ['watch', '영상 재생'],
  ['activities', '활동 선택'],
  ['drawing', '그림 그리기'],
  ['report', '활동 리포트'],
];

const DEBUG_TABS = [
  ['quizdebug', '문제 목록'],
  ['character', '캐릭터'],
  ['settings', '설정'],
];

const DEBUG_ACTIVITIES = [
  ['따라 말하기', { type: 'say', payload: { word: '사과', listenMs: 5000 } }],
];

export function DebugJump({ onJump, onTab, onReset, contentUp }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  if (!__DEV__) return null;
  return (
    <View style={styles.debugWrap}>
      <TouchableOpacity style={styles.debugBtn} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.debugBtnText}>{open ? '✕' : '⚙'}</Text>
      </TouchableOpacity>
      {open ? (
        <>
          <Pressable style={styles.debugBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.debugPanel}>
            {/* Whether the content server answered tells us at a glance why the library is empty. */}
            <View style={styles.debugStatus}>
              <View style={[styles.debugDot, { backgroundColor: contentUp ? '#2fa96b' : '#e5484d' }]} />
              <Text style={styles.debugStatusText}>콘텐츠 서버 {contentUp ? '연결됨' : '끊김'}</Text>
            </View>

            <Text style={styles.debugGroup}>화면</Text>
            <View style={styles.debugChips}>
              {DEBUG_SCREENS.map(([key, label]) => (
                <TouchableOpacity key={key} style={styles.debugChip} onPress={() => { setOpen(false); onJump(key); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>탭</Text>
            <View style={styles.debugChips}>
              {DEBUG_TABS.map(([key, label]) => (
                <TouchableOpacity key={key} style={styles.debugChip} onPress={() => { setOpen(false); onTab(key); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>활동</Text>
            <View style={styles.debugChips}>
              <TouchableOpacity style={styles.debugChip} onPress={() => { setOpen(false); setPreview({ type: 'wheels', frame: 'teenieping-duo' }); }}>
                <Text style={styles.debugChipText}>5화 캐릭터 퍼즐</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.debugChip} onPress={() => { setOpen(false); setPreview({ type: 'wheels' }); }}>
                <Text style={styles.debugChipText}>화분 퍼즐</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.debugChip} onPress={() => { setOpen(false); setPreview({ type: 'wheels', frame: 'teenieping-faces' }); }}>
                <Text style={styles.debugChipText}>10화 실루엣 퍼즐</Text>
              </TouchableOpacity>
              {DEBUG_ACTIVITIES.map(([label, activity]) => (
                <TouchableOpacity key={activity.type} style={styles.debugChip} onPress={() => { setOpen(false); setPreview(activity); }}>
                  <Text style={styles.debugChipText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.debugGroup}>데이터</Text>
            <TouchableOpacity style={[styles.debugChip, styles.debugDanger]} onPress={() => { setOpen(false); onReset(); }}>
              <Text style={styles.debugDangerText}>저장 데이터 지우고 온보딩부터</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
      {preview?.type === 'wheels' ? (
        <Modal visible supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setPreview(null)}>
          <View style={styles.puzzlePreview}>
            <WheelFit {...WHEEL_FRAMES[preview.frame || 'teenieping-pots']} buddy={SERIES_ART.teenieping.thumb} onDone={() => setPreview(null)} />
          </View>
        </Modal>
      ) : preview ? <ActivityStage activity={preview} onDone={() => setPreview(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  puzzlePreview: { flex: 1, paddingBottom: 24, backgroundColor: '#F3F6F8' },
  debugWrap: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 90,
  },
  debugBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e3e9f7',
  },
  debugBtnText: {
    fontSize: 15,
    color: '#5b6b8c',
  },
  debugBackdrop: {
    position: 'absolute',
    top: -40,
    left: -40,
    width: 3000,
    height: 3000,
  },
  debugPanel: {
    marginTop: 6,
    width: 430,
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#0b1c4a',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  debugStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  debugDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  debugStatusText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5b6b8c',
  },
  debugGroup: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8a97b1',
  },
  debugChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  debugChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f1f5ff',
  },
  debugChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#171d31',
  },
  debugDanger: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffecec',
  },
  debugDangerText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#e5484d',
  },

});
