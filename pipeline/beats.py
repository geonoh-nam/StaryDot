"""장면 경계 점수화 — "누가 말을 멈춘 자리"가 아니라 "한 장면이 끝난 자리"를 찾는다.

기존 find_acts() 의 2순위(최장 발화공백)는 티니핑처럼 내레이터가 없는 작품에서
경계를 만들어 내긴 하지만, 그 경계에 서사적 의미가 없다. 실제 출력이 이랬다:

    (무음 전환 몰라! 일단 밟고 올라가자!)
    (무음 전환 바범이 훌륭다!)

무음은 장면 전환의 **증상 하나**일 뿐이다. 게다가 브레드처럼 대사가 촘촘한 작품에서는
증상 자체가 안 나타난다(브레드 237개 세그먼트 중 공백 2초 이상이 8곳뿐, 대부분 0.0초).
그래서 여기서는 경계를 하나의 신호가 아니라 **일곱 개 신호의 가중합**으로 판정한다.

    ① gap      발화 공백          — 물리 신호. 여전히 가장 강하지만 유일하지 않다
    ② topic    화제 전환          — 앞뒤 내용어 집합의 자카드 거리. 촘촘한 작품의 주력
    ③ cue      장면 관용구        — 출발·도착·인사·호명. "어서 가자!" / "여긴 어디지?"
    ④ closure  종결성            — 앞 세그먼트가 문장을 닫았는가. 연결어미면 감점
    ⑤ opener   개시 패턴          — 뒤가 제안·질문으로 열리는가. 응답어로 열리면 감점
    ⑥ song     노래 경계          — 주제가↔대사 전환은 확정적 장(章) 경계
    ⑦ pace     발화 밀도 변화      — 촘촘한 수다 ↔ 성긴 액션 구간의 교대

두 가지 설계 원칙이 있다.

**정규화는 작품 안에서 한다.** gap 을 절대초로만 쓰면 브레드는 모든 경계가 0점이 된다.
작품 내 분포에서의 백분위와 절대값을 반씩 섞는다. topic 도 마찬가지 — 짧은 창에서
자카드 거리는 대부분 1.0 이라 절대값으로는 변별이 안 되고, 백분위로 바꾸면 사실상
"직전 화제가 이어지는가"에 대한 감점 신호로 작동한다. 그게 우리가 원하는 것이다.

**ASR 오류를 전제한다.** 전사본에 "바범이 훌륭다", "다이어너핑"(= 다이아나핑) 같은
오인식이 섞여 있다. 그래서 어휘 비교는 정확 일치와 **앞 2음절 접두 일치**를 함께 보고
둘 중 겹침이 큰 쪽을 쓴다. 오인식 변이가 화제 전환으로 오판되는 것을 막는다.

라벨도 바꾼다. 기존은 경계 **직전 한 줄**을 그대로 붙였다 — 그 줄이 그 장면을 대표할
이유가 없다. 여기서는 act 전체에서 화제어와 대표 문장을 뽑는다. 빈도는 에피소드 안에서의
TF-IDF 로 재고(전체 빈도로는 모든 라벨이 주인공 이름이 된다), 주제가·음향 주석은 빼고,
conf=low 세그먼트의 말은 절반만 센다. 알려진 서사 동사가 두 번 이상 잡힐 때만 명사구로
요약하고, 안 잡히면 지어내지 않고 화제어만 남긴다.

    python3 beats.py                     자체검사 + work/ 의 티니핑·브레드 비교표
    python3 beats.py <plan.json> ...     지정한 plan 으로 비교

외부 패키지 없음. 기존 파일도 수정하지 않는다 — 통합은 호출부에서 한다.
"""
from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent
WORK = ROOT / "work"


# ── 어휘 자원 ───────────────────────────────────────────────────────────────
# 감탄사·호응어. 내용 토큰이 아니다. storydot.FILLER 를 장면 판정용으로 넓혔다.
FILLER = {
    "어어", "으응", "우와", "아아", "네네", "으음", "이야", "히히", "하하",
    "으악", "아니", "아냐", "그래", "맞아", "정말", "진짜", "제발", "그냥",
    "글쎄", "저런", "어머", "에이", "아휴", "어라", "아이고", "어이쿠",
    "옳라이", "예스", "오케이", "우후", "히힛", "흐흐", "으흑", "으아",
    "안돼", "몰라", "싫어", "그만", "어머나", "이런", "저기요", "얘들아",
}
# 내용어가 아닌 고빈도어. 이걸 안 걸면 화제 전환이 "지금·우리·여기"로 판정된다.
STOP = {
    "우리", "너희", "저희", "자기", "이거", "그거", "저거", "여기", "저기",
    "거기", "어디", "누구", "무슨", "무엇", "이런", "그런", "저런", "이렇게",
    "그렇게", "저렇게", "어떻게", "왜냐", "다시", "지금", "이제", "오늘",
    "내일", "조금", "많이", "빨리", "얼른", "어서", "잠깐", "잠시", "생각",
    "사람", "여러분", "얘들", "그리고", "그래서", "그러니까", "그런데", "근데",
    "아무튼", "그나저나", "하지만", "그래도", "이번", "다음", "모두", "전부",
    "같아", "같은", "같다", "있어", "없어", "있는", "없는", "되는", "하는",
    "해야", "한테", "에게", "보다", "처럼", "위해", "때문", "동안", "부터",
    "까지", "오케", "오케이", "마이", "바로", "한번", "이건", "저건", "그건",
    "일단", "아직", "벌써", "이미", "만약", "혹시", "방금", "결국", "아까",
    "다들", "너무", "아주", "제일", "가장", "함께", "같이", "서로", "자꾸",
    "계속", "여기서", "거기서", "저기서", "그때", "이때", "정도", "제가",
    "요즘", "얼마", "무슨일", "그러게", "그렇지", "이야기",
    # 대명사+조사. 한 글자 대명사는 _destem 이 못 떼서 통째로 막아야 한다.
    "뭐가", "뭐를", "내가", "네가", "니가", "이게", "그게", "저게", "거야",
    "거지", "건데", "뭘까", "누가",
}
# 용언 활용형 꼬리. 화제어는 이름·사물이지 활용된 동사가 아니다.
# 하드 필터가 아니라 **감점**이다 — '찾아보자' 가 유일한 단서인 장면도 있다.
VERBALISH = ("다더니", "잖아", "는데", "니까", "구나", "더라", "어요", "아요",
             "세요", "합니다", "다", "요", "까", "네", "죠", "지", "어", "아",
             "게", "니", "데", "나", "라", "자", "야", "서", "고", "면", "돼",
             "잖", "겠", "았", "었", "했", "해", "같")   # 조사 제거가 남긴 꼬리
VERB_PENALTY = 0.45
PARTICLES = ("이랑", "에게", "한테", "에서", "으로", "라고", "이라", "와", "과",
             "는", "은", "이", "가", "를", "을", "에", "도", "랑", "야", "아",
             "의", "만", "요", "로", "께")

# 장면을 **닫는** 관용구. 앞 세그먼트 꼬리에서 찾는다.
CUE_CLOSE = {
    "출발": re.compile(r"(출발|가자|가요|갑시다|떠나|어서 가|따라와|따라오|서두르)"),
    "작별": re.compile(r"(잘 가|안녕히|다녀올게|또 봐|이만|마치겠|끝났)"),
    "결의": re.compile(r"(찾아보자|해보자|시작이다|시작하죠|시작할|가보자|올라가자)"),
}
# 장면을 **여는** 관용구. 뒤 세그먼트 머리에서 찾는다.
CUE_OPEN = {
    "도착": re.compile(r"^[^가-힣]{0,3}(여기|여긴|저기 봐|왔|도착|다 왔|이곳)"),
    "출발": re.compile(r"^[^가-힣]{0,3}(출발|떠나|자, 가|어서 가)"),
    "인사": re.compile(r"^[^가-힣]{0,3}(안녕|어서 오세요|반가|처음 뵙)"),
    "발견": re.compile(r"^[^가-힣]{0,3}(이게 뭐|저게 뭐|뭐야|어\? 저|저건|이건 또)"),
    "전환": re.compile(r"^[^가-힣]{0,3}(한편|그때|드디어|이윽고|그나저나|얼마 후|다음 날)"),
}
# 호명(부름말). 정규식만으로는 "으아아아아아!"가 전부 걸린다 — 실측. 의성어를
# 걸러내야 쓸 수 있어서 함수로 뺐다.
VOCATIVE = re.compile(r"(?:^|[\s,!?.\"'])([가-힣]{2,5})(아|야)[!,.?…\s\"']*$")
VOCATIVE_FIXED = re.compile(r"(얘들아|여러분|사장님|공주님|사장님들)[!,.?…\s]*$")
# 종결어미. 문장이 닫혔다는 표시.
FINAL = re.compile(r"(습니다|ㅂ니다|세요|어요|아요|예요|에요|네요|는군|구나|군요"
                   r"|잖아|더라|는다|았다|었다|겠다|을까|ㄹ까|나요|자|래|냐|죠"
                   r"|다|요|까|야|어|아|워|해|돼|지)$")
# 연결어미·조사. 문장이 아직 안 끝났다는 표시 — 여기서 자르면 대사가 잘린다.
CONT = re.compile(r"(면서|는데|지만|니까|라서|다가|거나|든지|다고|라고|하고"
                  r"|고|서|며|면|의|에|을|를|은|는|이|가|도|만|랑|와|과)$")
# 뒤 세그먼트가 **새 장면을 여는** 패턴 / **직전 대화를 잇는** 패턴.
OPEN_NEW = re.compile(r"(할까|을까|ㄹ까|볼까|하자|가자|보자|합시다|해보|어때)[?!]?")
OPEN_CONT = re.compile(r"^[^가-힣]{0,3}(응|네|넵|아니|아냐|그래|맞아|그럼|그러니까"
                       r"|그래서|그리고|뭐\?|왜\?|어\?|응\?|엥|뭐라고)")
PUNCT_END = re.compile(r"[.?!…]+[\"')\]]*$")
ANNOT = re.compile(r"[(\[（][^)\]）]*[)\]）]")
ANNOT_ONLY = re.compile(r"^[\s\-]*[(\[（].*[)\]）][\s.]*$")

# 서사 동사 → 명사구. 라벨을 "다이아나핑 찾기" 처럼 읽히게 만드는 최소 사전이다.
# 명사(열차·이발소)에서 사건을 유추하지 않는다 — 그건 지어내는 것이다. 동사만 본다.
NOMINAL = [
    (re.compile(r"찾(아보|아야|아|으|자|는|을)"), "찾기"),
    (re.compile(r"(출발|떠나자|떠날|어서 가|서두르|타자|올라타)"), "출발"),
    (re.compile(r"(도착|다 왔|왔구나|왔어요|여기가)"), "도착"),
    (re.compile(r"(대결|시합|승부|붙어보|겨루)"), "대결"),
    (re.compile(r"(인터뷰|스튜디오|모셨습니다|취재|기자)"), "인터뷰"),
    (re.compile(r"(사기꾼|조작|거짓말|폭로|밝힐|밝혀|들통)"), "폭로"),
    (re.compile(r"(사라|없어졌|잃어버|실종|안 보여)"), "실종"),
    (re.compile(r"(구해|도와|구출|살려|막아)"), "구조"),
    (re.compile(r"(준비|차려|마련|맞이할)"), "준비"),
    (re.compile(r"(돌아가|돌아와|되돌아)"), "귀환"),
    (re.compile(r"(만나|만날|소개|누구야|누구세요|처음 보)"), "만남"),
    (re.compile(r"(싸우|다투|말다툼|따지|화났)"), "다툼"),
    (re.compile(r"(꾸며|스타일|머리를|드레스|옷)"), "단장"),
    (re.compile(r"(정신 차려|괜찮아\?|다쳤|쓰러)"), "위기"),
]

# 신호 가중치. 근거는 모듈 docstring 참고. gap 이 최대지만 과반은 아니다 —
# gap 단독으로 과반을 주면 브레드에서 아무 경계도 못 만든다.
WEIGHTS = {
    "gap": 0.30,      # 물리 신호. 신뢰도 최상이지만 작품에 따라 없을 수 있다
    "topic": 0.25,    # 어휘가 바뀌면 장면이 바뀐 것. 촘촘한 작품의 주력
    "cue": 0.15,      # 관용구는 오탐이 적다. 대신 자주 안 나온다
    "closure": 0.12,  # 잘린 대사 한가운데를 자르는 것을 막는 안전장치
    "opener": 0.10,   # 응답어로 시작하면 같은 대화다
    "song": 0.12,     # 드물게 발화하지만 발화하면 거의 확정
    "pace": 0.05,     # 보조 신호. 단독으로는 못 믿는다
}
# 화제 비교 창은 **시간**으로 잡는다. 세그먼트 개수로 잡으면 작품마다 창의 실제
# 길이가 3배씩 벌어진다(브레드 5개 = 12초, 티니핑 5개 = 35초). 장면은 시간 단위다.
TOPIC_SPAN = 40.0     # 경계 앞뒤 몇 초를 볼 것인가
TOPIC_MIN, TOPIC_MAX = 4, 14
MIN_SCORE = 0.26      # 이 아래는 경계로 안 본다 (act 수가 모자라도)
SPACING_RATIO = 0.4   # act 간 최소 간격 = max(min_act, 이상길이 × 이 비율)
MAX_ACT_RATIO = 1.8   # 이상길이의 이 배를 넘는 act 는 쪼갠다
MAX_EXTRA = 3         # 쪼개기로 늘릴 수 있는 경계 수 상한
# 주제가 블록 판정. 실측(티니핑·브레드 전 구간 스캔): 무음 1초 미만으로 붙어 있는
# 8개 이상의 런 중에서, 문장부호로 끝나는 비율 0.12 / 반복어 비율 0.60 인 구간은
# 티니핑 오프닝(0:00–1:05) 하나뿐이었다. 대사 구간은 부호율 0.33~1.00, 반복률
# 0.04~0.32 로 겹치지 않는다. 두 조건을 함께 걸어야 갈린다.
SONG_MIN_RUN, SONG_MAX_PUNCT, SONG_MIN_REP = 8, 0.30, 0.40


# ── 토큰화 ──────────────────────────────────────────────────────────────────
def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _destem(w: str) -> str:
    """조사를 뗀다. '다이아나핑을' → '다이아나핑'. storydot.stem 과 같은 이유.

    한 번만 떼면 겹조사가 남는다: '다이아나핑이라고' → '다이아나핑이' 에서 멈춰
    '다이아나핑'과 다른 토큰이 된다. 최대 세 번까지 반복한다."""
    for _ in range(3):
        for p in PARTICLES:
            if len(w) - len(p) >= 2 and w.endswith(p):
                w = w[: -len(p)]
                break
        else:
            break
    return w


# 감탄사 음절. 이것만으로 이루어진 토큰은 내용어가 아니다 — '으아악', '우와'.
# '오후'가 걸리지 않도록 '후'는 넣지 않는다.
INTERJ = set("으아악어와우오휴헉흐음윽읏앗엇흠엥")


def _echoic(w: str) -> bool:
    """의성어·의태어. '두근두근', '끄덕끄덕', '으아아아아' 는 화제어가 아니다.

    세 규칙이 필요하다: 한 글자 반복 / 같은 글자 3연속 / 앞뒤 절반이 같은 말.
    가운데 규칙이 없으면 '으아아아아아!' 가 호명(…아!)으로 잡힌다 — 실측."""
    if len(set(w)) == 1:
        return True
    if re.search(r"(.)\1\1", w):
        return True
    h = len(w) // 2
    return len(w) >= 4 and len(w) % 2 == 0 and w[:h] == w[h:]


def tokens(text: str) -> list[str]:
    """내용어만 남긴다. 음향 주석·감탄사·고빈도어·의성어를 걷어낸다.

    조사를 떼기 **전과 후** 둘 다 불용어 검사를 한다. '오케이'만 막으면
    조사 제거 결과인 '오케'가 화제어로 살아남는다(티니핑 주제가에서 실측)."""
    out = []
    for raw in re.findall(r"[가-힣]+", ANNOT.sub(" ", nfc(text))):
        if raw in FILLER or raw in STOP:
            continue
        t = _destem(raw)
        if not (2 <= len(t) <= 8) or t in FILLER or t in STOP or _echoic(t):
            continue
        if set(t) <= INTERJ:            # '으아악' 류
            continue
        out.append(t)
    return out


def _is_vocative(tail: str) -> bool:
    """꼬리가 부름말인가. '얘들아!' 는 참, '으아아아아아!' 는 거짓."""
    if VOCATIVE_FIXED.search(tail):
        return True
    m = VOCATIVE.search(tail)
    if not m:
        return False
    word = m.group(1) + m.group(2)
    return not _echoic(word) and word not in FILLER and m.group(1) not in FILLER


def _keys(toks) -> set[str]:
    """ASR 오인식을 견디는 느슨한 키. '다이아나핑'과 '다이어너핑'이 같은 키가 된다."""
    return {t[:2] for t in toks}


def songlike(text: str) -> bool:
    """주제가·삽입곡 판별. 가사는 같은 토큰이 짧은 간격으로 되풀이된다.

    storydot.songlike 와 같은 규칙. 노래 구간의 시작·끝은 장(章) 경계다."""
    toks = re.findall(r"[가-힣]+", text)
    if len(toks) < 4:
        return False
    return Counter(toks).most_common(1)[0][1] / len(toks) >= 0.5


# ── 작품 단위 통계 (신호 정규화용) ───────────────────────────────────────────
_CACHE: dict[int, tuple] = {}


def _stats(segs: list[dict]) -> dict:
    """작품 안에서의 분포를 한 번만 계산한다.

    같은 리스트로 score_boundary 를 N번 부르므로 캐시한다. id() 재사용을 막기 위해
    길이·양끝 시각을 지문으로 함께 검사한다 — 다르면 다시 계산한다."""
    fp = (len(segs), segs[0]["t0"] if segs else 0.0, segs[-1]["t1"] if segs else 0.0)
    hit = _CACHE.get(id(segs))
    if hit and hit[0] == fp:
        return hit[1]

    toks = [tokens(s["text"]) for s in segs]
    keys = [_keys(t) for t in toks]
    song = _song_mask(segs)
    gaps, tdist = [], []
    for i in range(max(0, len(segs) - 1)):
        gaps.append(max(0.0, segs[i + 1]["t0"] - segs[i]["t1"]))
        tdist.append(_jaccard_distance(segs, toks, keys, i))

    st = {
        "toks": toks, "keys": keys, "gaps": gaps, "tdist": tdist, "song": song,
        "pos_gaps": sorted(g for g in gaps if g >= 0.25),
        "sorted_tdist": sorted(d for d in tdist if d is not None),
    }
    if len(_CACHE) >= 8:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[id(segs)] = (fp, st)
    return st


def _pct(x: float, pool: list[float]) -> float:
    """분포 안에서의 백분위(중간순위). 절대 단위가 작품마다 다르므로 필요하다."""
    if not pool:
        return 0.5
    lo = sum(1 for v in pool if v < x)
    eq = sum(1 for v in pool if v == x)
    return (lo + 0.5 * eq) / len(pool)


def _span(segs, idx, back: bool) -> range:
    """경계 앞(뒤) TOPIC_SPAN 초 안의 세그먼트 인덱스. 개수 하한·상한을 건다."""
    t = segs[idx]["t1"] if back else segs[idx + 1]["t0"]
    if back:
        j = idx
        while j > 0 and (idx - j + 1) < TOPIC_MAX and \
                (t - segs[j - 1]["t0"] <= TOPIC_SPAN or (idx - j + 1) < TOPIC_MIN):
            j -= 1
        return range(j, idx + 1)
    j = idx + 1
    while j + 1 < len(segs) and (j - idx) < TOPIC_MAX and \
            (segs[j + 1]["t1"] - t <= TOPIC_SPAN or (j - idx) < TOPIC_MIN):
        j += 1
    return range(idx + 1, j + 1)


def _jaccard_distance(segs, toks, keys, idx) -> float | None:
    """경계 앞뒤 창의 내용어 집합이 얼마나 안 겹치는가.

    정확 일치와 접두 2음절 일치를 둘 다 계산해 **겹침이 큰 쪽**을 채택한다.
    ASR 이 '다이아나핑'을 '다이어너핑'으로 잘못 들었을 때 그것을 화제 전환으로
    읽으면 안 되기 때문이다. 한쪽 창의 내용어가 3종 미만이면 판단을 보류한다
    (None) — 감탄사만 있는 구간에서 억지로 1.0 을 주면 전부 경계가 된다."""
    a_t, a_k, b_t, b_k = set(), set(), set(), set()
    for j in _span(segs, idx, True):
        a_t |= set(toks[j])
        a_k |= keys[j]
    for j in _span(segs, idx, False):
        b_t |= set(toks[j])
        b_k |= keys[j]
    if len(a_t) < 3 or len(b_t) < 3:
        return None
    exact = len(a_t & b_t) / len(a_t | b_t)
    loose = len(a_k & b_k) / len(a_k | b_k)
    return 1.0 - max(exact, loose)


def _song_mask(segs) -> list[bool]:
    """주제가·삽입곡 블록을 표시한다. 판정 근거는 SONG_* 상수 주석 참고.

    개별 세그먼트로는 못 잡는다 — 노래 한 줄('캐치티니킹~')은 토큰이 3개뿐이라
    반복 검사를 통과하지 못한다. 붙어 있는 런 전체를 하나로 놓고 봐야 갈린다."""
    mask = [False] * len(segs)
    run = [0] if segs else []
    runs = []
    for i in range(len(segs) - 1):
        if segs[i + 1]["t0"] - segs[i]["t1"] < 1.0:
            run.append(i + 1)
        else:
            runs.append(run)
            run = [i + 1]
    if run:
        runs.append(run)

    for r in runs:
        if len(r) < SONG_MIN_RUN:
            continue
        punct = sum(1 for i in r if PUNCT_END.search(nfc(segs[i]["text"]).strip()))
        toks = [t for i in r for t in re.findall(r"[가-힣]+", segs[i]["text"])]
        if not toks:
            continue
        cnt = Counter(toks)
        rep = sum(v for v in cnt.values() if v > 1) / len(toks)
        if punct / len(r) < SONG_MAX_PUNCT and rep >= SONG_MIN_REP:
            for i in r:
                mask[i] = True
    return mask


def _density(segs, lo, hi) -> float:
    """구간의 발화 밀도 = 실제 말한 시간 / 벽시계 시간."""
    win = segs[lo:hi]
    if not win:
        return 0.0
    span = win[-1]["t1"] - win[0]["t0"]
    talk = sum(s["t1"] - s["t0"] for s in win)
    return min(1.0, talk / span) if span > 0 else 1.0


# ── 개별 신호 ───────────────────────────────────────────────────────────────
def _sig_gap(segs, st, idx):
    raw = st["gaps"][idx]
    if raw < 0.25:
        return raw, 0.0, "공백 없음(같은 장면)"
    # 절대항의 포화점을 12초로 잡는다. 8초로 두면 13.4초 무음(장면 전환)과
    # 3.8초 무음(숨 고르기)의 점수 차가 0.02 밖에 안 난다 — 실측 티니핑 7:19 vs 7:43.
    v = 0.5 * _pct(raw, st["pos_gaps"]) + 0.5 * min(1.0, raw / 12.0)
    return raw, v, f"무음 {raw:.1f}s (작품 내 상위 {100 * (1 - _pct(raw, st['pos_gaps'])):.0f}%)"


def _sig_topic(segs, st, idx):
    raw = st["tdist"][idx]
    if raw is None:
        return None, 0.4, "내용어 부족, 판단 보류"
    v = _pct(raw, st["sorted_tdist"])
    return raw, v, f"화제거리 {raw:.2f} (백분위 {v:.2f})"


def _tail(text: str, n: int = 18) -> str:
    return nfc(text).strip()[-n:]


def _head(text: str, n: int = 18) -> str:
    return nfc(text).strip()[:n]


def _sig_cue(segs, st, idx):
    prev, nxt = segs[idx]["text"], segs[idx + 1]["text"]
    hits = []
    for name, rx in CUE_CLOSE.items():
        if rx.search(_tail(prev)):
            hits.append(f"닫힘:{name}")
    if _is_vocative(_tail(prev)):
        hits.append("닫힘:호명")
    for name, rx in CUE_OPEN.items():
        if rx.search(_head(nxt)):
            hits.append(f"열림:{name}")
    if _is_vocative(_head(nxt, 10) + " "):
        hits.append("열림:호명")
    v = min(1.0, 0.45 * len(hits))
    return len(hits), v, ("·".join(hits) if hits else "관용구 없음")


def _sig_closure(segs, st, idx):
    """앞 세그먼트가 문장을 닫았는가. 연결어미로 끝나면 **감점**이다."""
    text = nfc(segs[idx]["text"]).strip()
    if ANNOT_ONLY.match(text):
        return "annot", 0.0, "음향 주석, 중립"
    if st["song"][idx]:
        return "song", 0.0, "가사, 중립"
    punct = bool(PUNCT_END.search(text))
    body = PUNCT_END.sub("", text).strip().strip('"\'')
    last = re.findall(r"[가-힣]+", body)
    tail = last[-1] if last else ""
    if text.endswith("…") or text.endswith("..."):
        return tail, -0.1, "말끝 흐림"
    if tail and FINAL.search(tail):
        return tail, 0.6 + (0.4 if punct else 0.0), f"종결 '{tail}'{'.' if punct else ''}"
    # 문장부호가 있으면 연결어미 감점을 걸지 않는다. ASR 이 '?'를 찍었다는 건
    # 발화가 거기서 끝났다는 뜻이다. 이 순서가 없으면 '이제 땅추가?' 가 조사
    # '가'로 끝난다는 이유로 -0.6 을 먹고 진짜 장면 경계가 탈락한다 — 실측 5:00.
    if tail and CONT.search(tail):
        return tail, (0.3 if punct else -0.6), \
            f"연결어미 '{tail}'{' + 문장부호' if punct else ' — 문장 진행 중'}"
    if punct:
        return tail, 0.5, "문장부호로 종결"
    return tail, -0.2, "어미도 부호도 없음(잘린 발화)"


def _sig_opener(segs, st, idx):
    """뒤 세그먼트가 새 장면을 여는가, 직전 대화에 응답하는가."""
    nxt = nfc(segs[idx + 1]["text"]).strip()
    if OPEN_CONT.search(_head(nxt, 8)):
        return "cont", -0.7, "응답어로 시작(같은 대화)"
    if OPEN_NEW.search(_head(nxt, 24)):
        return "new", 0.8, "제안·의문으로 개시"
    if ANNOT_ONLY.match(nxt):
        return "annot", 0.1, "음향 주석"
    return "", 0.2, "중립"


def _sig_song(segs, st, idx):
    """노래 블록의 가장자리는 장(章) 경계다. 주제가가 끝나면 본편이 시작된다."""
    if st["song"][idx] != st["song"][idx + 1]:
        return "block", 1.0, "주제가 블록 경계"
    a = any(songlike(s["text"]) for s in segs[max(0, idx - 1):idx + 1])
    b = any(songlike(s["text"]) for s in segs[idx + 1:idx + 3])
    if a != b:
        return "seg", 0.5, "노래↔대사 전환(약)"
    return "", 0.0, "노래 경계 아님"


def _sig_pace(segs, st, idx, w=4):
    da = _density(segs, max(0, idx - w + 1), idx + 1)
    db = _density(segs, idx + 1, min(len(segs), idx + 1 + w))
    raw = abs(da - db)
    return raw, min(1.0, raw / 0.5), f"발화밀도 {da:.2f}→{db:.2f}"


_SIGNALS = {
    "gap": _sig_gap, "topic": _sig_topic, "cue": _sig_cue,
    "closure": _sig_closure, "opener": _sig_opener,
    "song": _sig_song, "pace": _sig_pace,
}


# ── 경계 점수 ───────────────────────────────────────────────────────────────
def score_boundary(segs: list[dict], idx: int) -> dict:
    """segs[idx] 와 segs[idx+1] **사이**가 장면 경계인지 점수화한다.

    반환에 신호별 기여도(points)를 담는다. 점수만 주고 이유를 못 대면
    경계가 틀렸을 때 어느 신호를 고쳐야 하는지 알 수 없다.

        {"idx", "t", "seg_id", "next_id", "score", "raw_score",
         "signals": {이름: {"raw","value","weight","points","why"}},
         "top": [기여 큰 순 신호 이름], "why": "사람이 읽는 한 줄"}
    """
    if not (0 <= idx < len(segs) - 1):
        raise IndexError(f"경계 인덱스 범위 밖: {idx} (세그먼트 {len(segs)}개)")
    st = _stats(segs)

    sig, total = {}, 0.0
    for name, fn in _SIGNALS.items():
        raw, value, why = fn(segs, st, idx)
        pts = WEIGHTS[name] * value
        total += pts
        sig[name] = {"raw": raw, "value": round(value, 4), "weight": WEIGHTS[name],
                     "points": round(pts, 4), "why": why}

    top = sorted(sig, key=lambda k: -sig[k]["points"])
    why = " · ".join(sig[k]["why"] for k in top[:3] if sig[k]["points"] > 0.01)
    return {
        "idx": idx, "t": segs[idx]["t1"], "seg_id": segs[idx]["id"],
        "next_id": segs[idx + 1]["id"],
        "score": round(max(0.0, min(1.0, total)), 4), "raw_score": round(total, 4),
        "signals": sig, "top": top, "why": why or "약한 신호만 있음",
        "gap": round(st["gaps"][idx], 2),
    }


# ── act 구성 ────────────────────────────────────────────────────────────────
def find_acts_scored(segs: list[dict], end: float, min_act: float) -> list[dict]:
    """경계 점수 상위 지점으로 act 를 만들고, 각 act 에 의미 있는 beat 라벨을 붙인다.

    act 개수는 목표 길이(min_act × 2.5)에서 역산하고, 점수가 MIN_SCORE 에 못 미치면
    **개수를 못 채워도 자르지 않는다**. 억지로 채운 경계는 무음 폴백과 다를 게 없다.

    반환 act 필드
        t0, t1              구간
        beat                짧은 라벨.  예: "다이아나핑 찾기"
        beat_quote          그 장면에서 가장 내용이 실린 실제 대사(원문 그대로)
        beat_keywords       화제어 상위 3개
        beat_id             beat_quote 를 뽑은 세그먼트 id
        cut_score/cut_why   이 act 를 **닫은** 경계의 점수와 근거
        cut_id, cut_gap     닫은 경계의 세그먼트 id, 그 지점의 실제 무음 길이
    """
    inside = [s for s in segs
              if s["t1"] <= end + 0.01 and s.get("conf") != "quarantine"]
    if len(inside) < 4 or end <= 0:
        return _build([(0.0, max(end, 0.0), inside, None)], set())

    song_ids = {s["id"] for s, f in zip(inside, _stats(inside)["song"]) if f}
    cands = [score_boundary(inside, i) for i in range(len(inside) - 1)]
    # act 목표 길이는 min_act 의 두 배. 2.5배로 잡았더니 티니핑에서 2:42–9:06
    # 짜리 6분 act 가 나왔다 — 그 안에서 장면이 세 번 바뀐다. 라벨 하나로
    # 6분을 대표할 수 없다.
    target = max(1, min(8, int(end // max(min_act * 2.0, 1.0)) - 1))
    ideal = end / (target + 1)
    spacing = max(min_act, ideal * SPACING_RATIO)

    picked: list[dict] = []
    for c in sorted(cands, key=lambda c: -c["score"]):
        if len(picked) >= target or c["score"] < MIN_SCORE:
            break
        t = c["t"]
        if t < spacing or end - t < spacing:
            continue
        if any(abs(t - p["t"]) < spacing for p in picked):
            continue
        picked.append(c)
    picked.sort(key=lambda c: c["t"])

    # 너무 긴 act 를 쪼갠다. 점수 순 그리디만 쓰면 강한 경계가 한쪽에 몰릴 때
    # 반대쪽이 통째로 남는다 — 티니핑에서 2:42–7:43 짜리 5분 act 가 나왔고,
    # 그 안에서 장면이 두 번 더 바뀐다. 라벨 하나로 5분을 대표할 수 없다.
    limit = ideal * MAX_ACT_RATIO
    for _ in range(MAX_EXTRA):
        edges = [0.0] + [p["t"] for p in picked] + [end]
        lo, hi = max(zip(edges, edges[1:]), key=lambda e: e[1] - e[0])
        if hi - lo <= limit:
            break
        room = [c for c in cands
                if lo + spacing <= c["t"] <= hi - spacing and c["score"] >= MIN_SCORE]
        if not room:
            break
        picked.append(max(room, key=lambda c: c["score"]))
        picked.sort(key=lambda c: c["t"])

    parts, prev, lo = [], 0.0, 0
    for c in picked:
        parts.append((prev, c["t"], inside[lo:c["idx"] + 1], c))
        prev, lo = c["t"], c["idx"] + 1
    parts.append((prev, end, inside[lo:], None))
    return _build(parts, song_ids)


def _build(parts, song_ids: set[str]) -> list[dict]:
    """act 껍데기를 만들고 라벨을 채운다. 세그먼트 원본은 반환에 넣지 않는다."""
    acts = [{
        "t0": round(t0, 2), "t1": round(t1, 2), "n_seg": len(bag),
        "beat": "", "beat_quote": "", "beat_keywords": [], "beat_id": None,
        "cut_score": cut["score"] if cut else None,
        "cut_why": cut["why"] if cut else "본편 끝",
        "cut_id": cut["seg_id"] if cut else None,
        "cut_gap": cut["gap"] if cut else None,
        "cut_top": cut["top"][:3] if cut else [],
    } for t0, t1, bag, cut in parts]
    _label_all(acts, [p[2] for p in parts], song_ids)
    return acts


def _label_all(acts: list[dict], bags: list[list[dict]], song_ids: set[str]) -> None:
    """act 라벨을 붙인다. 화제어는 **에피소드 안에서의** TF-IDF 로 고른다.

    전체 빈도만 보면 모든 act 라벨이 주인공 이름이 된다(티니핑 전 구간 '로미').
    다른 act 에 안 나오는 말이 그 장면을 구별하는 말이다.

    주제가 블록과 음향 주석은 통째로 뺀다. 안 빼면 티니핑 1막 라벨이 오프닝
    가사('오케이·캐치티니킹')가 된다 — 실측. 가사는 장면 내용이 아니다.

    빈도는 표면형이 아니라 **접두 2음절 키**로 센다. 표면형으로 세면
    '다이아나핑'과 '다이아나핑이라고'가 각각 1회가 되어 둘 다 탈락하고, 대신
    한 번만 나온 오인식 덩어리('노인짓이')가 화제어로 올라온다 — 실측."""
    docs, surf = [], []
    for bag in bags:
        kc, sf = Counter(), {}
        for s in bag:
            if s["id"] in song_ids or songlike(s["text"]) or ANNOT_ONLY.match(s["text"]):
                continue
            # 신뢰도가 낮은 세그먼트의 말은 절반만 센다. 브레드 마지막 장의
            # 화제어가 '숲과'(= 쑥과 의 오인식)로 잡혔는데, 그 줄들이 전부
            # conf=low 였다 — 정본이 못 믿는 말을 라벨로 내보낼 이유가 없다.
            w8 = 0.5 if s.get("conf") == "low" else 1.0
            for t in tokens(s["text"]):
                kc[t[:2]] += w8
                sf.setdefault(t[:2], Counter())[t] += 1
        docs.append(kc)
        surf.append(sf)

    n = len(docs)
    df = Counter()
    for c in docs:
        df.update(set(c))

    for a, bag, c, sf in zip(acts, bags, docs, surf):
        weight = {}
        for k, cnt in c.items():
            w = min(sf[k].items(), key=lambda x: (-x[1], len(x[0])))[0]
            weight[k] = (cnt * math.log(1 + n / (1 + df[k]))
                         * (VERB_PENALTY if w.endswith(VERBALISH) and len(w) >= 2 else 1.0)
                         * (1.0 if cnt >= 2 else 0.5))   # 한 번뿐인 말은 화제가 아니다
        top = sorted(weight, key=lambda k: (-weight[k], -len(k)))[:3]
        kws = [min(sf[k].items(), key=lambda x: (-x[1], len(x[0])))[0] for k in top]
        # 2등 화제어는 1등에 견줄 만할 때만 라벨에 넣는다. 안 그러면 '피타임·핏이'
        # 처럼 한 번 나온 오인식 조각이 라벨 절반을 차지한다 — 실측.
        head = weight[top[0]] if top else 0.0
        strong = [w for k, w in zip(top, kws) if weight[k] >= 0.5 * head]
        usable = [s for s in bag if s["id"] not in song_ids]
        quote, qid = _pick_quote(usable, weight)
        a["beat_keywords"] = kws
        a["beat_quote"] = quote
        a["beat_id"] = qid
        if bag and not usable:      # 통째로 주제가인 act — 지어내지 않는다
            a["beat"] = "(주제가)"
        else:
            a["beat"] = _compose(strong, quote, usable)


def _pick_quote(segs, weight) -> tuple[str, str | None]:
    """그 장면에서 가장 내용이 실린 한 줄. 노래·주석·옹알이는 후보에서 뺀다."""
    best, bid, bscore = "", None, -1e9
    span = (segs[-1]["t1"] - segs[0]["t0"]) if segs else 0.0
    for s in segs:
        text = nfc(s["text"]).strip()
        if ANNOT_ONLY.match(text) or songlike(text):
            continue
        toks = tokens(text)
        if len(set(toks)) < 2:
            continue
        v = sum(weight.get(t[:2], 0.0) for t in _keys(toks))
        v += 0.6 if 12 <= len(text) <= 44 else (-0.8 if len(text) > 60 else 0.0)
        v -= 1.2 if s.get("conf") == "low" else 0.0
        if span > 0:  # 장면의 전제는 보통 앞쪽에서 말해진다
            v += 0.5 * (1.0 - (s["t0"] - segs[0]["t0"]) / span)
        if v > bscore:
            best, bid, bscore = text, s["id"], v
    return best, bid


def _compose(kws, quote, segs) -> str:
    """라벨 조립. 알려진 서사 동사가 잡히면 명사구로, 아니면 화제어만 남긴다.

    없는 사건을 만들어 붙이지 않는다. 근거가 약하면 짧게 쓰는 쪽이 낫다."""
    text = " ".join(nfc(s["text"]) for s in segs)
    best, hits = None, 0
    for rx, nom in NOMINAL:
        n = len(rx.findall(text))
        if n > hits or (n == hits and n and rx.search(quote)):
            best, hits = nom, n
    if hits < 2:              # 한 번 스친 동사로 사건을 단정하지 않는다
        best = None
    if not kws:
        return best or (quote[:22] if quote else "(내용 부족)")
    if best:
        # 화제어와 명사구가 같은 말이면 겹쳐 쓰지 않는다 ("출발 출발" 방지)
        rest = [k for k in kws if k[:2] not in best and best[:2] not in k]
        return f"{rest[0]} {best}" if rest else best
    return "·".join(kws[:2])


# ── 비교용: 기존 2순위(최장 발화공백) 재구현 ────────────────────────────────
def find_acts_gap(segs: list[dict], end: float, min_act: float) -> list[dict]:
    """storydot.find_acts 의 2순위와 같은 규칙. 나란히 보려고 여기 옮겨 왔다."""
    inside = [s for s in segs
              if s["t1"] <= end + 0.01 and s.get("conf") != "quarantine"]
    gaps = []
    for i in range(len(inside) - 1):
        g = inside[i + 1]["t0"] - inside[i]["t1"]
        if g >= 2.0:
            gaps.append((g, inside[i]))
    gaps.sort(key=lambda x: -x[0])
    picks = sorted([s for _, s in gaps[:12]], key=lambda s: s["t1"])

    acts, prev = [], 0.0
    for b in picks:
        if b["t1"] - prev > min_act and b["t1"] <= end:
            acts.append({"t0": round(prev, 2), "t1": round(b["t1"], 2),
                         "beat": f"(무음 전환 {b['text'][:24]})", "beat_id": b["id"]})
            prev = b["t1"]
    if end - prev > min_act:
        acts.append({"t0": round(prev, 2), "t1": round(end, 2),
                     "beat": "(마지막 장)", "beat_id": None})
    return acts


# ── 출력 보조 ───────────────────────────────────────────────────────────────
def mmss(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def _rule(ch="─", n=92):
    return ch * n


# ── 자체검사 ────────────────────────────────────────────────────────────────
def _seg(i, t0, t1, text, conf="medium"):
    return {"id": f"t{i:03d}", "t0": float(t0), "t1": float(t1),
            "text": text, "conf": conf}


def selftest() -> None:
    """신호가 **무동작이 아님**을 증명한다. 각 신호를 단독으로 켜고 끈다."""
    ok = 0

    # ① 토큰화 — 주석·감탄사·의성어는 화제어가 아니다
    assert tokens("(끄덕끄덕) 우와! 다이아나핑을 찾자") == ["다이아나핑", "찾자"], \
        tokens("(끄덕끄덕) 우와! 다이아나핑을 찾자")
    assert _echoic("두근두근") and _echoic("흐흐흐") and not _echoic("다이아나핑")
    ok += 1

    # ② ASR 오인식 관용 — 접두 2음절이 같으면 같은 화제로 본다
    a = _keys(tokens("다이아나핑 어디 갔지"))
    b = _keys(tokens("다이어너핑 찾으러 가자"))
    assert a & b, "오인식 변이가 전부 화제 전환으로 잡히면 안 된다"
    ok += 1

    # ③ gap — 같은 문장 흐름에서 공백만 키우면 점수가 올라야 한다
    base = [_seg(i, i * 3, i * 3 + 2.5, t) for i, t in enumerate(
        ["열차가 곧 출발해요", "표를 보여주세요", "여기 있어요", "고맙습니다"])]
    tight = base + [_seg(9, 12.5, 15, "다들 앉으세요"), _seg(10, 15, 17, "네 알겠어요")]
    loose = base + [_seg(9, 30.0, 32.5, "다들 앉으세요"), _seg(10, 32.5, 35, "네 알겠어요")]
    assert score_boundary(loose, 3)["signals"]["gap"]["value"] > \
           score_boundary(tight, 3)["signals"]["gap"]["value"]
    ok += 1

    # ④ topic — 어휘가 통째로 바뀌면 화제 거리가 커진다
    same = [_seg(i, i * 3, i * 3 + 2, t) for i, t in enumerate([
        "열차 표를 보여주세요", "열차가 출발합니다", "열차 안이 참 넓네요",
        "열차 창밖이 예뻐요", "열차 여행은 즐거워", "열차에서 내려요"])]
    shift = [_seg(i, i * 3, i * 3 + 2, t) for i, t in enumerate([
        "열차 표를 보여주세요", "열차가 출발합니다", "열차 안이 참 넓네요",
        "이발소 간판이 똑같아", "이발소 사장을 만나야겠어", "이발소로 들어가자"])]
    d_same = _stats(same)["tdist"][2]
    d_shift = _stats(shift)["tdist"][2]
    assert d_shift > d_same, (d_shift, d_same)
    ok += 1

    # ⑤ closure — 연결어미로 끝나면 감점, 종결어미면 가점
    cut = [_seg(0, 0, 2, "밥을 먹고"), _seg(1, 4, 6, "학교에 갔어요")]
    done = [_seg(0, 0, 2, "밥을 먹었어요."), _seg(1, 4, 6, "학교에 갔어요")]
    assert score_boundary(cut, 0)["signals"]["closure"]["value"] < 0
    assert score_boundary(done, 0)["signals"]["closure"]["value"] > 0
    ok += 1

    # ⑥ cue / opener — 관용구와 응답어
    go = [_seg(0, 0, 2, "아무튼 다이아나핑을 어서 찾아보자!"),
          _seg(1, 4, 6, "여긴 어디지? 처음 보는 곳인데")]
    reply = [_seg(0, 0, 2, "아무튼 다이아나핑을 어서 찾아보자!"),
             _seg(1, 4, 6, "응. 그러니까 나도 그렇게 생각했어")]
    assert score_boundary(go, 0)["signals"]["cue"]["value"] > 0
    assert score_boundary(reply, 0)["signals"]["opener"]["value"] < 0
    assert score_boundary(go, 0)["score"] > score_boundary(reply, 0)["score"]
    ok += 1

    # ⑦ song — 주제가 블록의 가장자리는 발화해야 한다.
    #    한 줄로는 못 잡는다(토큰 3개). 붙어 있는 런 전체로 봐야 갈린다.
    song = [_seg(i, i * 4, i * 4 + 4,
                 "캐치 티니핑 캐치 티니핑 캐치 티니핑") for i in range(9)]
    song += [_seg(9, 41, 44, "출발! 프린세스 열차입니다."),
             _seg(10, 44, 46, "표를 보여주세요.")]
    assert _song_mask(song)[:9] == [True] * 9
    assert _song_mask(song)[9:] == [False, False]
    assert score_boundary(song, 8)["signals"]["song"]["value"] == 1.0
    assert score_boundary(song, 3)["signals"]["song"]["value"] == 0.0
    ok += 1

    # ⑧ 기여도 합 = raw_score (설명 가능성 불변식)
    r = score_boundary(go, 0)
    assert abs(sum(s["points"] for s in r["signals"].values()) - r["raw_score"]) < 1e-6
    assert set(r["signals"]) == set(WEIGHTS)
    ok += 1

    # ⑨ act 불변식 — 연속·정렬·최소길이·라벨
    segs = []
    scenes = [["열차가 곧 출발해요", "표를 보여주세요", "여기 있어요", "다들 앉으세요"],
              ["다이아나핑이 사라졌어", "어서 다이아나핑을 찾아보자", "어디로 갔을까",
               "다이아나핑을 찾아야 해"],
              ["이발소 간판이 똑같잖아", "이발소 사장을 만나야겠어", "이발 대결을 하자",
               "대결을 시작하죠"]]
    t = 0.0
    for k, sc in enumerate(scenes):
        for line in sc:
            segs.append(_seg(len(segs), t, t + 4.0, line))
            t += 4.5
        t += 12.0
    acts = find_acts_scored(segs, end=t, min_act=15.0)
    assert len(acts) >= 2, acts
    assert acts[0]["t0"] == 0.0 and abs(acts[-1]["t1"] - t) < 0.01
    for p, q in zip(acts, acts[1:]):
        assert abs(p["t1"] - q["t0"]) < 1e-6, "act 가 끊기면 안 된다"
        assert p["t1"] > p["t0"]
    for a in acts:
        assert a["beat"] and not a["beat"].startswith("(무음"), a["beat"]
    ok += 1

    # ⑩ 짧은 입력·빈 입력에서 죽지 않는다
    assert len(find_acts_scored([], 0.0, 30.0)) == 1
    assert len(find_acts_scored(segs[:3], 20.0, 30.0)) == 1
    try:
        score_boundary(segs, len(segs) - 1)
        raise AssertionError("범위 밖 인덱스는 예외여야 한다")
    except IndexError:
        pass
    ok += 1

    # ⑪ 호명 오탐 — 정규식만 쓰면 비명이 전부 부름말이 된다
    assert _is_vocative("안돼 얘들아!")
    assert not _is_vocative("으아아아아아!"), "비명은 호명이 아니다"
    assert not _is_vocative("로미, 정신 차려!")
    ok += 1

    # ⑫ 라벨 조립 — 겹말·의성어·겹조사
    assert _destem("다이아나핑이라고") == "다이아나핑"
    assert tokens("으아악! 우와! 흐흠...") == [], tokens("으아악! 우와! 흐흠...")
    go_segs = [_seg(0, 0, 2, "출발! 프린세스 열차!"), _seg(1, 2, 4, "어서 타자!"),
               _seg(2, 4, 6, "곧 출발해요!")]
    assert _compose(["출발"], "출발! 프린세스 열차!", go_segs) == "출발", \
        _compose(["출발"], "출발! 프린세스 열차!", go_segs)
    find_segs = [_seg(0, 0, 2, "다이아나핑을 찾아보자!"), _seg(1, 2, 4, "어디서 찾을까?"),
                 _seg(2, 4, 6, "다이아나핑을 찾아야 해!")]
    assert _compose(["다이아나핑"], "다이아나핑을 찾아보자!", find_segs) == "다이아나핑 찾기"
    assert _compose([], "", []) == "(내용 부족)"
    ok += 1

    print(f"자체검사 {ok}/12 통과")


# ── 실데이터 비교 ───────────────────────────────────────────────────────────
def compare(name: str, path: Path | None = None) -> dict | None:
    path = path or (WORK / f"{name}_plan.json")
    if not path.exists():
        print(f"  건너뜀 — {path} 없음")
        return None
    plan = json.loads(path.read_text())
    canon = plan["canonical"]
    end = plan["end"]
    min_act = plan["params"]["min_act"]

    print(f"\n{_rule('━')}\n{name}   본편 {mmss(end)} · 세그먼트 {len(canon)}개 · "
          f"min_act {min_act:.0f}s · 기존 폴백 = {plan['act_source']}\n{_rule('━')}")

    old_gap = find_acts_gap(canon, end, min_act)
    new = find_acts_scored(canon, end, min_act)
    # 기준선은 무음공백 규칙이다. plan["acts"] 는 파이프라인이 이미 beats 로
    # 갈아탄 뒤일 수 있으므로 "기존"이라고 부르면 거짓말이 된다.
    old_ship = old_gap if plan["act_source"] == "beats" else plan["acts"]

    print(f"\n[기존] 무음공백(2순위) 규칙 — {len(old_gap)}개")
    for i, a in enumerate(old_gap, 1):
        print(f"  {i}  {mmss(a['t0']):>5}–{mmss(a['t1']):<5}  {a['beat']}")

    if plan["act_source"] not in ("speech-gap", "beats"):
        print(f"\n[참고] 이 작품이 실제로 탄 경로 ({plan['act_source']}) — {len(plan['acts'])}개")
        for i, a in enumerate(plan["acts"], 1):
            print(f"  {i}  {mmss(a['t0']):>5}–{mmss(a['t1']):<5}  {a['beat']}")

    print(f"\n[신규] 경계점수 — {len(new)}개")
    for i, a in enumerate(new, 1):
        kw = "·".join(a["beat_keywords"][:3])
        print(f"  {i}  {mmss(a['t0']):>5}–{mmss(a['t1']):<5}  {a['beat']}")
        print(f"       화제어 {kw or '—'}")
        print(f"       대표대사 “{a['beat_quote'][:52]}”  [{a['beat_id']}]")
        if a["cut_score"] is not None:
            print(f"       경계 {a['cut_score']:.2f} ← {a['cut_why']}")

    # 나란히 보기
    print(f"\n[비교] 경계 시각과 라벨")
    print(f"  {'기존':<44} {'신규':<44}")
    rows = max(len(old_ship), len(new))
    for i in range(rows):
        lo = (f"{mmss(old_ship[i]['t1']):>5}  {old_ship[i]['beat'][:34]}"
              if i < len(old_ship) else "")
        ln = (f"{mmss(new[i]['t1']):>5}  {new[i]['beat'][:34]}"
              if i < len(new) else "")
        print(f"  {lo:<44} {ln:<44}")

    # 신호 기여도
    cuts = [a for a in new if a["cut_score"] is not None]
    if cuts:
        inside = [s for s in canon if s["t1"] <= end + 0.01 and s["conf"] != "quarantine"]
        scored = [score_boundary(inside, i) for i in range(len(inside) - 1)]
        chosen = {a["cut_id"] for a in cuts}
        sel = [c for c in scored if c["seg_id"] in chosen]
        print(f"\n[신호] 채택된 경계 {len(sel)}곳에서 각 신호가 실제로 낸 점수")
        print(f"  {'신호':<9}{'평균기여':>9}{'최대':>8}{'1위횟수':>9}   전체경계 평균기여")
        allavg = {k: sum(c["signals"][k]["points"] for c in scored) / len(scored)
                  for k in WEIGHTS}
        for k in sorted(WEIGHTS, key=lambda k: -sum(c["signals"][k]["points"] for c in sel)):
            pts = [c["signals"][k]["points"] for c in sel]
            first = sum(1 for c in sel if c["top"][0] == k)
            print(f"  {k:<9}{sum(pts) / len(pts):>9.3f}{max(pts):>8.3f}"
                  f"{first:>9}   {allavg[k]:>13.3f}")

        # 개입 여유(브레드 확인용) — 경계에 실제로 얼마나 무음이 있는가
        print(f"\n[여유] 경계별 실제 무음 (개입 페이드에 3.0s 필요)")
        for a in cuts:
            flag = "○ 충분" if a["cut_gap"] >= 3.0 else (
                "△ 스냅 필요" if a["cut_gap"] >= 1.0 else "✕ 없음")
            print(f"  {mmss(a['t1']):>5}  무음 {a['cut_gap']:>5.2f}s  {flag}   {a['beat']}")
        enough = sum(1 for a in cuts if a["cut_gap"] >= 3.0)
        print(f"  → 3.0s 이상 {enough}/{len(cuts)}곳, 1.0s 이상 "
              f"{sum(1 for a in cuts if a['cut_gap'] >= 1.0)}/{len(cuts)}곳")

    return {"name": name, "old": old_ship, "new": new}


def main(argv: list[str]) -> int:
    """python3 beats.py [plan.json ...] — 인자를 주면 그 plan 으로 비교한다."""
    selftest()
    if argv:
        for p in argv:
            path = Path(p)
            compare(path.stem.replace("_plan", ""), path)
    else:
        for name in ("티니핑1화", "브레드1화"):
            compare(name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
