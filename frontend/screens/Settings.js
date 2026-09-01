// Everything a grown-up can change after setup, and the one button that wipes it all.
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { ageLabel } from '../age';
import { DailyLimitPicker } from './Onboarding';

// The grown-ups' screen: what the child is allowed to do, and for how long.
export function SettingsScreen({ profile, settings, onChange, onEditProfile, onWipe, profiles = [], activeChild = 0, onPickChild, onAddChild, onOpenReport }) {
  const set = (patch) => onChange({ ...settings, ...patch });
  const act = (key) => set({ activities: { ...settings.activities, [key]: !settings.activities[key] } });
  return (
    <ScrollView contentContainerStyle={styles.settingsBody} showsVerticalScrollIndicator={false}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>아이</Text>
        {/* 한 패드를 형제가 나눠 쓴다. 탭하면 그 아이로 바뀌고, 나이에 맞는 문항이 따라온다. */}
        {(profiles.length ? profiles : [profile]).map((p, i) => (
          <TouchableOpacity
            key={`${p.name || '친구'}-${i}`}
            style={styles.settingsRow}
            onPress={() => onPickChild && onPickChild(i)}
          >
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsLabel}>{p.name || '친구'}</Text>
              <Text style={styles.settingsHint}>{ageLabel(p.birth) || '나이 미입력'}</Text>
            </View>
            <View style={[styles.pick, i === activeChild && styles.pickOn]}>
              <Text style={[styles.pickMark, i === activeChild && styles.pickMarkOn]}>
                {i === activeChild ? '보는 중' : '바꾸기'}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        <View style={styles.settingsButtons}>
          <TouchableOpacity style={styles.settingsEdit} onPress={onEditProfile}>
            <Text style={styles.settingsEditText}>프로필 수정</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsEdit} onPress={onAddChild}>
            <Text style={styles.settingsEditText}>프로필 추가</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>보호자 리포트</Text>
        <Text style={styles.settingsHint}>오늘 무엇을 보고 무엇을 어려워했는지 한눈에 봐요.</Text>
        <TouchableOpacity style={styles.settingsEdit} onPress={onOpenReport}>
          <Text style={styles.settingsEditText}>리포트 열기</Text>
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

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>계정 정보</Text>
        <TouchableOpacity style={styles.settingsRow} onPress={onEditProfile}>
          <View style={styles.settingsRowText}>
            <Text style={styles.settingsLabel}>프로필 추가</Text>
            <Text style={styles.settingsHint}>아이를 한 명 더 등록해요</Text>
          </View>
          <Text style={styles.settingsChevron}>›</Text>
        </TouchableOpacity>
        {/* Wipes the profile and growth data. */}
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => Alert.alert('계정 삭제', '저장된 프로필과 활동 기록이 모두 지워져요.', [
            { text: '취소', style: 'cancel' },
            { text: '삭제', style: 'destructive', onPress: onWipe },
          ])}
        >
          <View style={styles.settingsRowText}>
            <Text style={[styles.settingsLabel, styles.settingsDanger]}>계정 삭제</Text>
            <Text style={styles.settingsHint}>프로필과 활동 기록을 모두 지워요</Text>
          </View>
          <Text style={[styles.settingsChevron, styles.settingsDanger]}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>언어 설정</Text>
        <View style={styles.langRow}>
          {[['ko', '한국어'], ['en', 'English']].map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.langChip, (settings.language || 'ko') === key && styles.langChipOn]}
              onPress={() => set({ language: key })}
            >
              <Text style={[styles.langChipText, (settings.language || 'ko') === key && styles.langChipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.settingsHint}>지금은 한국어만 준비되어 있어요.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  settingsButtons: { flexDirection: 'row', gap: 10 },
  // 지금 보고 있는 아이를 한눈에 가른다.
  pick: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    backgroundColor: '#eef4ff',
  },
  pickOn: { backgroundColor: '#609EF5' },
  pickMark: { fontSize: 14, fontWeight: '800', color: '#609EF5' },
  pickMarkOn: { color: '#ffffff' },
  settingsChevron: {
    fontSize: 22,
    fontWeight: '900',
    color: '#a9b6cf',
  },
  settingsDanger: {
    color: '#d9534f',
  },
  langRow: {
    flexDirection: 'row',
    gap: 10,
  },
  langChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#e3e9f7',
  },
  langChipOn: {
    borderColor: '#609EF5',
    backgroundColor: '#eaf3ff',
  },
  langChipText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
  },
  langChipTextOn: {
    color: '#3859B9',
  },
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
