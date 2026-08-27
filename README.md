# StaryDot

영상과 자막에서 만 3~7세 아이가 보다가 멈추고 푸는 상호작용 활동을 만든다.

SKT FLY AI 열정4팀 최종 프로젝트.

저장소에는 두 가지가 들어 있다. 아이가 쓰는 태블릿 앱과, 그 앱이 낼 문제를 영상에서
뽑아내는 파이프라인이다.

```
frontend/          Expo React Native 앱 (안드로이드 태블릿)
backend/
  server/          콘텐츠·기록 API (Node 내장 http + node:sqlite)
  oneshot/         영상에서 활동을 뽑는 파이프라인 (파이썬)
  tools/           스케치 변환 등 보조 스크립트
docs/              기획서, 파이프라인 설계 문서
```

## 앱 실행

Node 22 이상이 필요하다. 서버가 `node:sqlite` 내장 모듈을 쓰기 때문에 22 미만에서는
켜지지 않는다.

```bash
node -v    # v22 이상
```

**서버.** 의존성이 없다. 받아서 바로 켠다.

```bash
node backend/server/index.js
```

DB는 `backend/server/data/stary.db`에 자동으로 생긴다. 영상은 `backend/server/media/`에 둔다.

**앱.**

```bash
cd frontend
npm install
npx expo start
```

붙을 서버 주소는 Metro가 물려 있는 호스트에서 가져온다. IP를 손으로 적을 곳은 없다.
USB로 물린 기기라면 포트만 넘겨주면 된다.

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:5056 tcp:5056
```

Skia와 Reanimated를 쓰기 때문에 **Expo Go로는 열리지 않는다.** 개발용 빌드를 한 번
만들어 설치해야 한다.

```bash
cd frontend
npx eas build -p android --profile development   # 개발용, Metro에 붙는다
npx eas build -p android --profile preview       # 팀 배포용 APK
```

로컬 gradle로 만든 APK는 기존 EAS 빌드와 서명이 달라 설치되지 않는다. 개발용 빌드는
EAS 빌드로만 갱신한다.

서버가 꺼져 있어도 앱은 돈다. 목록은 `frontend/assets/library.json`에서, 영상은 기기의
앱 폴더에서 읽는다. 서버가 없으면 그날의 기록이 남지 않을 뿐이다.

## 환경 변수

| 변수 | 쓰는 곳 | 없으면 |
|---|---|---|
| `STARY_PORT` | 콘텐츠 서버 포트 | 5056으로 뜬다 |
| `GEMINI_API_KEY` | 스케치를 그림으로 바꾸는 보조 스크립트 | 그 스크립트만 안 돈다 |
| `ANTHROPIC_API_KEY` | 파이프라인 API 경로 | 에이전트 경로는 없이 돈다 |

`backend/.env.example`에 이름만 두었다. 값이 든 `.env`는 커밋하지 않는다.

## 활동은 어떻게 만들어지는가

아이가 영상을 수동적으로 보기만 하는 대신, 중간에 멈춰 질문에 답하게 한다.
그러려면 두 가지를 정해야 한다 — **어디서 멈출지**와 **무엇을 물을지**.
이 저장소는 그 둘을 자동으로 정한다.

```
[영상.mp4 + 자막.srt]  →  [활동 JSON]

{
  "timestamp_sec": 175.0,
  "activity_template": "흉내_내는_말_이해",
  "question": "눈이 빙글빙글 소용돌이 모양인 이 캐릭터에게 어울리는 흉내 내는 말은 무엇일까요?",
  "options": ["빙글빙글", "사뿐사뿐", "쿵쿵"],
  "answer": "빙글빙글",
  "why_here": "...",
  "scene_description": "..."
}
```

## 두 가지 경로

같은 문제를 두 방식으로 푼다. 하나를 버리는 게 아니라 쓰임이 다르다.

| | 에이전트 경로 | API 경로 |
|---|---|---|
| 방식 | 역할을 넷으로 나눠 서브에이전트가 처리 | 프레임 전체를 한 번의 모델 호출에 |
| API 키 | 필요 없음 | 필요 |
| 자동화 | 사람(또는 Claude Code)을 거쳐야 함 | 배치·cron 가능 |
| 중간 산출물 | 단계별로 파일에 남음 | 없음 |
| 쓸 곳 | 품질 탐색, 프롬프트 튜닝 | 실제 배치 처리 |

### 에이전트 경로

```
oneshot.prep  ─→ ① 관찰자 A·B ─→ ② 지점 선정 ─→ ③ 출제자 ─→ ④ 검수자 ─→ oneshot.check
  (파이썬)         (서브에이전트, 병렬)                                          (파이썬)
```

설계의 핵심은 **관찰자에게 자막을 주지 않는 것**이다. 자막을 같이 주면 모델은 화면을
대충 보고 자막으로 장면 설명을 지어낸다. 격리해야 장면 기록이 화면에만 근거한 독립
기록이 되고, 검수자가 "이 문제, 자막만 읽어도 풀리는데?"를 판정할 기준이 생긴다.
그 판정이 곧 **프레임이 실제로 기여했는지**의 측정값이다.

관찰자는 **두 명을 서로 모르게** 돌려 대조한다. 혼자 자신 있게 틀리는 경우를 잡기
위해서다. 실측에서 두 관찰자가 같은 화면의 인형 개수를 2개와 3개로 다르게 셌다 —
개수를 묻는 활동이 있는 이상, 이건 잡아야 하는 종류의 오차다.

### API 경로

프레임 배치와 자막 전문을 Claude Opus 5 한 번의 호출에 넣고 활동 배열을 받는다.
각 이미지 앞에 `[MM:SS]` 라벨을 붙여 자막과 시간축을 맞춘다. 라벨이 없으면 모델은
프레임의 시각을 몰라 `timestamp_sec`을 지어낸다.

## 파이프라인 설치

Python 3.11+, [ffmpeg](https://ffmpeg.org/)(`brew install ffmpeg`)가 필요하다.

```bash
pip install -r backend/requirements.txt
```

아래 `python3 -m oneshot.*` 명령은 모두 `backend/`에서 실행한다.

```bash
cd backend
```

API 경로만 `ANTHROPIC_API_KEY` 또는 `ant auth login`이 필요하다. 에이전트 경로는
자격 증명 없이 돈다.

## 사용법 — 에이전트 경로

**0단계.** 작업 폴더를 만든다.

```bash
python3 -m oneshot.prep \
  --video samples/myvideo.mp4 \
  --out-dir out_agents/myvideo \
  --age-range 5-6 \
  --topic "친구와 모험" \
  --target-count 5
```

프레임을 한 장 열어 **자막이 화면에 박혀 있는지 확인한다.** 별도 SRT가 있어도 픽셀에
구워져 있는 경우가 흔하다. 박혀 있으면 관찰자 격리가 무너지므로 하단을 잘라낸다.

```bash
python3 -m oneshot.prep ... --crop-bottom 0.22
```

자른 뒤 **다시 열어 확인한다.** 자막 위치는 프레임마다 달라 한 비율로 다 잡히지 않는다.

**1~4단계.** Claude Code에서 `quiz-agents` 스킬을 부른다.

```
/quiz-agents samples/myvideo.mp4 5-6 친구와모험
```

**5단계.** 결정론적 가드를 건다.

```bash
python3 -m oneshot.check \
  --activities out_agents/myvideo/04_reviewed.json \
  --meta out_agents/myvideo/meta.json \
  --out out_agents/myvideo/myvideo_activities.json
```

## 사용법 — API 경로

영상과 자막을 같은 이름으로 한 폴더에 두고 실행한다.

```bash
python3 -m oneshot.run \
  --input-dir samples \
  --output-dir out \
  --age-range 5-6 \
  --topic "친구와 모험" \
  --target-count 5
```

영상 하나가 실패해도 나머지는 계속 처리하고, 실패 목록은 `out/failures.json`에 남는다.
**활동 0개는 실패로 기록한다** — 아무것도 못 만든 것을 성공으로 남기지 않는다.

## 활동 유형

연령 티어별로 하드 분할되어 있다. 다른 티어의 활동은 쓸 수 없다.

| 만 3-4세 | 만 5-6세 | 만 7세 |
|---|---|---|
| 사물_첫글자_찾기 | 그림과_낱말_연결 | 올바른_낱말_찾기 |
| 같은_글자로_시작하는_낱말 | 빠진_글자_완성 | 두_낱말_합치기 |
| 색_찾기 | 이야기_되새기기 | 반대말_찾기 |
| 수량_확인 | 흉내_내는_말_이해 | 사건의_순서_파악 |
| 그림_속_대상_찾기 | 감정_추론 | 이야기_핵심_주제 |
| | | 원인과_결과 |

출처는 `backend/oneshot/schemas.py`의 `TEMPLATES_BY_AGE_TIER` 하나다.

**유형은 코드가 배정한다.** 프롬프트에 "다양하게 쓰세요"라고 부탁하면 모델은 만들기
쉬운 유형으로 기운다 — 실측에서 활동 9개 중 4개가 한 유형이었고 한 유형은 0개였다.
`plan_types.assign_types`가 지점마다 우선순위 목록을 배정한다. 하나로 못 박지 않는
이유는, 그 지점에서 1순위가 성립하지 않을 때 지점을 통째로 버리지 않기 위해서다.

한 영상 안의 균등은 성립하지 않는다. 유형이 5~6종인데 활동은 3~5개다. 균등은 여러
영상에 걸쳐 성립한다.

### 맞춤형 — 아이 데이터로 확률 조절

배정을 코드가 하므로, 배정에 쓰는 가중치 표가 곧 맞춤형의 접점이다.

```python
from oneshot.plan_types import assign_types, weights_from_history

weights = weights_from_history(history, templates)  # 자주 틀린 유형의 가중치가 오른다
assign_types(point_count, templates, weights)
```

`history` 항목은 `{"activity_template": str, "correct": bool}`이다. 정책은 **약점 보완** —
자주 틀린 유형을 더 자주 낸다. 안전장치를 둘 뒀다. 3회 미만 풀어본 유형은 건드리지
않고(한두 번 틀린 걸로 쏠리면 아이가 같은 벽에 계속 부딪힌다), 가중치가 0이어도
우선순위 목록에서 사라지지는 않는다.

가중치를 주지 않으면 균등이다.

## 검증

모델을 믿되 검산은 코드가 한다. `backend/oneshot/validate.py`가 순수 함수로 수행한다.

| 검사 | 위반 시 |
|---|---|
| 활동 유형이 해당 연령 티어 카탈로그에 있는가 | 버림 |
| 정답이 선택지 안에 있는가 | 버림 |
| 선택지 3개가 서로 다른가 | 버림 |
| 시각이 영상 길이 안인가 | 버림 |
| 시각이 자막 발화 한가운데인가 | 가장 가까운 침묵으로 스냅 |
| 앞 활동과 최소 간격 이상 떨어져 있는가 | 뒤엣것 버림 |

버려진 항목은 사유와 함께 출력 JSON의 `rejections`에 남는다. **조용히 버리지 않는다** —
재시도가 없는 구조라 이게 프롬프트를 고칠 유일한 신호다.

## 구조

```
backend/oneshot/
  schemas.py          데이터클래스, 연령 티어별 활동 카탈로그
  subtitle_parser.py  SRT/VTT 파싱
  _reuse.py           카탈로그·파서 재수출 (임포트 지점을 한곳으로)
  limits.py           API가 강제하는 한계 상수
  sample_frames.py    ffmpeg 단일 패스 프레임 추출, 개수 상한 대응
  plan_types.py       지점별 활동 유형 배정, 기록 기반 가중치
  validate.py         결정론적 가드
  prep.py             [에이전트 경로] 작업 폴더 준비
  check.py            [에이전트 경로] 가드 적용
  prompt.py           [API 경로] 시각 라벨 정렬 프롬프트 조립
  generate.py         [API 경로] Opus 5 단일 호출
  run.py              [API 경로] CLI 오케스트레이터
  tests/              단위 테스트 93개
backend/server/
  index.js            HTTP 라우팅
  db.js               SQLite 스키마·질의
  session.js          오늘의 묶음 편성
  media.js            영상·자막 서빙
frontend/
  App.js              화면 전환, 서버와 통신하는 유일한 지점
  screens/            화면별 컴포넌트
  data/               캐릭터·코스튬·활동 정의
  assets/             이미지, 사운드, 오프라인 목록
.claude/skills/quiz-agents/
  SKILL.md            4역할 오케스트레이션 지시문
```

## 테스트

```bash
python3 -m pytest backend/oneshot/tests -v
```

ffmpeg 호출과 API 호출이 전부 모킹되어 있어 별도 설치나 자격 증명 없이 돈다.

## 알려진 한계

- **API 경로는 실제 엔드포인트에 붙어본 적이 없다.** 요청 형태는 설치된 `anthropic`
  SDK의 타입과 필드 단위로 대조해 확인했지만, 실제 응답을 받아본 적은 없다. 모델 호출
  이전 단계는 실제 영상으로 검증했다.
- `limits.MAX_IMAGES_PER_REQUEST = 100`은 문서상의 기본값이지 실측값이 아니다.
- **에이전트 경로는 매번 결과가 다르다.** 이건 의도한 것이다 — 같은 영상을 다시 봐도
  다른 활동이 나와야 한다. 다만 재현이 필요한 회귀 검증에는 맞지 않는다.
- 활동 형식이 3지선다 하나다. `사건의_순서_파악` 같은 유형은 이 형식에 잘 맞지 않는다.
- 최종 활동 개수를 목표치로 잘라내는 로직이 없다. 검증을 통과한 것이 다 남는다.
