// The two setup steps a grown-up walks through once: who the child is, and how long they get.
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useRef, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { playSound } from '../sound';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { buttons } from '../ui/buttons';
import { PattiCharacter } from '../ui/artwork';
import { ageInMonths, ageLabel } from '../age';
import { TapScale } from '../ui/motion';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const THIS_YEAR = new Date().getFullYear();

// A birth date the child actually has: the day list follows the month that was picked.
const daysIn = (y, m) => (m ? new Date(y || THIS_YEAR, m, 0).getDate() : 31);

const HOUR_VALUES = [0, 1, 2, 3, 4, 5, 6];

// 5분 단위. 하루치 묶음이 35분처럼 딱 떨어지지 않는 길이로 나올 때, 10분 단위로는
// 설정과 실제가 5분씩 어긋난 채로 남는다.
const MINUTE_VALUES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// First run, step 2: the grown-up rules for the session.
// Each card is a vertical wheel: the number under the middle of the card is the selection.
const WHEEL_ITEM_H = 62;

const LIMIT_TRACK_W = 440;

// Toss-style opener: one promise, one button, nothing to decide yet.
export function OnboardIntroScreen({ onNext }) {
  return (
    <View style={styles.welcomeScreen}>
      <View style={styles.welcomeBody}>
        <Text style={styles.welcomeBadge}>시작하기 전에</Text>
        <Text style={styles.welcomeTitle}>아이에 대해 알아봐요!</Text>
        <Text style={styles.welcomeCopy}>
          이름과 나이를 알려주시면 아이에게 맞는 활동을 준비해요.{'\n'}
          사용 시간과 활동은 보호자가 정할 수 있어요.
        </Text>
      </View>
      <TapScale style={styles.welcomeButton} onPress={onNext}>
        <Text style={styles.welcomeButtonText}>시작하기</Text>
      </TapScale>
    </View>
  );
}

// First run, step 1: who is drawing today.
// Tap the circle to shoot a profile photo; the character stands in until there is one.
function ProfilePhotoPicker({ photo, tone, onPick }) {
  const take = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('카메라 권한 필요', '설정에서 카메라 권한을 허용하면 사진을 찍을 수 있어요.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!shot.canceled) onPick(shot.assets[0].uri);
  };

  return (
    <TouchableOpacity
      style={styles.photoCircle}
      onPress={take}
      accessibilityRole="button"
      accessibilityLabel={photo ? '프로필 사진 다시 찍기' : '프로필 사진 찍기'}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photoImage} />
      ) : (
        <PattiCharacter tone={tone} size={0.85} />
      )}
      {/* Rides the top edge of the circle, half in and half out. */}
      <Image source={CAMERA_ICON} style={styles.photoBadge} resizeMode="contain" />
    </TouchableOpacity>
  );
}

// Tap a field, pick from a scrolling list — the pattern grown-ups expect from a date field.
function BirthDropdown({ values, value, unit, onSelect }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);
  const index = Math.max(0, values.indexOf(value));
  return (
    <>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(true)}>
        <Text style={styles.dropdownValue}>{value != null ? `${value}${unit}` : `-${unit}`}</Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </TouchableOpacity>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)} supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.dropdownSheet}>
            <ScrollView
              ref={listRef}
              showsVerticalScrollIndicator={false}
              onLayout={() => listRef.current?.scrollTo({ y: Math.max(0, (index - 2) * 48), animated: false })}
            >
              {values.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.dropdownOption, v === value && styles.dropdownOptionOn]}
                  onPress={() => { onSelect(v); setOpen(false); }}
                >
                  <Text style={[styles.dropdownOptionText, v === value && styles.dropdownOptionTextOn]}>{v}{unit}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function ChildProfileScreen({ profile, onChange, onNext }) {
  const ready = profile.name.trim().length > 0 && ageInMonths(profile.birth) != null;
  return (
    <View style={styles.profileScreen}>
      <View style={styles.profileLeft}>
        <ProfilePhotoPicker
          photo={profile.photo}
          tone={profile.tone}
          onPick={(photo) => onChange({ ...profile, photo })}
        />
        <Text style={styles.photoHint}>아이 사진을 찍어서 프로필로 저장할 수 있어요!</Text>
      </View>

      <View style={styles.profileCard}>
        <Text style={styles.profileTitle}>스토리닷을 시작할{'\n'}아이 정보를 알려주세요</Text>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>아이 이름</Text>
          <TextInput
            style={styles.fieldInput}
            value={profile.name}
            onChangeText={(name) => onChange({ ...profile, name })}
            placeholder="예: 하늘"
            placeholderTextColor="#b6c1d6"
            maxLength={10}
          />
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>아이 생년월일</Text>
          <View style={styles.fieldValueRow}>
            <BirthDropdown
              values={range(THIS_YEAR - 8, THIS_YEAR)}
              value={profile.birth?.y}
              unit="년"
              onSelect={(y) => onChange({ ...profile, birth: { ...profile.birth, y, d: profile.birth?.d || 1 } })}
            />
            <BirthDropdown
              values={range(1, 12)}
              value={profile.birth?.m}
              unit="월"
              onSelect={(m) => onChange({ ...profile, birth: { ...profile.birth, m, d: Math.min(profile.birth?.d || 1, daysIn(profile.birth?.y, m)) } })}
            />
            <BirthDropdown
              values={range(1, daysIn(profile.birth?.y, profile.birth?.m))}
              value={profile.birth?.d}
              unit="일"
              onSelect={(d) => onChange({ ...profile, birth: { ...profile.birth, d } })}
            />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel} numberOfLines={1}>아이 성별(선택)</Text>
          <View style={[styles.fieldValueRow, styles.genderRow]}>
            {[['boy', '남자'], ['girl', '여자']].map(([key, label]) => (
              <TouchableOpacity key={key} onPress={() => onChange({ ...profile, gender: key })}>
                <Text style={[
                  styles.genderText,
                  profile.gender === key && (key === 'girl' ? styles.genderTextGirl : styles.genderTextOn),
                ]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TapScale
          style={[styles.nextBtn, !ready && buttons.buttonDisabled]}
          onPress={() => ready && onNext()}
        >
          <Text style={styles.nextBtnText}>다음</Text>
        </TapScale>
      </View>
    </View>
  );
}

function StepperCard({ values, value, label, onChange }) {
  const ref = useRef(null);
  const index = Math.max(0, values.indexOf(value));
  return (
    <View style={styles.stepperCol}>
      <View style={styles.stepperCard}>
        <Text style={styles.stepperArrowText}>⌃</Text>
        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_ITEM_H}
          decelerationRate="fast"
          style={styles.stepperViewport}
          onLayout={() => ref.current?.scrollTo({ y: index * WHEEL_ITEM_H, animated: false })}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
            const next = values[Math.min(values.length - 1, Math.max(0, i))];
            if (next !== value) { playSound('pop'); onChange(next); }
          }}
        >
          {values.map((v) => (
            <View key={v} style={styles.stepperItem}>
              <Text style={styles.stepperValue}>{String(v).padStart(2, '0')}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={[styles.stepperArrowText, styles.stepperArrowDown]}>⌄</Text>
      </View>
      <Text style={styles.stepperLabel}>{label}</Text>
    </View>
  );
}

export function DailyLimitPicker({ value, onSelect }) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return (
    <View style={styles.stepperRow}>
      <StepperCard
        values={HOUR_VALUES}
        value={hours}
        label="시간"
        onChange={(h) => onSelect(Math.max(10, h * 60 + minutes))}
      />
      <Text style={styles.stepperColon}>:</Text>
      <StepperCard
        values={MINUTE_VALUES}
        value={minutes}
        label="분"
        onChange={(m) => onSelect(Math.max(10, hours * 60 + m))}
      />
    </View>
  );
}

export function GuardianSetupScreen({ settings, onChange, onBack, onDone }) {
  return (
    <View style={styles.onboardScreen}>
      <View style={styles.onboardHeader}>
        <Text style={styles.onboardStep}>2 / 2</Text>
        <Text style={styles.onboardTitle}>보호자 설정</Text>
        <Text style={styles.onboardCopy}>사용 시간과 활동은 언제든 보호자 설정에서 바꿀 수 있어요.</Text>
      </View>

      <View style={[styles.onboardFields, styles.guardianFields]}>
        <Text style={styles.onboardLabel}>하루 사용 시간</Text>
        <DailyLimitPicker
          value={settings.dailyLimit}
          onSelect={(dailyLimit) => onChange({ ...settings, dailyLimit })}
        />

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => onChange({ ...settings, consent: !settings.consent })}
        >
          <View style={[styles.checkbox, settings.consent && styles.checkboxOn]}>
            <Text style={styles.checkboxMark}>{settings.consent ? '✓' : ''}</Text>
          </View>
          <View style={styles.consentTextWrap}>
            <Text style={styles.consentText}>
              <Text style={styles.consentRequired}>(필수) </Text>
              아이의 활동 기록·그림 데이터 수집 및 이용
            </Text>
            <Text style={styles.consentSub}>활동 응답과 그림은 보호자 리포트를 만드는 데만 쓰여요.</Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.onboardActions}>
        <TouchableOpacity style={buttons.lightButton} onPress={onBack}>
          <Text style={buttons.lightButtonText}>이전</Text>
        </TouchableOpacity>
        <TapScale style={[buttons.darkButton, !settings.consent && buttons.buttonDisabled]} onPress={() => settings.consent && onDone()}>
          <Text style={buttons.darkButtonText}>시작하기</Text>
        </TapScale>
      </View>
    </View>
  );
}

const CAMERA_ICON = require('../assets/characters/camera.png');

const styles = StyleSheet.create({
  profileScreen: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 60,
    paddingHorizontal: 40,
  },
  profileLeft: {
    alignItems: 'center',
    gap: 26,
  },
  photoHint: {
    fontSize: 15,
    fontWeight: '800',
    color: '#5891EA',
  },
  profileCard: {
    width: 510,
    gap: 14,
    padding: 30,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    borderWidth: 3,
    borderColor: '#bcd9ff',
  },
  profileTitle: {
    marginBottom: 8,
    fontSize: 25,
    lineHeight: 34,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Every row is the same height, whatever sits in it: three date boxes, a name, or two words.
    height: 76,
    gap: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#f1f3f7',
  },
  fieldLabel: {
    // Fixed, so the values on the right start at the same place in all three rows. Wide enough
    // that the longest of them — 아이 성별(선택) — stays on one line.
    width: 128,
    fontSize: 15,
    fontWeight: '800',
    color: '#8a97b1',
  },
  fieldInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 17,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  genderRow: {
    gap: 30,
    // Pulled in from the pill's edge so the two words do not crowd the rim.
    marginRight: 22,
  },
  genderTextGirl: {
    color: '#F07FA8',
  },
  genderText: {
    fontSize: 17,
    fontWeight: '900',
    color: '#8a97b1',
  },
  genderTextOn: {
    color: '#5891EA',
  },
  nextBtn: {
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: '#609EF5',
  },
  nextBtnText: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ffffff',
  },
  birthAge: {
    fontSize: 14,
    fontWeight: '800',
    color: '#609EF5',
  },
  birthRow: {
    flexDirection: 'row',
    gap: 10,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  checkboxMark: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
  },
  checkboxOn: {
    backgroundColor: '#609EF5',
    borderColor: '#609EF5',
  },
  consentRequired: {
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  consentRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    // Top-aligned so the box stays on the first line when the sentence wraps.
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  consentSub: {
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED_ON_DARK,
  },
  consentText: {
    fontSize: 13,
    lineHeight: 19,
    color: TEXT_ON_DARK,
  },
  consentTextWrap: {
    gap: 2,
    alignItems: 'center',
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    width: 84,
    height: 48,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  dropdownBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,28,60,0.3)',
  },
  dropdownCaret: {
    fontSize: 10,
    color: TEXT_MUTED_ON_DARK,
  },
  dropdownOption: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownOptionOn: {
    backgroundColor: '#609EF5',
  },
  dropdownOptionText: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT_ON_DARK,
  },
  dropdownOptionTextOn: {
    fontWeight: '900',
    color: '#04122b',
  },
  dropdownSheet: {
    width: 200,
    maxHeight: 320,
    borderRadius: 20,
    paddingVertical: 8,
    backgroundColor: '#f4f7fe',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  dropdownValue: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  guardianFields: {
    alignItems: 'center',
  },
  onboardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  onboardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 56,
  },
  onboardCopy: {
    fontSize: 14,
    color: TEXT_MUTED_ON_DARK,
  },
  onboardFields: {
    gap: 10,
    // Matches the picker track, and gives the consent sentence room to wrap cleanly.
    width: LIMIT_TRACK_W,
  },
  onboardHeader: {
    alignItems: 'center',
    gap: 4,
  },
  onboardInput: {
    width: 368,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 16,
    fontSize: 17,
    color: TEXT_ON_DARK,
    backgroundColor: '#f1f5ff',
    borderWidth: 1.5,
    borderColor: '#e3e9f7',
  },
  onboardLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  onboardScreen: {
    flex: 1,
    padding: 30,
    gap: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  onboardStep: {
    fontSize: 12,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  onboardTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  photoBadge: {
    position: 'absolute',
    top: -34,
    width: 74,
    height: 74,
  },
  photoCircle: {
    width: 300,
    height: 300,
    borderRadius: 150,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    backgroundColor: '#eaf3ff',
    borderWidth: 4,
    borderColor: '#bcd9ff',
  },
  photoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 150,
  },
  stepperArrowDown: {
    marginTop: -4,
  },
  stepperArrowText: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '900',
    color: COLORS.blue,
  },
  stepperCard: {
    width: 118,
    paddingVertical: 10,
    borderRadius: 22,
    alignItems: 'center',
    backgroundColor: COLORS.blueSoft,
  },
  stepperCol: {
    alignItems: 'center',
    gap: 8,
  },
  stepperColon: {
    marginTop: 44,
    fontSize: 30,
    fontWeight: '900',
    color: COLORS.blue,
  },
  stepperItem: {
    height: WHEEL_ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_MUTED_ON_DARK,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 14,
  },
  stepperValue: {
    fontSize: 42,
    lineHeight: 52,
    fontWeight: '900',
    color: COLORS.blue,
  },
  stepperViewport: {
    height: WHEEL_ITEM_H,
    alignSelf: 'stretch',
  },
  welcomeBadge: {
    fontSize: 14,
    fontWeight: '800',
    color: '#609EF5',
  },
  welcomeBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
  },
  welcomeButton: {
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#609EF5',
  },
  welcomeButtonText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
  },
  welcomeCopy: {
    fontSize: 16,
    lineHeight: 26,
    color: TEXT_MUTED_ON_DARK,
  },
  welcomeScreen: {
    flex: 1,
    padding: 40,
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
  },
  welcomeTitle: {
    fontSize: 40,
    lineHeight: 52,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
});
