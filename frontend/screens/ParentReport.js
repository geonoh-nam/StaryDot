// What a grown-up reads: the month down the left, the moments the child made on their own in
// the middle, and what they keep coming back to on the right.
import React, { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TextInput } from '../Typography';
import Svg, { Defs, FeGaussianBlur, Filter, LinearGradient, Rect, Stop } from 'react-native-svg';
import { INTEREST_ART, MOCK_REPORT, PARENT_WEEKS, STAT_ART } from '../data/report';
import { playSound } from '../sound';
import { TEXT_ON_DARK } from '../theme';

// How wide one month page is, so a swipe lands on exactly one.
const MONTH_PAGE = 180;

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
            x={1.5}
            y={1.5}
            width={box.width - 3}
            height={box.height - 3}
            rx={(box.height - 3) / 2}
            fill="none"
            stroke={`url(#chipRim-${label})`}
            strokeWidth={3}
          />
        </Svg>
      ) : null}
      {INTEREST_ART[label] ? <Image source={INTEREST_ART[label]} style={styles.parentChipArt} resizeMode="contain" /> : null}
      <Text style={styles.parentChipText}>{label}</Text>
    </View>
  );
}

// The picked week wears a gradient fill inside a gradient rim; both are drawn, since a React
// Native border takes one flat colour — and a drawn rim needs the pill's real size.
function WeekPill({ label, index, on, onPress }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <TouchableOpacity
      style={[styles.parentWeek, on && styles.parentWeekOn]}
      onPress={onPress}
      onLayout={(e) => setBox(e.nativeEvent.layout)}
    >
      {on && box.width ? (
        <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id={`weekRim-${index}`} x1="0" y1="0" x2="1" y2="0.6">
              <Stop offset="0" stopColor="#BADAFF" />
              <Stop offset="1" stopColor="#3859B9" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={box.width} height={box.height} rx={box.height / 2} fill="#5891EA" />
          <Rect
            x={2}
            y={2}
            width={box.width - 4}
            height={box.height - 4}
            rx={(box.height - 4) / 2}
            fill="none"
            stroke={`url(#weekRim-${index})`}
            strokeWidth={3}
          />
        </Svg>
      ) : null}
      <Text style={[styles.parentWeekText, on && styles.parentWeekTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Two-digit multiplication in front of the report: a five-year-old cannot get past it, and a
// grown-up does not need a password to.
function ParentGate({ onPass }) {
  const [sum, setSum] = useState(() => ({ a: 11 + Math.floor(Math.random() * 89), b: 2 + Math.floor(Math.random() * 8) }));
  const [answer, setAnswer] = useState('');
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (Number(answer) === sum.a * sum.b) {
      playSound('pop');
      onPass();
      return;
    }
    setWrong(true);
    setAnswer('');
    setSum({ a: 11 + Math.floor(Math.random() * 89), b: 2 + Math.floor(Math.random() * 8) });
  };

  return (
    <View style={styles.gateWrap}>
      <View style={styles.gateCard}>
        <Text style={styles.gateTitle}>보호자 확인</Text>
        <Text style={styles.gateSub}>아래 문제를 풀면 리포트를 볼 수 있어요.</Text>
        <Text style={styles.gateSum}>{sum.a} × {sum.b} = ?</Text>
        <TextInput
          style={styles.gateInput}
          value={answer}
          onChangeText={(t) => { setAnswer(t.replace(/[^0-9]/g, '')); setWrong(false); }}
          keyboardType="number-pad"
          placeholder="답"
          placeholderTextColor="#a9b6cf"
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        {wrong ? <Text style={styles.gateWrong}>다시 한 번 계산해 주세요.</Text> : null}
        <TouchableOpacity style={styles.gateButton} onPress={submit}>
          <Text style={styles.gateButtonText}>확인</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ParentReportScreen({ profile, report, words }) {
  const [passed, setPassed] = useState(false);
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


  if (!passed) return <ParentGate onPass={() => setPassed(true)} />;

  return (
    <View style={styles.parentScroll}>
      <View style={styles.parentBody}>
      <View style={styles.parentCol}>
        <Text style={styles.parentTitle}>부모 리포트</Text>
        <Text style={styles.parentSub}>이번 달 아이 학습에 대한 분석을 살펴보세요.</Text>

        {/* One month per page: arrows step, and the row can be swiped too. */}
        <View style={styles.parentMonthRow}>
          <TouchableOpacity
            style={styles.parentMonthNav}
            onPress={() => { if (month <= 1) return; playSound('pop'); setMonth(month - 1); monthRef.current?.scrollTo({ x: (month - 2) * MONTH_PAGE }); }}
          >
            <Text style={[styles.parentMonthArrow, month <= 1 && styles.parentMonthArrowOff]}>‹</Text>
          </TouchableOpacity>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.parentMonthScroll}
            contentContainerStyle={styles.parentMonthWrap}
            ref={monthRef}
            onContentSizeChange={() => monthRef.current?.scrollTo({ x: (month - 1) * MONTH_PAGE, animated: false })}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / MONTH_PAGE) + 1;
              if (next !== month) { playSound('pop'); setMonth(next); }
            }}
          >
            {Array.from({ length: today.getMonth() + 1 }, (_, i) => i + 1).map((m) => (
              <View key={m} style={styles.parentMonthPage}>
                <View style={styles.parentMonth}>
                  <Svg width={132} height={166} style={StyleSheet.absoluteFill}>
                    <Defs>
                      <LinearGradient id={`monthGrad-${m}`} x1="0" y1="0" x2="0.4" y2="1">
                        <Stop offset="0" stopColor="#609EF5" />
                        <Stop offset="1" stopColor="#3859B9" />
                      </LinearGradient>
                      {/* Soft edge: the shape is blurred so it melts into the panel. */}
                      <Filter id={`monthSoft-${m}`} x="-25%" y="-25%" width="150%" height="150%">
                        <FeGaussianBlur stdDeviation="9" />
                      </Filter>
                    </Defs>
                    <Rect x={16} y={16} width={100} height={134} rx={48} fill={`url(#monthGrad-${m})`} filter={`url(#monthSoft-${m})`} />
                  </Svg>
                  <Text style={styles.parentMonthYear}>{today.getFullYear()}</Text>
                  <Text style={styles.parentMonthNum}>{m}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={styles.parentMonthNav}
            onPress={() => { if (month >= today.getMonth() + 1) return; playSound('pop'); setMonth(month + 1); monthRef.current?.scrollTo({ x: month * MONTH_PAGE }); }}
          >
            <Text style={[styles.parentMonthArrow, month >= today.getMonth() + 1 && styles.parentMonthArrowOff]}>›</Text>
          </TouchableOpacity>
        </View>

        {PARENT_WEEKS.map((label, i) => (
          <WeekPill key={label} label={`${month}월 ${label}`} index={i} on={week === i} onPress={() => { playSound('pop'); setWeek(i); }} />
        ))}
      </View>

      <View style={styles.parentDivider} />

      <View style={styles.parentColWide}>
        <View style={styles.parentTag}><Text style={styles.parentTagStar}>★</Text><Text style={styles.parentTagText}>{childName}이가 자란 순간들</Text></View>
        <Text style={styles.parentHint}>이번 주 {childName}이가 <Text style={styles.parentHintOn}>스스로 해낸 순간들</Text>을 모아봤어요</Text>
        {moments.map((mo) => (
          <View key={mo.tag} style={styles.momentCard}>
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
              <Defs>
                <LinearGradient id={`momentGrad-${mo.tag}`} x1="0" y1="0" x2="1" y2="0.4">
                  <Stop offset="0" stopColor="#ffffff" />
                  <Stop offset="1" stopColor="#cfe2ff" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill={`url(#momentGrad-${mo.tag})`} />
            </Svg>
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
          {MOCK_REPORT[0].interests.map((t) => (
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
  gateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateCard: {
    width: 420,
    alignItems: 'center',
    gap: 10,
    padding: 28,
    borderRadius: 26,
    backgroundColor: '#D7EAFF',
  },
  gateTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  gateSub: {
    fontSize: 14,
    fontWeight: '700',
    color: '#609EF5',
  },
  gateSum: {
    marginTop: 6,
    fontSize: 34,
    fontWeight: '900',
    color: '#3859B9',
  },
  gateInput: {
    width: 200,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_ON_DARK,
  },
  gateWrong: {
    fontSize: 13,
    fontWeight: '800',
    color: '#d9534f',
  },
  gateButton: {
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 42,
    borderRadius: 999,
    backgroundColor: '#5891EA',
  },
  gateButtonText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  deltaDown: {
    color: '#d9534f',
  },
  deltaUp: {
    color: '#2f8f5b',
  },
  momentArt: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 92,
    height: 92,
    opacity: 0.75,
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
    backgroundColor: '#eef5ff',
    overflow: 'hidden',
  },
  momentHead: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: '700',
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
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  parentChipArt: {
    width: 36,
    height: 36,
  },
  parentChipText: {
    fontSize: 21,
    fontWeight: '900',
    color: '#4570CD',
  },
  parentChips: {
    flexDirection: 'row',
    columnGap: 10,
    paddingTop: 6,
    paddingBottom: 6,
  },
  parentCol: {
    width: 260,
    gap: 10,
  },
  parentColRight: {
    flex: 1.1,
    gap: 8,
    justifyContent: 'space-between',
  },
  parentColWide: {
    flex: 1,
    gap: 8,
  },
  parentDivider: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: '#a9c8f2',
  },
  parentHint: {
    marginTop: 4,
    marginBottom: 10,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#609EF5',
  },
  parentHintOn: {
    color: '#609EF5',
    textDecorationLine: 'underline',
  },
  parentMonth: {
    width: 132,
    height: 166,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentMonthArrow: {
    paddingHorizontal: 10,
    fontSize: 34,
    fontWeight: '900',
    color: '#5b6b8c',
  },
  parentMonthArrowOff: {
    opacity: 0.25,
  },
  parentMonthNav: {
    paddingHorizontal: 2,
  },
  parentMonthNum: {
    fontSize: 38,
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
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  parentMonthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  parentMonthScroll: {
    width: 180,
    flexGrow: 0,
  },
  parentMonthPage: {
    width: 180,
    alignItems: 'center',
  },
  parentMonthYearOff: {
    color: '#8fa6c9',
  },
  parentMonthYear: {
    fontSize: 15,
    fontWeight: '800',
    color: '#dbeafe',
  },
  parentScroll: {
    flex: 1,
    paddingBottom: 20,
    backgroundColor: '#D7EAFF',
  },
  parentStat: {
    width: '47%',
    paddingVertical: 0,
  },
  parentStatArt: {
    width: 52,
    height: 52,
  },
  parentStatDelta: {
    marginTop: 1,
    fontSize: 12,
    fontWeight: '800',
  },
  parentStatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
    columnGap: 10,
    paddingLeft: 26,
  },
  parentStatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  parentStatLabel: {
    marginTop: 2,
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
    fontSize: 24,
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
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  parentWeekOn: {
    backgroundColor: 'transparent',
  },
  parentWeekText: {
    fontSize: 14,
    fontWeight: '800',
    color: 'rgba(0,0,0,0.5)',
    textAlign: 'center',
  },
  parentWeekTextOn: {
    color: '#ffffff',
  },
});
