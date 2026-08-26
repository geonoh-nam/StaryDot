"""화면 관찰자 — 관찰과 출제를 분리한다. (신규 · 기존 파일 무수정)

전사(대사) 쪽은 관찰(ASR 이중 패스)과 출제가 분리돼 있는데 화면 쪽만 섞여 있었다.
생성자가 프레임을 보면서 동시에 문항을 만들었다. 두 가지가 깨진다.

  · 자기가 본 것에 유리하게 문제를 만들 여지가 열린다
  · '시각 이해의 기여' 를 따로 잴 수 없다 — 빼면 생성 자체가 안 되니까

여기서 관찰을 독립 단계로 세운다. 그리고 **관찰 결과를 픽셀 산술이 반증한다.**

    프레임 ──► VLM 관찰자 (별도 프로세스)   "무엇이 몇 개, 무슨 색, 어떤 크기"
                      │                     출제는 하지 않는다
                      ▼
              팔레트 반증 검사               관찰한 색이 absent 대역이면 그 사물 폐기
                      │                     모델 없이, 산술로
                      ▼
              화면 재료 (fact)               대사 재료와 같은 형식

색 팔레트는 언어모델 사전지식을 공유하지 않으므로, VLM 이 환각해도 독립적으로
반박할 수 있다. 문헌이 말하는 '오류 바닥' 을 뚫는 자리가 여기다.

관찰 대상 프레임은 **색이 다양한 것**을 고른다. 단색 화면(빈 하늘 등)은 셀 것도
물을 것도 없다. facts.py 가 이미 12초 간격으로 팔레트를 계산해 두었으므로 그것을
쓴다 — 영상을 다시 훑지 않는다.

    python3 observe.py 타요1화 --dry     프레임 선택·추출만 (LLM 호출 없음)
    python3 observe.py 타요1화           관찰 + 반증 + 재료 생성
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from itertools import combinations
from pathlib import Path

import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
SHOTS = WORK / "shots"
SKILL = ROOT / "skills" / "observe" / "SKILL.md"
TIMEOUT = 600

N_FRAMES = 8        # 편당 관찰할 프레임 수. 마무리 문항이 최대 5개니 이 정도면 넉넉하다
PER_CALL = 4        # 한 호출에 묶을 프레임 수. 프레임마다 부르면 편당 60회가 된다

# ── 반복 관찰 합의 ──────────────────────────────────────────────────────────
# 팔레트는 **색만** 반증한다. 개수·크기·도형·이름은 지금 아무도 검증하지 않는다.
# 연결 성분으로 개수를 세려던 시도는 실패했고(동종 사물의 색이 서로 다르다),
# 대사 쪽처럼 이질 채널을 하나 더 둘 방법이 없다.
#
# 그래서 같은 프레임을 N번 독립 관찰해 **매번 같게 나온 것만** 채택한다
# (SelfCheckGPT 의 원리를 관찰 단계에 적용). 샘플링 노이즈로 흔들리는 주장은
# 걸러지고, 일관된 주장만 남는다. 공유 편향으로 매번 같게 틀리는 것은 못 막는다 —
# 그건 다른 채널이 필요하고, 그 한계를 먼저 수치로 확인하려는 것이 이 단계다.
AGREE = 0.6         # 이 비율 이상의 회차에서 같아야 채택
SIZES = {"큼", "보통", "작음"}

# 몇 개까지 세게 할 것인가. 두 가지가 걸려 있다.
#
# 아이 쪽: 2~3 은 세지 않고 한눈에 안다(subitizing). 4~5 부터 실제로 세기 시작한다.
#   그래서 수 자체가 난이도다 — 같은 프레임에서 "빨간 차 2대"는 3세, "5대"는 5세 문항이다.
# 우리 쪽: 6 을 넘어가면 흐린 프레임에서 **우리도 정답을 눈으로 검증할 수 없다.**
#   실제로 "나무 6그루"를 확인하지 못해 버린 적이 있다. 그래서 5 가 천장이다.
#
# 출제 상한을 7세로 넓힌 뒤에도 이 천장은 그대로 둔다. 6·7세는 초등 저학년이라 6~10 을
# 세는 게 발달상 맞지만, 막는 것은 아이의 능력이 아니라 **우리의 검증 능력**이다.
# 그래서 6·7세는 수가 아니라 **어휘**로 오른다(WORD_AGE 의 6·7세 대역).
# 프레임 해상도가 오르거나 사람 검수가 붙으면 여기만 늘리면 된다.
COUNT_AGE = {2: 3, 3: 3, 4: 4, 5: 5}
COUNT_MAX = max(COUNT_AGE)

# 모으기·덧셈(6·7세)의 합 상한. 초등 1학년 덧셈이 한 자리 수 범위이고, 그보다 크면
# 아이도 화면에서 확인하기 어렵다. **여기서 새로 세는 것은 없다** — 이미 합의를 통과한
# 묶음의 수를 더할 뿐이라 COUNT_MAX 의 검증 한계를 건드리지 않는다.
SUM_MAX = 10
SUM_MIN = 3                 # 1+1 은 셀 것도 모을 것도 없다. 합이 3 부터 문항이 된다
SUM_PARTS = (2, 3)          # 몇 묶음까지 합칠 것인가. 넷을 부르면 문항이 길어 못 읽는다
# 수 가르기(차) 는 합과 재료 조건이 다르다 — **수가 다른** 두 묶음이라야 성립한다.
# 큰 쪽이 3 미만이면 "2개와 1개" 라 세지 않고도 보인다. 뺄셈 문항이 아니라 눈짐작이다.
DIFF_MIN_BIG = 3
DIFF_AGE = 7                # 한 자리 수 뺄셈은 초등 1학년이다
# 아이에게 읽어 줄 말. "빨강 차" 가 아니라 "빨간 차" 여야 문항이 사람 말이 된다.
COLOR_ADJ = {"빨강": "빨간", "주황": "주황색", "노랑": "노란", "초록": "초록색",
             "파랑": "파란", "보라": "보라색", "분홍": "분홍색", "갈색": "갈색",
             "검정": "검은", "흰색": "하얀", "회색": "회색"}
# 창작형은 정답이 없으므로 **프레임만 있으면 성립한다.** 특정 재료 종류에만
# 묶어 두면 모델이 다른 재료를 골랐을 때 통째로 폐기된다 — 실측으로 겪었다.
CREATIVE_AFFORD = ["장면 감상", "가장 좋았던 장면", "그림으로 표현"]


def pick_frames(facts: list[dict], n: int = N_FRAMES) -> list[dict]:
    """색이 다양한 프레임을 시간축에 고르게 고른다.

    단색 화면은 재료가 안 된다 — 빈 하늘을 관찰해 봐야 셀 것이 없다.
    색 대역(present) 개수를 다양성의 대리 지표로 쓴다.
    """
    col = [f for f in facts if f["kind"] == "color"]
    if not col:
        return []
    ranked = sorted(col, key=lambda f: -len(f["payload"]["present"]))
    top = ranked[:max(n * 3, n)]                  # 다양성 상위 풀에서
    top.sort(key=lambda f: f["t0"])
    if len(top) <= n:
        return top
    step = len(top) / n                            # 시간축에 고르게
    return [top[int(i * step)] for i in range(n)]


def extract(video: Path, picks: list[dict]) -> list[dict]:
    """관찰용 jpg 를 뽑는다. 이미 있으면 다시 만들지 않는다."""
    out = []
    for i, f in enumerate(picks, 1):
        try:
            fr = visual.extract_evidence_frames(video, f["t0"], span=0.0, n=1,
                                                out_dir=SHOTS)
            out.append({"id": f"sc{i:03d}", "t": f["t0"], "path": fr[0]["path"],
                        "palette": f["payload"]})
        except Exception as exc:
            print(f"    프레임 실패 t={f['t0']:.0f}: {exc}")
    return out


# ── 관찰 ────────────────────────────────────────────────────────────────────
def _run_claude(prompt: str, skill: str | None) -> str:
    cmd = ["claude", "-p", prompt]
    if skill:
        cmd += ["--append-system-prompt", skill]
    cmd += ["--allowed-tools", "Read", "--add-dir", str(WORK), "--output-format", "json"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT,
                       cwd=ROOT, stdin=subprocess.DEVNULL)
    if r.returncode != 0:
        raise RuntimeError(f"claude 실패(rc={r.returncode}): {r.stderr[-200:]}")
    return storydot.claude_result(r.stdout)


def _first_json(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        raise ValueError(f"JSON 없음: {text[:150]}")
    depth = 0
    in_str = esc = False
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("JSON 이 안 닫혔다")


def _claude(prompt: str) -> dict:
    return _first_json(_run_claude(prompt, SKILL.read_text()))


def _key(name: str) -> str:
    """객체 동일성 판정. '버스'/'버스들' 은 같게 본다.

    앞 두 글자만 쓰던 때가 있었는데, 색으로 나눠 세기 시작하면서 그걸로는
    '빨간 차' 와 '빨간 버스' 가 한 덩어리가 된다. 이름 전체로 본다.
    """
    return "".join(str(name).split()).rstrip("들")


def consensus(runs: list[list[dict]], frames: dict) -> tuple[list[dict], dict]:
    """N 회 관찰에서 **합의된 것만** 남긴다. 항목별 흔들림도 함께 낸다."""
    n = len(runs)
    need = max(2, round(n * AGREE)) if n > 1 else 1
    stat = {"runs": n, "need": need, "obj_seen": 0, "obj_kept": 0,
            "count_split": [], "size_split": 0, "name_only_once": 0}

    by_frame: dict[str, list[list[dict]]] = {}
    for run in runs:
        for o in run:
            by_frame.setdefault(o.get("frame_id"), []).append(o)

    out = []
    for fid, obs in by_frame.items():
        if fid not in frames:
            continue
        # 객체를 이름 키로 모은다
        bag: dict[str, list[dict]] = {}
        for o in obs:
            for ob in o.get("objects") or []:
                if ob.get("name"):
                    bag.setdefault(_key(ob["name"]), []).append(ob)
        good = []
        for k, cands in bag.items():
            stat["obj_seen"] += 1
            if len(cands) < need:                     # 몇 회차에만 등장 = 못 믿는다
                stat["name_only_once"] += 1
                continue
            names = Counter(str(c["name"]) for c in cands)
            counts = Counter(c.get("count") for c in cands if isinstance(c.get("count"), int))
            if not counts:
                continue
            top_n, top_c = counts.most_common(1)[0]
            if top_c < need:                          # 개수가 회차마다 다르다
                stat["count_split"].append((names.most_common(1)[0][0],
                                            sorted(counts.elements())))
                continue
            cols = Counter(c for x in cands for c in (x.get("colors") or []))
            keep_cols = [c for c, v in cols.items() if v >= need]
            sizes = Counter(x.get("size") for x in cands if x.get("size"))
            size = None
            if sizes:
                sv, sc = sizes.most_common(1)[0]
                if sc >= need:
                    size = sv
                else:
                    stat["size_split"] += 1
            stat["obj_kept"] += 1
            good.append({"name": names.most_common(1)[0][0], "count": top_n,
                         "colors": keep_cols, "size": size})
        shapes = Counter(sh for o in obs for sh in (o.get("shapes") or []))
        keep_sh = [sh for sh, v in shapes.items() if v >= need]
        if good or keep_sh:
            fr = frames[fid]
            out.append({"frame_id": fid, "objects": good, "shapes": keep_sh,
                        "t": fr["t"], "path": fr["path"],
                        "absent": sorted(fr["palette"].get("absent", []))})
    return out, stat


def observe(frames: list[dict]) -> list[dict]:
    obs = []
    for i in range(0, len(frames), PER_CALL):
        batch = frames[i:i + PER_CALL]
        lines = ["## 관찰할 프레임 — Read 로 전부 열어 봐라", ""]
        for f in batch:
            lines.append(f"  {f['id']}  {f['path']}")
        lines += ["", f"위 {len(batch)}장을 순서대로 관찰해라."]
        print(f"  · {len(batch)}장 관찰 중 …", flush=True)
        try:
            got = _claude("\n".join(lines))
            obs += got.get("observations", [])
        except Exception as exc:
            print(f"    실패: {type(exc).__name__}: {exc}")
    return obs


# ── 팔레트 반증 ─────────────────────────────────────────────────────────────
def falsify(obs: list[dict], frames: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """관찰한 색이 화면에 실재하는가. **모델 없이 산술로 반박한다.**

    팔레트의 absent 대역(면적 0.5% 미만)은 '확정 부재' 다. 거기 있는 색을
    사물의 색이라고 관찰했다면 그 사물을 통째로 버린다. trace(애매) 는 통과시킨다 —
    작은 사물은 면적이 작아 trace 로 떨어지는 게 정상이다.
    """
    kept, dropped = [], []
    for o in obs:
        fr = frames.get(o.get("frame_id"))
        if fr is None:
            dropped.append({**o, "drop": f"없는 프레임 — {o.get('frame_id')}"})
            continue
        absent = set(fr["palette"].get("absent", []))
        good = []
        for ob in o.get("objects", []):
            cols = [c for c in (ob.get("colors") or []) if c in visual.COLOR_NAMES]
            bad = [c for c in cols if c in absent]
            if bad:
                dropped.append({"frame_id": o["frame_id"], "obj": ob,
                                "drop": f"화면에 없는 색 — {', '.join(bad)}"})
                continue
            # 색별로 세라고 시켰는데 여러 색이 붙어 있으면 그 그룹은 못 믿는다 —
            # "빨간 차 몇 대" 가 이 색 하나를 그대로 정답 근거로 쓴다.
            if len(cols) != 1:
                dropped.append({"frame_id": o["frame_id"], "obj": ob,
                                "drop": f"색이 하나가 아니다 — {cols or '없음'}"})
                continue
            n = ob.get("count")
            if not isinstance(n, int) or not 1 <= n <= 20:
                dropped.append({"frame_id": o["frame_id"], "obj": ob,
                                "drop": f"개수가 이상하다 — {n}"})
                continue
            if not ob.get("name"):
                continue
            good.append({**ob, "colors": cols,
                         "size": ob.get("size") if ob.get("size") in SIZES else None})
        if good or o.get("shapes"):
            kept.append({**o, "objects": good, "t": fr["t"], "path": fr["path"],
                         "absent": sorted(absent)})
    return kept, dropped


# ── 화면 재료 ───────────────────────────────────────────────────────────────
# 사물 이름을 아는 나이. **이 표에 없는 말은 문항에 쓰지 않는다** — 표가 곧 허용 목록이다.
# 같은 유형(개수 세기)이라도 무엇을 세느냐로 난이도가 갈린다. "빨간 차 3개"는 3세가 풀고
# "갈색 액자 3개"는 5세도 '액자'를 먼저 알아야 한다. 유형이 아니라 어휘가 연령을 정한다.
#
# 등급은 3~7세다. 3~5세는 누리과정, 6·7세는 초등 1~2학년이다. 수 천장이 5 로 묶여 있으므로
# (COUNT_AGE) 6·7세 문항은 **이 표의 6·7세 대역이 유일한 출처**다 — 어려운 말을 아는
# 나이여야 풀리는 문항. 여기가 비면 그 나이 칸은 통째로 건너뛴다(generate3.py).
#
# 표에 없어서 버려진 말은 관찰 때마다 출력된다. 유아가 아는 말이면 여기 추가하면 되고,
# 상위 범주('동물', '인물', '캐릭터')나 우리가 지어낸 합성어('우유팩 캐릭터')는 넣지 마라 —
# 아이가 화면에서 무엇을 세야 하는지 모른다.
WORD_AGE = {
    # 3세 — 매일 부르는 말
    "상어": 3, "버스": 3, "차": 3, "자동차": 3, "기차": 3, "나무": 3, "잎": 3,
    "문": 3, "손": 3, "팔": 3, "발": 3, "머리": 3, "눈": 3, "코": 3, "입": 3, "귀": 3,
    "인형": 3, "상자": 3, "빵": 3, "물고기": 3, "가방": 3, "의자": 3, "안경": 3,
    "종이": 3, "공": 3, "컵": 3, "신발": 3, "모자": 3, "꽃": 3, "새": 3, "별": 3,
    "달": 3, "집": 3, "고양이": 3, "강아지": 3, "우산": 3, "시계": 3,
    # 4세 — 아는 말이지만 한 번 더 짚어야 한다
    "소파": 4, "헬멧": 4, "이불": 4, "화분": 4, "왕관": 4, "목걸이": 4, "넥타이": 4,
    "조개": 4, "램프": 4, "조명": 4, "가위": 4, "우체통": 4, "트럭": 4, "머핀": 4,
    "파이": 4, "우유팩": 4, "글자": 4, "열차": 4, "칫솔": 4, "접시": 4, "냄비": 4,
    # 5세 — 어휘가 어렵거나 경계가 흐리다
    "액자": 5, "기둥": 5, "건물": 5, "울타리": 5, "간판": 5,

    # ── 아래는 실제 관찰(10편)에서 표에 없어 버려졌던 말들이다. 등급은 사람이 정했다.
    # 3세
    "곰": 3, "나비": 3, "딸기": 3, "케이크": 3, "창문": 3, "사진": 3, "병": 3,
    "그릇": 3, "돌": 3, "로봇": 3, "휴대폰": 3, "우유": 3, "사과": 3, "바나나": 3,
    "토끼": 3, "오리": 3, "돼지": 3, "말": 3, "소": 3, "양말": 3, "숟가락": 3,
    # 4세
    "바위": 4, "탁자": 4, "사다리": 4, "선반": 4, "쓰레기통": 4, "주전자": 4,
    "크림": 4, "선인장": 4, "등불": 4, "가방끈": 4, "리본": 4, "단추": 4,
    "빗자루": 4, "양동이": 4, "장갑": 4, "목도리": 4,
    # 5세
    "통나무": 5, "거품": 5,
    "구슬": 5, "손잡이": 5, "지붕": 5, "계단": 5, "굴뚝": 5, "깃발": 5,

    # ── 6·7세는 초등 1~2학년이다. 누리과정 밖이라 기준이 달라진다.
    # 6세 — 말은 알지만 일상 대화보다 그림책·교과에서 만나는 말
    "차양": 6, "창살": 6, "부스": 6, "산호": 6, "트로피": 6, "고글": 6,
    "안테나": 6, "표지판": 6, "소화전": 6, "등대": 6, "돛": 6, "닻": 6,
    "저울": 6, "지도": 6, "망원경": 6, "온도계": 6, "화살표": 6, "무대": 6,
    # 7세 — 사물의 부품·구조를 가리키는 말. 이름을 알아야 화면에서 짚어 낸다
    "계기판": 7, "배기구": 7, "도르래": 7, "톱니바퀴": 7, "전봇대": 7,
    "컨베이어": 7, "굴착기": 7, "수문": 7, "철로": 7, "나침반": 7, "피뢰침": 7,
}
WORD_AGE = {"".join(k.split()): v for k, v in WORD_AGE.items()}


def word_age(name: str) -> int | None:
    """이 말을 문항에 쓸 수 있는 가장 어린 나이. 표에 없으면 None — 쓰지 않는다."""
    return WORD_AGE.get("".join(str(name).split()))


def _label(ob: dict) -> str:
    """아이에게 읽어 줄 이름. 색으로 나눠 세었으니 색까지 붙여야 무엇을 세는지 분명해진다.

    '소방차 몇 대' 는 아이가 소방차와 구급차를 먼저 갈라야 답할 수 있다. '빨간 차 몇 대'
    는 색만 보면 된다 — 그리고 그 답을 우리도 프레임을 보고 바로 확인할 수 있다.
    """
    cols = ob.get("colors") or []
    return f"{COLOR_ADJ[cols[0]]} {ob['name']}" if cols and cols[0] in COLOR_ADJ else ob["name"]


def to_facts(kept: list[dict]) -> tuple[list[dict], list[str]]:
    """관찰 결과를 대사 재료와 같은 형식으로 바꾼다.

    재료마다 `age_min` 을 달아 보낸다 — 이 말을 아는 나이다. 출제는 그 아래 연령으로
    문항을 낼 수 없다. 표에 없는 말은 재료가 되지 못하고, 무엇이 빠졌는지 함께 돌려준다.
    """
    out, unknown = [], []
    for k, o in enumerate(kept, 1):
        objs = o["objects"]
        base = {"t0": o["t"], "t1": o["t"], "evidence": [o["frame_id"]],
                "frame": o["path"], "conf": "medium"}
        fr_absent = o.get("absent", [])          # 그 프레임에서 확정 부재인 색
        # 같은 사물이 색만 다르게 여러 줄로 잡힌 프레임에서는 "무슨 색인가요" 가 성립하지
        # 않는다 — 빨간 차와 파란 차가 같이 있는데 "차는 무슨 색?" 은 답이 둘이다.
        by_name = Counter(x["name"] for x in objs)
        for j, ob in enumerate(objs, 1):
            age = word_age(ob["name"])
            if age is None:                      # 아이가 모르는 말로는 문제를 못 낸다
                unknown.append(ob["name"])
                continue
            label = _label(ob)
            if 2 <= ob["count"] <= COUNT_MAX:
                # 어휘와 수 중 **더 어려운 쪽**이 연령을 정한다. "빨간 차"(3세 말)를
                # 다섯 대 세는 건 세 살에게 어휘가 아니라 수에서 막힌다.
                out.append({**base, "age_min": max(age, COUNT_AGE[ob["count"]]),
                            "id": f"cnt{k:02d}{j:02d}", "kind": "count",
                            "payload": {"name": label, "n": ob["count"]},
                            "afford": ["개수 세기", "같은 것 찾기"] + CREATIVE_AFFORD})
            if ob["colors"] and by_name[ob["name"]] == 1:
                out.append({**base, "age_min": age,
                            "id": f"ocl{k:02d}{j:02d}", "kind": "objcolor",
                            "payload": {"name": ob["name"], "colors": ob["colors"],
                                        "absent": fr_absent},
                            "afford": ["색깔 퀴즈"] + CREATIVE_AFFORD})
            out.append({**base, "age_min": age,
                        "id": f"who{k:02d}{j:02d}", "kind": "presence",
                        "payload": {"name": label},
                        "afford": ["누가 나왔나"] + CREATIVE_AFFORD})
        # 크기 비교는 한 프레임에 큼·작음이 함께 있어야 성립한다.
        # 두 사물을 견주는 문제라 **둘 다 아는 나이**여야 낼 수 있다.
        known = [x for x in objs if word_age(x["name"]) is not None]
        big = [_label(x) for x in known if x.get("size") == "큼"]
        small = [_label(x) for x in known if x.get("size") == "작음"]
        size_age = max((word_age(x["name"]) for x in known
                        if x.get("size") in ("큼", "작음")), default=None)
        if big and small:
            out.append({**base, "age_min": size_age,
                        "id": f"siz{k:02d}", "kind": "size",
                        "payload": {"big": big[0], "small": small[0]},
                        "afford": ["크기 비교"] + CREATIVE_AFFORD})
        # 모으기·덧셈 — 프레임 안의 여러 묶음을 합친다. 6세는 모으기(합 5 이하),
        # 7세는 한 자리 덧셈이다. 같은 라벨이 둘이면 못 묻는다("빨간 차와 빨간 차").
        groups: dict[str, tuple[int, int]] = {}
        for ob in objs:
            a = word_age(ob["name"])
            if a is not None and 1 <= ob["count"] <= COUNT_MAX:
                groups.setdefault(_label(ob), (ob["count"], a))
        best = None
        for r in SUM_PARTS:
            for combo in combinations(groups.items(), r):
                tot = sum(n for _, (n, _) in combo)
                if SUM_MIN <= tot <= SUM_MAX and (best is None or tot > best[0]):
                    best = (tot, combo)
        if best:
            tot, combo = best
            # 수와 어휘 중 **더 어려운 쪽**이 연령을 정한다 — 개수 세기와 같은 규칙이다.
            out.append({**base, "id": f"sum{k:02d}", "kind": "sum",
                        "age_min": max([a for _, (_, a) in combo]
                                       + [6 if tot <= 5 else 7]),
                        "payload": {"parts": [{"name": nm, "n": n}
                                              for nm, (n, _) in combo],
                                    "total": tot},
                        "afford": ["모두 세기"] + CREATIVE_AFFORD})
        # 수 가르기 — 두 묶음의 차. 차가 가장 큰 짝을 고른다. 붙어 있는 수(4 와 3)보다
        # 벌어진 수(4 와 1)가 아이도 우리도 화면에서 확인하기 쉽다.
        pair, items = None, list(groups.items())
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (na, (ca, _)), (nb, (cb, _)) = items[i], items[j]
                if ca == cb or max(ca, cb) < DIFF_MIN_BIG:
                    continue
                d = abs(ca - cb)
                if pair is None or d > pair[0]:
                    hi, lo = ((na, ca), (nb, cb)) if ca > cb else ((nb, cb), (na, ca))
                    pair = (d, hi, lo)
        if pair:
            d, (hn, hc), (ln, lc) = pair
            out.append({**base, "id": f"dif{k:02d}", "kind": "diff",
                        "age_min": DIFF_AGE,
                        "payload": {"more": {"name": hn, "n": hc},
                                    "less": {"name": ln, "n": lc}, "diff": d},
                        "afford": ["수 가르기"] + CREATIVE_AFFORD})
        if o.get("shapes"):
            # 도형 이름은 셋뿐이고 셋 다 3세 어휘다. 사물 이름이 끼지 않는 유일한 유형.
            out.append({**base, "age_min": 3,
                        "id": f"shp{k:02d}", "kind": "shape",
                        "payload": {"shapes": o["shapes"]},
                        "afford": ["모양 찾기"] + CREATIVE_AFFORD})

    return out, unknown


# ── 어휘표 키우기 ───────────────────────────────────────────────────────────
def suggest_words() -> dict:
    """관찰에 나왔지만 어휘표에 없는 말들의 등급을 **초안으로** 받아 온다.

    게이트는 여전히 표 조회다(설계 판단 4: 게이트는 LLM 판단이 아니다). 여기서 받는 것은
    사람이 확정하기 전의 후보일 뿐이고, work/word-candidates.json 으로만 나간다.
    표에 자동으로 합치지 않는다 — 어느 말이 몇 살 말인지는 문항 난이도를 직접 정하므로,
    모델이 흔들리면 그대로 아이에게 간다.
    """
    seen = Counter()
    for f in sorted(WORK.glob("*_screen.json")):
        for o in json.loads(f.read_text())["observations"]:
            for ob in o.get("objects", []):
                if word_age(ob["name"]) is None:
                    seen[ob["name"]] += 1
    if not seen:
        print("표에 없는 말이 없다. 관찰을 먼저 돌려라.")
        return {}

    words = [w for w, _ in seen.most_common()]
    prompt = f"""아래는 유아용 영상의 화면을 관찰해 적은 사물 이름이다.
각 말을 **아이가 몇 살에 아는가** 로 3·4·5·6·7 중 하나로 매겨라.

기준
- 3: 두세 살이 일상에서 부르는 말 (공, 차, 곰, 문)
- 4: 알지만 화면에서 짚으려면 한 번 더 생각해야 하는 말 (화분, 사다리, 왕관)
- 5: 어휘가 어렵거나 경계가 흐린 말 (액자, 기둥, 굴뚝)
- 6: 그림책·교과에서 만나는 말. 일상 대화에는 잘 안 나온다 (차양, 산호, 표지판)
- 7: 사물의 부품·구조를 가리키는 말 (계기판, 도르래, 톱니바퀴)
- 0: **문항에 쓰면 안 되는 말** — 상위 범주(동물·인물·캐릭터)나 지어낸 합성어
     (우유팩 캐릭터). 아이가 화면에서 무엇을 세야 할지 모른다.

말: {', '.join(words)}

설명 없이 JSON 만. {{"words": {{"말": 등급, ...}}}}"""

    got = _first_json(_run_claude(prompt, None)).get("words") or {}
    out = {}
    for w in words:                      # 준 말만, 준 순서대로 — 모델이 지어내도 안 받는다
        v = got.get(w)
        if isinstance(v, int) and v in (0, 3, 4, 5, 6, 7):
            out[w] = v
    path = WORK / "word-candidates.json"
    path.write_text(json.dumps({"counts": dict(seen), "ages": out},
                               ensure_ascii=False, indent=1))
    by = Counter(out.values())
    print(f"표에 없는 말 {len(words)}종 → 등급 초안 {len(out)}종")
    for tier in (3, 4, 5, 6, 7, 0):
        ws = [w for w in words if out.get(w) == tier]
        if ws:
            label = "쓰지 마라" if tier == 0 else f"{tier}세"
            print(f"  {label:<8} {' '.join(ws)}")
    print(f"→ {path.name}  (확인 후 observe.py 의 WORD_AGE 에 직접 옮겨라)")
    return out


def run(name: str, dry: bool = False, repeat: int = 1) -> None:
    fp = WORK / f"{name}_facts.json"
    if not fp.exists():
        raise FileNotFoundError(f"{fp.name} 없음. 먼저 python3 facts.py --write")
    fx = json.loads(fp.read_text())
    video = Path(fx["video"]) if fx.get("video") else None
    if video is None or not video.exists():
        raise FileNotFoundError(f"{name}: 영상을 못 찾음")

    picks = pick_frames(fx["facts"])
    print(f"{name}  프레임 {len(picks)}장 선택 "
          f"(색 다양성 {[len(p['payload']['present']) for p in picks]})")
    frames = extract(video, picks)
    for f in frames:
        print(f"  {f['id']}  {storydot.mmss(f['t'])}  "
              f"색 {len(f['palette']['present'])}종  {Path(f['path']).name}")
    if dry:
        print("\n--dry: 관찰(LLM) 은 건너뛴다")
        return

    cache = WORK / f"{name}_screen.json"
    if repeat > 1:
        runs = []
        for r in range(1, repeat + 1):
            print(f"  ── 관찰 {r}/{repeat} ──", flush=True)
            raw = observe(frames)
            kept_r, _ = falsify(raw, {f["id"]: f for f in frames})
            runs.append(kept_r)
        kept, stat = consensus(runs, {f["id"]: f for f in frames})
        dropped = []
        print(f"\n합의 (과반 {stat['need']}/{stat['runs']})")
        print(f"  관찰된 객체 {stat['obj_seen']} → 채택 {stat['obj_kept']}"
              f"  ({100 * stat['obj_kept'] / max(1, stat['obj_seen']):.0f}%)")
        print(f"  일부 회차에만 등장 {stat['name_only_once']}건 · "
              f"개수 불일치 {len(stat['count_split'])}건 · 크기 불일치 {stat['size_split']}건")
        for nm, vals in stat["count_split"][:6]:
            print(f"    ✗ {nm}: 회차마다 {vals}")
    elif cache.exists() and "--refresh" not in sys.argv:
        # 관찰은 비싸고 afford 매핑은 자주 바뀐다. 저장된 관찰로 재료만 다시 만든다.
        old = json.loads(cache.read_text())
        kept, dropped = old["observations"], old.get("dropped", [])
        print(f"  (저장된 관찰 재사용 — 다시 관찰하려면 --refresh)")
    else:
        obs = observe(frames)
        kept, dropped = falsify(obs, {f["id"]: f for f in frames})
    facts, unknown = to_facts(kept)
    print(f"\n관찰 {len(kept)}프레임 · 반증 폐기 {len(dropped)}건 · 화면 재료 {len(facts)}건")
    for d in dropped[:6]:
        o = d.get("obj", {})
        print(f"  ✗ {o.get('name', '?')} — {d['drop']}")
    print("  재료 종류:", dict(Counter(f["kind"] for f in facts)))
    print("  연령 하한:", dict(sorted(Counter(f["age_min"] for f in facts).items())))
    if unknown:
        # 어휘표를 키우는 유일한 신호다. 유아가 아는 말이면 WORD_AGE 에 넣고, 상위 범주나
        # 지어낸 합성어면 그대로 둔다 — 그게 걸러지는 게 이 표의 목적이다.
        print("  어휘표에 없어 버린 말:",
              ", ".join(f"{w}×{c}" for w, c in Counter(unknown).most_common()))
    (WORK / f"{name}_screen.json").write_text(json.dumps(
        {"frames": frames, "observations": kept, "dropped": dropped,
         "facts": facts}, ensure_ascii=False, indent=1))
    print(f"→ {name}_screen.json")


def main(argv: list[str]) -> int:
    dry = "--dry" in argv
    repeat = int(argv[argv.index("--repeat") + 1]) if "--repeat" in argv else 1
    if "--suggest-words" in argv:
        suggest_words()
        return 0
    names = [storydot.nfc(a) for a in argv
             if not a.startswith("-") and not a.isdigit()]
    if not names:
        return print("사용법: python3 observe.py <작품명> [--dry] [--repeat N]\n"
                     "        python3 observe.py --suggest-words   어휘표 후보 뽑기") or 1
    for n in names:
        run(n, dry, repeat)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
