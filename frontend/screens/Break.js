// 영상 하나가 끝나고 다음 영상이 시작되기 전의 브레이크.
//
// 여기 나오는 문항은 storydot 파이프라인의 **마무리 활동**이다. 방금 본 영상의 한 장면을
// 같이 띄우고 그 그림을 보고 답하게 한다 — 12분 전을 기억해 내는 회상이 아니라 눈앞의
// 그림을 알아보는 재인이라 세 살도 답할 수 있다. 그림을 빼면 문제가 성립하지 않는다.
//
// 시간 예산에서 이 화면이 차지하는 몫은 편성기가 잡아 둔 QUIZ_SEC 이다. 여기서 시간을 재서
// 끊지는 않는다 — 답하는 중에 화면이 사라지면 아이는 자기가 뭘 틀렸는지 모른다.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../Typography';
import { playSound, speak } from '../sound';
import { QuizOverlay } from './Watch';

export function BreakScreen({ items = [], mediaBase = '', isLast, onResult, onDone }) {
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState(null);
  const [tries, setTries] = useState(0);
  // 문항이 뜬 시각. 개입 평가용 응답 지연을 재는 기준점이라 문항이 바뀔 때마다 새로 잡는다.
  const shownAt = React.useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [at]);

  const quiz = items[at];
  // 문항이 없는 브레이크는 만들지 않는다(편성기가 걸러 준다). 그래도 도달하면 조용히 넘긴다.
  // 렌더 도중에 부모 상태를 바꾸면 React 가 경고를 띄우고 화면이 멈추므로 효과로 미룬다.
  useEffect(() => {
    if (!quiz) onDone();
  }, [quiz]);
  if (!quiz) return null;

  const next = () => {
    setSelected(null);
    setTries(0);
    if (at + 1 < items.length) setAt(at + 1);
    else onDone();
  };

  const answer = (label) => {
    setSelected(label);
    const right = label === quiz.answer;
    if (onResult) onResult(quiz.activityId, right ? 'correct' : 'wrong',
                           quiz.activity_template, Date.now() - shownAt.current);
    playSound(right ? 'success' : 'wrong');
    speak(right ? 'correct' : 'retry');
    if (!right) setTries((n) => n + 1);
  };

  const label = at + 1 < items.length ? '다음 문제' : isLast ? '오늘 마무리하기' : '다음 영상 보기';

  return (
    <View style={styles.screen}>
      <Text style={styles.counter}>{`${at + 1} / ${items.length}`}</Text>
      <QuizOverlay
        key={quiz.activityId ?? at}
        quiz={quiz}
        selected={selected}
        tries={tries}
        frame={quiz.framePath ? { uri: mediaBase + quiz.framePath } : null}
        resumeLabel={label}
        onAnswer={answer}
        onRetry={() => {
          // 재시도도 같은 문항(at 은 그대로)이라 문항 전환 효과가 시각을 새로 안 잡는다.
          // 여기서 새로 잡지 않으면 재시도 클릭의 지연이 첫 시도부터 누적된 값이 되어 버린다.
          shownAt.current = Date.now();
          setSelected(null);
        }}
        onResume={next}
        onSkip={() => {
          // 건너뛰기도 기록한다. 아무 답이 없는 문항은 리포트에서 '안 푼 것'으로 세어야 한다.
          if (selected == null && onResult) onResult(quiz.activityId, 'skip', quiz.activity_template,
                                                       Date.now() - shownAt.current);
          next();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // QuizOverlay 는 Modal 이라 화면을 통째로 덮는다. 이 뒤판은 모달이 뜨기 전 한 프레임과
  // 모달 바깥 여백에만 보인다.
  screen: { flex: 1, backgroundColor: '#0f1116', alignItems: 'center', justifyContent: 'center' },
  counter: { color: '#8a97b1', fontSize: 16, fontWeight: '700' },
});
