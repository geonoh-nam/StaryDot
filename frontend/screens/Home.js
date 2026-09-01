// What each tab behind the header shows: the character's room, the report, settings.
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../Typography';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { TABS } from '../ui/Header';
import { CharacterScreen } from './Character';
import { ParentReportScreen } from './ParentReport';
import { SettingsScreen } from './Settings';
import { QuizDebugScreen } from './QuizDebug';
import { QuizOverlay } from './Watch';

export function HomeScreen({ profile, tab = 'library', onBack, settings, onSettings, onEditProfile, onWipe, feed = 0, fed = 0, onFeed, report = {}, onJumpMoment, profiles = [], activeChild = 0, onPickChild, onAddChild, onOpenReport }) {
  const [previewQuiz, setPreviewQuiz] = useState(null);
  const [previewPick, setPreviewPick] = useState(null);

  return (
    <View style={styles.screen}>
      {previewQuiz ? (
        <QuizOverlay
          quiz={previewQuiz}
          selected={previewPick}
          tries={previewPick && previewPick !== previewQuiz.answer ? 1 : 0}
          onAnswer={setPreviewPick}
          onRetry={() => setPreviewPick(null)}
          onResume={() => { setPreviewQuiz(null); setPreviewPick(null); }}
          onSkip={() => { setPreviewQuiz(null); setPreviewPick(null); }}
        />
      ) : null}
      <View style={styles.tabScreen}>
            <View style={styles.tabHead}>
              <TouchableOpacity style={styles.backChip} onPress={onBack}>
                <Text style={styles.backChipText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.tabHeadTitle}>{(TABS.find((t) => t.key === tab) || {}).label}</Text>
            </View>
          {tab === 'quizdebug' ? (
            <QuizDebugScreen
              onPlay={(q, videoId, at) => {
                // Seeing it in place beats seeing it alone: play the video from just before the cue.
                if (videoId && onJumpMoment) onJumpMoment(videoId, at);
                else { setPreviewQuiz(q); setPreviewPick(null); }
              }}
            />
          ) : tab === 'parent' ? (
            <ParentReportScreen profile={profile} report={report} />
          ) : tab === 'character' ? (
            <CharacterScreen profile={profile} food={feed - fed} fed={fed} onFeed={onFeed} />
          ) : tab === 'settings' ? (
            <SettingsScreen
              profile={profile}
              settings={settings}
              onChange={onSettings}
              onEditProfile={onEditProfile}
              onWipe={onWipe}
              profiles={profiles}
              activeChild={activeChild}
              onPickChild={onPickChild}
              onAddChild={onAddChild}
              onOpenReport={onOpenReport}
            />
          ) : (
            <View style={styles.tabPlaceholder}>
              <Text style={styles.mainGreetingSub}>{(TABS.find((t) => t.key === tab) || {}).label} 화면은 준비 중이에요</Text>
            </View>
          )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 40,
    backgroundColor: COLORS.stage,
  },
  mainGreetingSub: {
    fontSize: 20,
    fontWeight: '700',
    color: TEXT_MUTED_ON_DARK,
    marginBottom: 18,
  },
  backChip: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    backgroundColor: '#f1f5ff',
  },
  backChipText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#171d31',
  },
  tabScreen: {
    flex: 1,
  },
  tabHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingBottom: 14,
  },
  tabHeadTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  tabPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
