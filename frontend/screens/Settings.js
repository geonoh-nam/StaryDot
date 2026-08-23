// Everything a grown-up can change after setup, and the one button that wipes it all.
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { ageLabel } from '../age';
import { DailyLimitPicker } from './Onboarding';

// The grown-ups' screen: what the child is allowed to do, and for how long.
export function SettingsScreen({ profile, settings, onChange, onEditProfile }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const act = (key) => set({ activities: { ...settings.activities, [key]: !settings.activities[key] } });
  return (
    <ScrollView contentContainerStyle={styles.settingsBody} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>아이 정보</Text>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>이름</Text>
          <Text style={styles.settingsValue}>{profile.name || '친구'}</Text>
        </View>
        <View style={styles.settingsRow}>
          <Text style={styles.settingsLabel}>나이</Text>
          <Text style={styles.settingsValue}>{ageLabel(profile.birth) || '-'}</Text>
        </View>
        <TouchableOpacity style={styles.settingsEdit} onPress={onEditProfile}>
          <Text style={styles.settingsEditText}>프로필 수정</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>하루 사용 시간</Text>
        <DailyLimitPicker value={settings.dailyLimit} onSelect={(dailyLimit) => set({ dailyLimit })} />
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>활동</Text>
        {[
          ['quiz', '퀴즈', '영상 중간에 질문을 물어봐요'],
          ['trace', '그림', '영상이 끝나면 그림을 그려요'],
          ['puzzle', '퍼즐', '영상 중간에 퍼즐을 맞춰요'],
        ].map(([key, label, hint]) => (
          <TouchableOpacity key={key} style={styles.settingsRow} onPress={() => act(key)}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsLabel}>{label}</Text>
              <Text style={styles.settingsHint}>{hint}</Text>
            </View>
            <View style={[styles.toggle, settings.activities[key] && styles.toggleOn]}>
              <View style={[styles.toggleKnob, settings.activities[key] && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>소리</Text>
        <TouchableOpacity style={styles.settingsRow} onPress={() => set({ sound: !settings.sound })}>
          <View style={styles.settingsRowText}>
            <Text style={styles.settingsLabel}>효과음</Text>
            <Text style={styles.settingsHint}>버튼과 정답 소리를 켜요</Text>
          </View>
          <View style={[styles.toggle, settings.sound && styles.toggleOn]}>
            <View style={[styles.toggleKnob, settings.sound && styles.toggleKnobOn]} />
          </View>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  settingsBody: {
    gap: 14,
    paddingBottom: 24,
  },
  settingsCard: {
    gap: 12,
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#f4f7fe',
    borderWidth: 1,
    borderColor: '#e3e9f7',
  },
  settingsCardTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  settingsEdit: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
  },
  settingsEditText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#609EF5',
  },
  settingsHint: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a97b1',
  },
  settingsLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  settingsRowText: {
    flex: 1,
    gap: 2,
  },
  settingsValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#609EF5',
  },
  toggle: {
    width: 56,
    height: 32,
    borderRadius: 16,
    padding: 3,
    backgroundColor: '#dde5f5',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#ffffff',
  },
  toggleKnobOn: {
    marginLeft: 24,
  },
  toggleOn: {
    backgroundColor: '#609EF5',
  },
});
