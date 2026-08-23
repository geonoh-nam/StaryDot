// What a grown-up reads: the month down the left, the moments the child made on their own in
// the middle, and what they keep coming back to on the right.
import React, { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { INTEREST_ART, MOCK_REPORT, PARENT_WEEKS, STAT_ART } from '../data/report';
import { playSound } from '../sound';
import { TEXT_ON_DARK } from '../theme';

// The rim is a gradient, so it has to be drawn — and a drawn rim needs the chip's real size.
function InterestChip({ label }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <View style={styles.parentChip} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {box.width ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={`chipRim-${label}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#609EF5" />
              <Stop offset="0.5" stopColor="#BADAFF" />
              <Stop offset="1" stopColor="#609EF5" />
            </LinearGradient>
          </Defs>
          <Rect
            x={0.8}
            y={0.8}
            width={box.width - 1.6}
            height={box.height - 1.6}
            rx={(box.height - 1.6) / 2}
            fill="none"
            stroke={`url(#chipRim-${label})`}
            strokeWidth={1.6}
          />
        </Svg>
      ) : null}
      {INTEREST_ART[label] ? <Image source={INTEREST_ART[label]} style={styles.parentChipArt} resizeMode="contain" /> : null}
      <Text style={styles.parentChipText}>{label}</Text>
    </View>
  );
}

export function ParentReportScreen({ profile, report, words }) {
  const [week, setWeek] = useState(0);
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const monthRef = useRef(null);
  // Minutes per day. Real numbers land here once sessions are recorded server-side; the week
  // selector shifts them so the screen behaves like the finished thing.
  const data = MOCK_REPORT[week];
  const newWords = words.slice(0, 4);
  const childName = profile?.name || '우리 아이';
  const moments = data.moments || MOCK_REPORT[0].moments;

  const stats = [
    { art: STAT_ART.book, value: data.stats.stories, unit: '편', label: '완성한 이야기', delta: data.deltas.stories },
    { art: STAT_ART.quiz, value: data.stats.quiz, unit: '개', label: '완료한 퀴즈', delta: data.deltas.quiz },
    { art: STAT_ART.puzzle, value: data.stats.puzzle, unit: '개', label: '완성한 퍼즐', delta: data.deltas.puzzle },
    { art: STAT_ART.paint, value: data.stats.drawing, unit: '개', label: '완료한 그림', delta: data.deltas.drawing },
  ];


  return (
    <View style={styles.parentScroll}>
      <View style={styles.parentBody}>
      <View style={styles.parentCol}>
        <Text style={styles.parentTitle}>부모 리포트</Text>
        <Text style={styles.parentSub}>이번 달 아이 학습에 대한 분석을 살펴보세요.</Text>

        <View style={styles.parentMonthWrap}>
          <TouchableOpacity style={styles.parentMonthNav} onPress={() => setMonth((m) => Math.max(1, m - 1))}>
            <Text style={styles.parentMonthArrow}>‹</Text>
          </TouchableOpacity>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.parentMonthRow}
            ref={monthRef}
            onLayout={() => monthRef.current?.scrollToEnd({ animated: false })}
          >
          {Array.from({ length: today.getMonth() + 1 }, (_, i) => i + 1).map((m) => (
            <TouchableOpacity key={m} onPress={() => { playSound('pop'); setMonth(m); }}>
              <View style={[styles.parentMonth, month !== m && styles.parentMonthOff]}>
                {month === m ? (
                  <Svg style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id="monthGrad" x1="0" y1="0" x2="0.6" y2="1">
                        <Stop offset="0" stopColor="#7db4ff" />
                        <Stop offset="1" stopColor="#2f62c4" />
                      </LinearGradient>
                    </Defs>
                    <Rect x="0" y="0" width="100%" height="100%" rx={42} fill="url(#monthGrad)" />
                  </Svg>
                ) : null}
                <Text style={[styles.parentMonthYear, month !== m && styles.parentMonthYearOff]}>{today.getFullYear()}</Text>
                <Text style={[styles.parentMonthNum, month !== m && styles.parentMonthNumOff]}>{m}</Text>
              </View>
            </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.parentMonthNav} onPress={() => setMonth((m) => Math.min(today.getMonth() + 1, m + 1))}>
            <Text style={styles.parentMonthArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {PARENT_WEEKS.map((label, i) => (
          <TouchableOpacity
            key={label}
            style={[styles.parentWeek, week === i && styles.parentWeekOn]}
            onPress={() => setWeek(i)}
          >
            <Text style={[styles.parentWeekText, week === i && styles.parentWeekTextOn]}>{month}월 {label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.parentDivider} />

      <View style={styles.parentColWide}>
        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>{childName}이가 자란 순간들</Text></View>
        <Text style={styles.parentHint}>이번 주 {childName}이가 <Text style={styles.parentHintOn}>스스로 해낸 순간들</Text>을 모아봤어요</Text>
        {moments.map((mo) => (
          <View key={mo.tag} style={styles.momentCard}>
            <Image source={mo.art} style={styles.momentArt} resizeMode="contain" />
            <Text style={styles.momentTag}>{mo.tag}</Text>
            <Text style={styles.momentHead}>
              <Text style={styles.momentHeadOn}>{mo.lead}</Text>{mo.head}
            </Text>
            <Text style={styles.momentBody}>{mo.body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.parentDivider} />

      <View style={styles.parentColRight}>
        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>숨은 관심사</Text></View>
        <Text style={styles.parentHint}>최근 2주 시청기록에서 반복적으로 등장한 주제 중심으로 3개 보여드려요</Text>
        <View style={styles.parentChips}>
          {data.interests.map((t) => (
            <InterestChip key={t} label={t} />
          ))}
        </View>

        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>이번 주 활동 요약</Text></View>
        <View style={styles.parentStatGrid}>
          {stats.map((st) => (
            <View key={st.label} style={styles.parentStat}>
              <View style={styles.parentStatHead}>
                <Image source={st.art} style={styles.parentStatArt} resizeMode="contain" />
                <Text style={styles.parentStatValue}>{st.value}</Text>
                <Text style={styles.parentStatUnit}>{st.unit}</Text>
              </View>
              <Text style={styles.parentStatLabel}>{st.label}</Text>
              <Text style={[styles.parentStatDelta, st.delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                지난주 대비 {Math.abs(st.delta)}{st.unit} {st.delta >= 0 ? '▲' : '▼'}
              </Text>
            </View>
          ))}
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deltaDown: {
    color: '#d9534f',
  },
  deltaUp: {
    color: '#2f8f5b',
  },
  momentArt: {
    position: 'absolute',
    right: 10,
    bottom: 6,
    width: 74,
    height: 74,
    opacity: 0.28,
  },
  momentBody: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    color: '#5b6b8c',
  },
  momentCard: {
    marginBottom: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: '#e4efff',
    overflow: 'hidden',
  },
  momentHead: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '900',
    color: '#171d31',
  },
  momentHeadOn: {
    color: '#609EF5',
  },
  momentTag: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8a97b1',
  },
  parentBody: {
    flex: 1,
    flexDirection: 'row',
    // Columns stretch to the tallest one, so the dividers run the full height.
    alignItems: 'stretch',
    gap: 16,
    padding: 22,
    borderRadius: 28,
    backgroundColor: '#D7EAFF',
  },
  parentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  parentChipArt: {
    width: 32,
    height: 32,
  },
  parentChipText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#171d31',
  },
  parentChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  parentCol: {
    width: 300,
    gap: 10,
  },
  parentColRight: {
    flex: 1,
    gap: 8,
  },
  parentColWide: {
    flex: 1.15,
    gap: 8,
  },
  parentDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#a9c8f2',
  },
  parentHint: {
    marginTop: 4,
    marginBottom: 14,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#8a97b1',
  },
  parentHintOn: {
    color: '#609EF5',
    textDecorationLine: 'underline',
  },
  parentMonth: {
    width: 84,
    height: 100,
    borderRadius: 42,
    overflow: 'hidden',
    opacity: 0.92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentMonthArrow: {
    paddingHorizontal: 6,
    fontSize: 26,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  parentMonthNav: {
    paddingHorizontal: 2,
  },
  parentMonthNum: {
    fontSize: 32,
    fontWeight: '900',
    color: '#ffffff',
  },
  parentMonthNumOff: {
    color: '#8a97b1',
  },
  parentMonthOff: {
    backgroundColor: '#eef3fd',
  },
  parentMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  parentMonthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  parentMonthYear: {
    fontSize: 13,
    fontWeight: '800',
    color: '#dbeafe',
  },
  parentMonthYearOff: {
    color: '#a9b6cf',
  },
  parentScroll: {
    flex: 1,
    paddingBottom: 20,
  },
  parentStat: {
    width: '47%',
    paddingVertical: 4,
  },
  parentStatArt: {
    width: 40,
    height: 40,
  },
  parentStatDelta: {
    marginLeft: 48,
    fontSize: 12,
    fontWeight: '800',
  },
  parentStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
  },
  parentStatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  parentStatLabel: {
    marginLeft: 48,
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_ON_DARK,
  },
  parentStatUnit: {
    fontSize: 15,
    fontWeight: '800',
    color: '#609EF5',
    marginBottom: 4,
  },
  parentStatValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#609EF5',
  },
  parentSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8a97b1',
  },
  parentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(96,158,245,0.4)',
  },
  parentTagStar: {
    fontSize: 15,
    color: '#3f7fe0',
  },
  parentTagText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#192853',
  },
  parentTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  parentWeek: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 26,
    overflow: 'hidden',
    // Solid base under the gradient: without it a dropped fill leaves an invisible button.
    backgroundColor: '#eef3fd',
  },
  parentWeekOn: {
    backgroundColor: '#ffffff',
    borderWidth: 2,
    borderColor: '#609EF5',
  },
  parentWeekText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8a97b1',
    textAlign: 'center',
  },
  parentWeekTextOn: {
    color: '#171d31',
  },
});
