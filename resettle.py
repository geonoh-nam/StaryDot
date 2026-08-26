"""시각 정착이 옮긴 시각을 **발화 기준으로 다시 검사한다**. (실험용 · 분리 파일)

storydot.py 는 개입지점을 두 번 정한다.

    ① interrupt_points()  오디오 기준 — 발화 재개까지 speech_pad(3s) 확보를 **보장**
    ② 시각 정착           화면 기준 — 정지 구간으로 t 를 **옮긴다**

②가 t 를 옮긴 뒤 ①의 보장을 다시 확인하지 않는다. 그래서 오디오가 통과시킨
지점이 이동 후에는 발화 한복판에 떨어질 수 있다. 실측(5편 채택 7지점 전수):

    뽀로로 455.05  "곰인형은 찢어진 이불을 꿰매기 시작했어요" 안
    뽀로로 660.59  "뽀로로와 크롱은 정말 꿈을 꾼 걸까요?" 안
    아기상어 396.22 "그런 게 있어!" 안
    타요   114.77  "모두 천천히 뒤로 굴러가 주세요!" **시작 0.2초 뒤**
    타요   275.35  "그럴 리 없어." 안
    타요   556.96  "- 으하... - 어서 와" 안
    티니핑 761.82  "로미, 정신 차려!" **시작 0.5초 뒤**

7/7 이다. 우연이 아니라 구조다 — 내레이터는 **이미 정지한 와이드샷 위에** 목소리를
얹으므로, "가장 조용한 화면"을 찾으면 거의 항상 내레이션이 아직 흐르는 자리가 나온다.
시각 최적점과 오디오 최적점이 체계적으로 어긋나는 방향이다.

고친 것은 하나다. **정지 후보를 점수순으로 훑으면서 발화 안전한 첫 번째를 고른다.**
motion.best_pause 는 최고점 하나만 돌려주므로 그 안에서는 고를 수 없다. 여기서
같은 가중치로 후보 전체를 재구성하고 (motion 의 상수를 그대로 import 한다)
발화 필터를 얹는다. 점수 계산이 원본과 같다는 것은 실행할 때마다 "무제약 1위 =
plan 에 기록된 t" 인지 확인해 증명한다.

없는 자리를 만들어내지 않는다. ±4초에 안전한 정지 후보가 없으면 ±8초로 한 번
넓히고, 그래도 없으면 **지점을 기각한다** (파이프라인의 "0을 내는 것이 정상" 원칙).

    python3 resettle.py                 자체검사 + 5편 전수 비교표
    python3 resettle.py 티니핑1화        한 편만
    python3 resettle.py --write         work/<작품>_plan_v2.json 로 저장 (원본 안 건드림)

storydot.py · motion.py 를 **수정하지 않는다.** 결과가 나쁘면 이 파일만 지우면 된다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import motion
import storydot
import visual

ROOT = Path(__file__).parent
WORK = ROOT / "work"
# plan.json 의 video 경로는 다른 머신 것일 수 있다. 파일명으로 여기서 다시 찾는다.
VIDEO_DIRS = [Path.home() / "Downloads" / "test_videos", Path.home() / "Downloads"]


def _isnum(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def find_video(plan: dict) -> Path | None:
    p = Path(plan["video"])
    if p.exists():
        return p
    for d in VIDEO_DIRS:
        q = d / p.name
        if q.exists():
            return q
    return None


# ── 발화 안전성 ─────────────────────────────────────────────────────────────
# whisper 세그먼트의 **끝**은 실제 발화 종료보다 뒤에 찍히는 경향이 있다
# (티니핑 "로미, 정신 차려!" 6음절에 2.0초). 이 값만큼은 이미 끝난 것으로 본다.
# 0.0 = 엄격(기본). 올릴수록 지점을 더 살리지만 대사를 밟을 위험이 커진다.
END_SLOP = 0.0


def speech_free(t: float, canon: list[dict], end: float, pad: float,
                slop: float = None) -> tuple[bool, str]:
    """t 에서 멈춰도 대사가 잘리지 않는가.

    세 가지를 본다. **본편 안인가**, **발화 안에 있지 않은가**(말하는 중간이
    아님), **앞이 비어 있는가**(페이드아웃할 pad 초 확보).

    본편 경계를 여기서 같이 보는 이유: 시각 정착은 t 를 뒤로도 옮기므로
    `t > end` 규칙까지 함께 깨뜨린다. 실측(뽀로로) — 발화만 피하게 했더니
    666.25s 로 옮겨져 본편 끝 665.4s 를 넘었다. 고치려던 것과 같은 종류의
    누락을 그대로 반복한 셈이라, 재검사는 한 군데에 모아 둔다.

    격리(quarantine) 세그먼트도 발화로 친다 — 텍스트는 못 믿어도 그 구간에서
    소리가 났다는 사실은 남는다. 엄격한 쪽이 안전하다.
    """
    slop = END_SLOP if slop is None else slop
    if t > end:
        return False, f"본편 끝 {end:.1f}s 초과"
    for s in canon:
        if s["t0"] <= t < s["t1"] - slop:
            return False, f"발화 중 [{s['t0']:.1f}–{s['t1']:.1f}] {s['text'][:22]}"
    nxt = min((s["t0"] for s in canon if s["t0"] > t), default=end)
    if nxt - t < pad:
        return False, f"다음 발화까지 {nxt - t:.1f}s < {pad:.1f}s"
    return True, f"여유 {min(nxt - t, 99.9):.1f}s"


# ── 정지 후보 전체 ──────────────────────────────────────────────────────────
def candidates(prof, c, t: float, span: float) -> list[dict]:
    """motion.best_pause 와 **같은 가중치**로 정지 구간 안 모든 프레임을 점수화한다.

    best_pause 는 최고점 하나만 돌려주므로 "차선을 고른다"가 불가능하다. 점수
    계산은 그대로 두고 목록만 열어 두는 것이 이 함수의 전부다. 상수를 복사하지
    않고 motion 에서 그대로 읽는다 — 원본이 바뀌면 여기도 따라 바뀌어야 한다.
    """
    ts = [p[0] for p in prof]
    ds = [p[1] for p in prof]
    out = []
    for lo, hi in c["quiet"]:
        idx = [k for k in range(len(ts)) if lo <= ts[k] <= hi]
        run_len = hi - lo + c["step"]
        for k in idx:
            near = [ds[j] for j in idx if abs(ts[j] - ts[k]) <= 0.35]
            local = sum(near) / len(near)
            lead = [ts[k] - x for x in c["cuts"]
                    if 0.0 <= ts[k] - x <= motion.POST_CUT_SEC]
            gap = min(lead) if lead else None
            cut_b = 0.0 if gap is None else max(0.0, 1.0 - gap / motion.POST_CUT_SEC)
            score = (motion.W_QUIET * max(0.0, 1.0 - local / motion.QUIET)
                     + motion.W_RUN * min(1.0, run_len / 1.5)
                     + motion.W_TAIL * min(1.0, (hi - ts[k]) / 0.5)
                     + motion.W_PROX * max(0.0, 1.0 - abs(ts[k] - t) / span)
                     + motion.W_CUT * cut_b)
            out.append({"t": round(ts[k], 2), "score": round(score, 3),
                        "local": local, "run": run_len, "cut_lead": gap,
                        "kind": "post-cut" if cut_b >= motion.POST_CUT_LABEL else "still"})
    out.sort(key=lambda x: (-x["score"], x["t"]))
    return out


def settle(video: Path, t: float, canon: list[dict], end: float, pad: float,
           span: float = 4.0) -> dict | None:
    """발화 안전한 정지 후보 중 최고점. 없으면 None (= 지점 기각).

    ±span 에서 못 찾으면 한 번만 두 배로 넓힌다. 무한정 넓히지 않는 이유는
    멀어질수록 "아이가 방금 본 것"과 개입 시각이 어긋나기 때문이다.
    """
    for sp in (span, span * 2):
        prof = motion.profile(video, t, sp)
        if not prof:
            continue
        c = motion.classify(prof)
        if not c["quiet"]:
            continue
        for cd in candidates(prof, c, t, sp):
            ok, why = speech_free(cd["t"], canon, end, pad)
            if ok:
                cd.update(span=sp, speech=why, widened=sp > span)
                return cd
    return None


# ── plan 재정착 ─────────────────────────────────────────────────────────────
def nameset_of(plan: dict) -> set[str]:
    names = plan.get("names") or {}
    return set(names) | {v for vs in names.values() for v in vs}


def rerun(plan: dict, video: Path, verify: bool = True) -> list[dict]:
    """오디오 지점부터 다시 정착시킨다. 반환은 지점별 (기존 vs 신규) 비교 행."""
    canon, acts, end, P = plan["canonical"], plan["acts"], plan["end"], plan["params"]
    names = nameset_of(plan)
    pad = P["speech_pad"]
    base = storydot.detail_baseline(video, plan["duration"])

    _cands, chosen, _rej = storydot.interrupt_points(canon, acts, end, P, names)
    old_by_act = {round(it["act"]["t1"], 2): it for it in plan["interrupts"]}

    rows = []
    for c in chosen:
        audio_t = c["t"]
        old = old_by_act.get(round(c["act"]["t1"], 2))
        row = {"audio_t": audio_t, "old_t": old["t"] if old else None,
               "act": c["act"], "new": None, "drop": None, "unconstrained": None}

        # 원본 재현 확인 — 무제약 1위가 plan 의 t 와 같아야 점수 재구성이 맞은 것이다
        if verify and old:
            prof = motion.profile(video, audio_t, 4.0)
            cs = candidates(prof, motion.classify(prof), audio_t, 4.0) if prof else []
            row["unconstrained"] = cs[0]["t"] if cs else None
            row["old_speech"] = speech_free(old["t"], canon, end, pad)

        new = settle(video, audio_t, canon, end, pad)
        if new is None:
            row["drop"] = "발화 안전한 정지 자리 없음 (±8s)"
            rows.append(row)
            continue

        tv, _flat = motion.scale_stats(video, new["t"])
        if tv < base * storydot.CLOSEUP_REL:
            row["drop"] = f"클로즈업 (디테일 {tv:.1f} < 기준 {base:.1f})"
            rows.append(row)
            continue
        new["shot"] = "wide" if tv > base * 1.15 else "medium"

        # t 가 움직였으므로 회상 창(직전 100초)도 움직인다. 증거를 다시 센다.
        ev = storydot.evidence(canon, c["act"], names, at=new["t"])
        new["n_ev"] = len(ev)
        if len(ev) < P["min_evidence"]:
            row["drop"] = f"이동 후 증거 {len(ev)}건 < {P['min_evidence']}"
            rows.append(row)
            continue
        row["new"], row["evidence"] = new, ev
        rows.append(row)
    return rows


def write_v2(plan: dict, video: Path, rows: list[dict], out: Path) -> None:
    """새 계획을 **별도 파일**로 낸다. 원본 plan.json 은 건드리지 않는다."""
    ints = []
    for k, r in enumerate(x for x in rows if x["new"]):
        n = r["new"]
        try:
            frames = visual.extract_evidence_frames(video, n["t"], span=20.0, n=4,
                                                    out_dir=WORK / "shots")
            colors = visual.frame_facts(frames[-1:])
        except Exception as exc:
            frames, colors = [], {"error": str(exc)}
        ints.append({
            "id": f"i{k:02d}", "t": n["t"], "gap": None,
            "pause": {"score": n["score"], "kind": n["kind"], "shot": n["shot"],
                      "why": n["speech"]},
            "speech_checked": True, "frames": frames, "colors": colors,
            "act": {"t0": r["act"]["t0"], "t1": r["act"]["t1"], "beat": r["act"]["beat"]},
            "evidence": [{"id": e["id"], "t0": e["t0"], "t1": e["t1"],
                          "text": e["text"], "conf": e["conf"]} for e in r["evidence"]],
        })
    v2 = {**plan, "video": str(video), "interrupts": ints,
          "rejected": plan["rejected"] + [{"t": r["audio_t"], "why": r["drop"]}
                                          for r in rows if r["drop"]]}
    out.write_text(json.dumps(v2, ensure_ascii=False, indent=1))


# ── 보고 ────────────────────────────────────────────────────────────────────
def report(name: str, rows: list[dict]) -> tuple[int, int]:
    print(f"\n{'━' * 92}\n{name}\n{'━' * 92}")
    moved = kept = 0
    for r in rows:
        old_t, new = r["old_t"], r["new"]
        print(f"\n  오디오 지점 {storydot.mmss(r['audio_t'])}   act «{r['act']['beat'][:34]}»")
        if old_t is not None:
            ok, why = r["old_speech"]
            print(f"    기존  {storydot.mmss(old_t):>9}  {'✓' if ok else '❌'} {why}")
            if r["unconstrained"] is not None:
                same = abs(r["unconstrained"] - old_t) < 0.2
                print(f"          점수 재현 {'일치' if same else '불일치'} "
                      f"(무제약 1위 {r['unconstrained']:.2f} vs 기록 {old_t:.2f})")
        if new is None:
            print(f"    신규  {'—':>9}  ✗ 기각 — {r['drop']}")
            continue
        delta = new["t"] - (old_t if old_t is not None else r["audio_t"])
        print(f"    신규  {storydot.mmss(new['t']):>9}  ✓ {new['speech']}"
              f"  ({delta:+.2f}s)  점수 {new['score']}  {new['kind']}/{new['shot']}"
              f"  증거 {new['n_ev']}건{'  [창 확장]' if new['widened'] else ''}")
        kept += 1
        if old_t is not None and abs(delta) >= 0.05:
            moved += 1
    return kept, moved


# ── 자체검사 ────────────────────────────────────────────────────────────────
def selftest() -> None:
    """영상 없이 도는 검사. 고친 로직이 무동작이 아님을 증명한다."""
    canon = [{"t0": 10.0, "t1": 13.0, "text": "로미, 정신 차려!", "conf": "medium"},
             {"t0": 20.0, "t1": 22.0, "text": "괜찮아?", "conf": "medium"}]

    # ① 발화 한복판은 막는다 (티니핑 761.82 가 정확히 이 모양이었다)
    ok, why = speech_free(10.5, canon, 30.0, 3.0)
    assert not ok and "발화 중" in why, why
    # ② 발화가 끝나도 다음까지 3초가 없으면 막는다
    assert not speech_free(17.5, canon, 30.0, 3.0)[0]
    # ③ 사이가 넉넉하면 통과
    assert speech_free(14.0, canon, 30.0, 3.0)[0]
    # ④ 마지막 발화 뒤는 end 까지가 여유
    assert speech_free(25.0, canon, 30.0, 3.0)[0]
    assert not speech_free(28.5, canon, 30.0, 3.0)[0]

    # ⑤ 후보 필터 — 최고점이 발화 중이면 차선을 고른다.
    #    0.5초 간격으로 10.0~16.0 이 전부 조용한 픽스처. 요청 시각을 11.0 으로 두면
    #    근접도(W_PROX) 때문에 무제약 1위가 발화 구간(10~13) 안에 떨어진다.
    #    slop 을 명시적으로 0 으로 넘긴다 — 이 검사는 전역 설정과 무관하게
    #    엄격 동작을 고정한다 (--slop 0.5 로 돌렸을 때 여기가 깨져서 알았다).
    prof = [(t / 2, 0.2) for t in range(20, 33)]
    c = motion.classify(prof)
    cands = candidates(prof, c, 11.0, 4.0)
    assert cands, "정지 후보가 비었다"
    assert not speech_free(cands[0]["t"], canon, 30.0, 3.0, slop=0.0)[0], \
        "이 픽스처는 무제약 1위가 발화 중이어야 검사에 의미가 있다"
    safe = [x for x in cands if speech_free(x["t"], canon, 30.0, 3.0, slop=0.0)[0]]
    assert safe and safe[0]["t"] >= 13.0, f"발화 밖을 못 골랐다: {safe[:1]}"

    # ⑥ 점수 구성이 motion 상수와 묶여 있는가 (복사본이 아니라 참조)
    assert 0.99 < sum((motion.W_QUIET, motion.W_RUN, motion.W_TAIL,
                       motion.W_PROX, motion.W_CUT)) < 1.01

    # ⑦ 본편 끝을 넘으면 막는다 (뽀로로에서 실제로 넘었다: 666.25 > 665.4)
    assert not speech_free(30.5, canon, 30.0, 3.0)[0]
    assert "본편 끝" in speech_free(30.5, canon, 30.0, 3.0)[1]

    # ⑧ slop 은 세그먼트 **꼬리만** 열어 준다. 한복판은 여전히 막혀야 한다.
    assert speech_free(12.6, canon, 30.0, 3.0, slop=0.5)[0], "꼬리를 못 열었다"
    assert not speech_free(10.5, canon, 30.0, 3.0, slop=0.5)[0], "한복판이 열렸다"
    print("자체검사 8/8 통과")


def main(argv: list[str]) -> int:
    global END_SLOP
    if "--slop" in argv:
        END_SLOP = float(argv[argv.index("--slop") + 1])
        print(f"[END_SLOP={END_SLOP}s — 세그먼트 끝 {END_SLOP}초는 이미 끝난 것으로 본다]")
    selftest()
    write = "--write" in argv
    want = [a for a in argv if not a.startswith("-") and not _isnum(a)]

    plans = sorted(WORK.glob("*_plan.json"))
    if want:
        plans = [p for p in plans if any(w in p.stem for w in want)]
    total_kept = total_moved = total_drop = 0
    for pp in plans:
        plan = json.loads(pp.read_text())
        name = pp.stem.replace("_plan", "")
        if not plan["interrupts"]:
            print(f"\n{name} — 채택 지점 없음, 건너뜀")
            continue
        video = find_video(plan)
        if video is None:
            print(f"\n{name} — 영상을 못 찾음 ({Path(plan['video']).name}), 건너뜀")
            continue
        rows = rerun(plan, video)
        kept, moved = report(name, rows)
        total_kept += kept
        total_moved += moved
        total_drop += sum(1 for r in rows if r["drop"])
        if write:
            out = WORK / f"{name}_plan_v2.json"
            write_v2(plan, video, rows, out)
            print(f"\n  → {out.name} 저장 (원본 {pp.name} 그대로)")

    print(f"\n{'━' * 92}\n합계  채택 {total_kept}  기각 {total_drop}  "
          f"이동 {total_moved}\n{'━' * 92}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
