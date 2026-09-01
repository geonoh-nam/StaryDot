import collections
import random

from oneshot.plan_types import MAX_BOOST, MIN_ATTEMPTS, assign_types, max_points, weights_from_history

T = ["A", "B", "C", "D", "E"]


def test_최대_지점은_길이를_간격으로_나눈_값():
    assert max_points(85.2, 20.0) == 4
    assert max_points(360.9, 20.0) == 18


def test_간격보다_짧은_영상도_최소_한_곳():
    assert max_points(10.0, 20.0) == 1


def test_길이나_간격이_0이면_0():
    assert max_points(0.0, 20.0) == 0
    assert max_points(85.2, 0.0) == 0


def test_한_바퀴_안에서는_1순위가_겹치지_않는다():
    firsts = [a[0] for a in assign_types(5, T, rng=random.Random(0))]
    assert sorted(firsts) == sorted(T)


def test_지점이_유형보다_많으면_다음_바퀴를_돈다():
    firsts = [a[0] for a in assign_types(7, T, rng=random.Random(0))]
    assert sorted(firsts[:5]) == sorted(T)
    assert len(set(firsts[5:])) == 2  # 두 번째 바퀴의 앞 두 개


def test_우선순위_목록에_모든_유형이_한_번씩_들어간다():
    for priority in assign_types(3, T, rng=random.Random(0)):
        assert sorted(priority) == sorted(T)


def test_1순위는_대안에_다시_나오지_않는다():
    for priority in assign_types(4, T, rng=random.Random(7)):
        assert priority[0] not in priority[1:]


def test_지점이_0이면_빈_배정():
    assert assign_types(0, T) == []


def test_가중치가_높은_유형이_1순위로_더_자주_뽑힌다():
    weights = {"A": 10.0, "B": 1.0, "C": 1.0, "D": 1.0, "E": 1.0}
    rng = random.Random(3)
    firsts = collections.Counter(assign_types(1, T, weights, rng)[0][0] for _ in range(300))
    assert firsts["A"] > firsts["B"] * 2


def test_가중치가_0인_유형도_목록에서_사라지지는_않는다():
    weights = {"A": 0.0, "B": 1.0, "C": 1.0, "D": 1.0, "E": 1.0}
    priority = assign_types(1, T, weights, random.Random(0))[0]
    assert "A" in priority


def test_기록이_없으면_전부_중립():
    assert weights_from_history([], T) == {t: 1.0 for t in T}


def test_표본이_적으면_가중치를_건드리지_않는다():
    history = [{"activity_template": "A", "correct": False}] * (MIN_ATTEMPTS - 1)
    assert weights_from_history(history, T)["A"] == 1.0


def test_자주_틀린_유형의_가중치가_올라간다():
    history = [{"activity_template": "A", "correct": False}] * MIN_ATTEMPTS
    assert weights_from_history(history, T)["A"] == 1.0 + MAX_BOOST


def test_다_맞힌_유형은_중립에_머문다():
    history = [{"activity_template": "A", "correct": True}] * MIN_ATTEMPTS
    assert weights_from_history(history, T)["A"] == 1.0


def test_절반_틀리면_절반만_올라간다():
    history = ([{"activity_template": "A", "correct": False}] * 2
               + [{"activity_template": "A", "correct": True}] * 2)
    assert weights_from_history(history, T)["A"] == 1.0 + MAX_BOOST * 0.5


def test_카탈로그_밖_유형_기록은_무시한다():
    history = [{"activity_template": "없는유형", "correct": False}] * 10
    assert weights_from_history(history, T) == {t: 1.0 for t in T}
