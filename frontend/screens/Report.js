// The end-of-session round-up: what the child did, the words they met, and the picture they made.
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DEMO_VIDEO } from '../data/library';
import { playSound } from '../sound';
import { COLORS, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '../theme';
import { buttons } from '../ui/buttons';
import { GeneratedCharacter, PattiCharacter, StrokeArt } from '../ui/artwork';
import { TapScale } from '../ui/motion';

function ReportStat({ label, value, tone }) {
  return (
    <View style={styles.reportStat}>
      <Text style={[styles.reportStatValue, { color: tone }]}>{value}</Text>
      <Text style={styles.reportStatLabel}>{label}</Text>
    </View>
  );
}

export function ReportScreen({ report, characterImage, savedDrawing, onReplay, onOtherVideos, onCharacter }) {
  const today = new Date();
  const dateLine = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const watched = report.watched || DEMO_VIDEO.title;
  const completed = report.quiz + report.drawing;
  const interests = report.interests || [];
  return (
    <View style={styles.reportScreen}>
      <View style={styles.reportCardWide}>
        <View style={styles.reportHead}>
          <Text style={styles.reportTitle}>활동 리포트</Text>
          <Text style={styles.reportDate}>{dateLine} · {watched}</Text>
        </View>
        <View style={styles.reportBody}>
          <View style={styles.reportArtCol}>
            <Text style={styles.reportColLabel}>오늘의 작품</Text>
            <View style={styles.reportArtBox}>
              {characterImage ? (
                <GeneratedCharacter uri={characterImage} size={230} />
              ) : savedDrawing ? (
                <StrokeArt drawing={savedDrawing} size={230} />
              ) : (
                <>
                  <PattiCharacter tone="blue" size={1.1} />
                  <Text style={styles.reportArtCaption}>그림을 건너뛰었어요</Text>
                </>
              )}
            </View>
          </View>
          <View style={styles.reportSumCol}>
            <View style={styles.reportStatsRow}>
              <ReportStat label="퀴즈 정답" value={report.quiz} tone="#3d5afe" />
              <ReportStat label="그림 완성" value={report.drawing} tone="#7bd88f" />
              <ReportStat label="건너뜀" value={report.skip} tone="#ffb020" />
            </View>
            {interests.length ? (
              <View style={styles.reportChips}>
                {interests.map((t) => (
                  <View key={t} style={styles.reportChip}><Text style={styles.reportChipText}>#{t}</Text></View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.reportActions}>
          <TouchableOpacity style={buttons.lightButton} onPress={() => { playSound('pop'); onReplay(); }}>
            <Text style={buttons.lightButtonText}>영상 다시보기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={buttons.lightButton} onPress={() => { playSound('pop'); onOtherVideos(); }}>
            <Text style={buttons.lightButtonText}>다른 영상 보기</Text>
          </TouchableOpacity>
          <TapScale style={buttons.darkButton} onPress={() => { playSound('pop'); onCharacter(); }}>
            <Text style={buttons.darkButtonText}>캐릭터 보러가기</Text>
          </TapScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reportActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportArtBox: {
    width: 300,
    minHeight: 288,
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    // Picture frame: thick warm mount, thin dark rim, and a soft drop shadow.
    borderWidth: 10,
    borderColor: '#d9b382',
    shadowColor: '#171d31',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  reportArtCaption: {
    marginTop: 12,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 14,
    fontWeight: '800',
  },
  reportArtCol: {
    alignItems: 'center',
  },
  reportBody: {
    width: '100%',
    flexDirection: 'row',
    gap: 26,
    marginBottom: 24,
  },
  reportCardWide: {
    width: '92%',
    maxWidth: 1040,
    padding: 34,
    borderRadius: 28,
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#7ba3ff',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  reportChip: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.blueSoft,
  },
  reportChipText: {
    color: COLORS.blueDark,
    fontSize: 14,
    fontWeight: '900',
  },
  reportChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  reportColLabel: {
    color: TEXT_ON_DARK,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
  },
  reportDate: {
    marginTop: 7,
    color: TEXT_MUTED_ON_DARK,
    fontSize: 15,
    fontWeight: '800',
  },
  reportHead: {
    alignItems: 'center',
    marginBottom: 22,
  },
  reportScreen: {
    flex: 1,
    padding: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  reportStat: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: '#e3e9f7',
    shadowColor: '#64748b',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  reportStatLabel: {
    marginTop: 4,
    color: TEXT_ON_DARK,
    fontSize: 14,
    fontWeight: '900',
  },
  reportStatValue: {
    fontSize: 42,
    fontWeight: '900',
  },
  reportStatsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  reportSumCol: {
    flex: 1,
    justifyContent: 'center',
    // Frame and summary sit on the same baseline height.
    minHeight: 308,
  },
  reportTitle: {
    color: TEXT_ON_DARK,
    fontSize: 30,
    fontWeight: '900',
  },
});
