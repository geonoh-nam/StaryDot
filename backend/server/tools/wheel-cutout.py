#!/usr/bin/env python3
"""바퀴를 누끼 따서 조각 PNG 와 구멍 뚫린 판을 굽는다.

    python3 backend/server/tools/wheel-cutout.py <영상> <초> <이름> <cx,cy,rx,ry> [...]

영상에서 그 시각의 화면을 꺼내 판으로 삼고, 준 타원 안에서 타이어 픽셀만 골라 실제 윤곽대로
오려낸다. 산출은 셋:

    frontend/assets/puzzles/<이름>.jpg          구멍 뚫린 판
    frontend/assets/puzzles/<이름>-<n>.png      오려낸 조각(배경 투명)
    화면에 찍히는 wheels.js 항목

타이어는 어둡고 무채색이다. 파란 차체(b-r 이 큼)와 밝은 도로·그늘을 빼면 남는 게 바퀴다.
휠캡은 밝아서 빠지므로 행마다 양 끝 사이를 메운다 — 바퀴는 볼록하니 이걸로 충분하다.
바퀴가 펜더에 반쯤 가린 컷에서는 아치 안쪽 그늘이 타이어와 한 덩어리라 모양이 무너진다.
옆에서 통째로 보이는 컷을 골라야 한다.

의존성 없이 ffmpeg 로 raw 픽셀을 주고받는다.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'frontend/assets/puzzles'

W, H = 940, 529
# 오려내기는 두 배로 키운 화면에서 한다. 픽셀 단위로 자르면 가장자리가 계단처럼 남는데,
# 두 배에서 자른 뒤 줄이면 그 계단이 반투명하게 녹아 매끄러워진다.
SS = 2
WW, HH = W * SS, H * SS
HOLE = (58, 64, 78)   # 파낸 자리를 덮는 색. 대상보다 밝거나 어두워야 빈 자리로 읽힌다.

# 오려낼 것이 무엇이냐에 따라 "이 픽셀이 대상인가"의 답이 다르다. 타이어는 어둡고,
# 화분은 밝다. 배경과 갈리는 축을 대상마다 골라 준다.
def _is_dark(r, g, b):
    """검은 타이어. 파란 차체(b-r 이 큼)와 밝은 도로·그늘을 뺀다."""
    return not (b - r > 22 or (r + g + b) / 3 > 96)


def _is_white(r, g, b):
    """흰 화분·그릇. 색이 있는 것(채도)과 어두운 것을 뺀다 — 초록 잎과 보라 선반이 갈린다.

    실측(티니핑 9화 꽃집): 화분은 밝기 118~199 · 채도차 20~57, 보라 벽은 밝기 78~87 ·
    채도차 61~66. 그늘진 화분 가장자리가 채도차 57까지 오르므로 채도만으로는 못 가른다 —
    밝기를 100 에서 끊으면 벽이 통째로 빠지고 그늘진 화분은 남는다."""
    v = (r + g + b) / 3
    return v > 100 and max(r, g, b) - min(r, g, b) < 58


def _is_lilac(r, g, b):
    """연보라 화분. 벽돌 벽과 밝기가 비슷해 밝기로는 안 갈린다 — 파란기로 가른다.
    실측(티니핑 9화): 화분은 b-r 이 +17~30, 벽돌은 -37~-55."""
    return (r + g + b) / 3 > 130 and b - r > 12


def _is_toon(r, g, b):
    """캐릭터. 나무·잎 배경은 노랑·갈색이라 파랑이 크게 모자라고(b-r 이 -73 이하),
    캐릭터는 크림·분홍·연두라 그만큼 치우치지 않는다. 실측(티니핑 10화 5:18):
    캐릭터 -50~+38, 벤치와 잎 -73~-115."""
    return b - r > -60


def _any(r, g, b):
    """준 타원을 통째로 오려낸다. 대상이 여러 색으로 이뤄져 색으로 못 가를 때 쓴다 —
    캐릭터가 그렇다. 실루엣 대신 동그란 조각이 되지만, 그건 퍼즐 조각으로 자연스럽다."""
    return True


TARGETS = {"dark": _is_dark, "white": _is_white, "lilac": _is_lilac, "toon": _is_toon,
           "shape": _any}


def frame(video: Path, at: float, crop: str) -> bytes:
    return subprocess.run(
        ['ffmpeg', '-v', 'error', '-ss', f'{at:.3f}', '-i', str(video), '-frames:v', '1',
         '-vf', f'{crop}scale={WW}:{HH}', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
        capture_output=True, check=True).stdout


def mask(rgb: bytes, cx: int, cy: int, rx: int, ry: int, is_target=_is_dark) -> set:
    """타원 안에서 대상 픽셀을 골라 한 덩어리로 만든다."""
    raw = set()
    cx, cy, rx, ry = cx * SS, cy * SS, rx * SS, ry * SS
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            if not (0 <= x < WW and 0 <= y < HH):
                continue
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1:
                continue
            i = (y * WW + x) * 3
            if not is_target(rgb[i], rgb[i + 1], rgb[i + 2]):
                continue
            raw.add((x, y))

    if is_target is _any:
        return raw

    # 잡티는 버리고 가장 큰 덩어리만 남긴다.
    seen, best = set(), set()
    for p in raw:
        if p in seen:
            continue
        stack, comp = [p], set()
        while stack:
            q = stack.pop()
            if q in seen or q not in raw:
                continue
            seen.add(q)
            comp.add(q)
            x, y = q
            stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        if len(comp) > len(best):
            best = comp

    rows = {}
    for x, y in best:
        lo, hi = rows.get(y, (x, x))
        rows[y] = (min(lo, x), max(hi, x))
    return {(x, y) for y, (lo, hi) in rows.items() for x in range(lo, hi + 1)}


def shrink(m: set) -> set:
    """마스크를 한 겹 깎는다. 조각에만 쓴다 — 대상과 배경이 만나는 줄은 두 색이 섞여
    있어서, 그 줄을 조각에 넣으면 오려낸 가장자리에 배경색 띠가 남는다."""
    return {(x, y) for x, y in m
            if all((x + dx, y + dy) in m for dx in (-1, 0, 1) for dy in (-1, 0, 1))}


def grow(m: set, times: int = 2) -> set:
    """마스크를 한 겹씩 넓힌다.

    파낸 자리에만 쓴다. 가장자리 한두 겹은 배경과 섞여 밝기가 떨어져 마스크에서 빠지는데,
    그대로 두면 판에 대상의 윤곽이 남아 "빠진 자리"가 아니라 "색칠한 대상"으로 보인다.
    조각에는 쓰지 않는다 — 넓히면 배경이 조각 가장자리에 묻어 오려낸 티가 난다."""
    out = set(m)
    for _ in range(times):
        out |= {(x + dx, y + dy) for x, y in out
                for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
    return {(x, y) for x, y in out if 0 <= x < WW and 0 <= y < HH}


def write_png(pixels: bytes, w: int, h: int, path: Path, alpha: bool, scale=None) -> None:
    args = ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo',
            '-pix_fmt', 'rgba' if alpha else 'rgb24', '-s', f'{w}x{h}', '-i', '-']
    if scale:
        args += ['-vf', f'scale={scale[0]}:{scale[1]}']
    subprocess.run(args + [str(path)], input=pixels, check=True)


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(__doc__)
        return 1
    video, at, name = Path(argv[0]), float(argv[1]), argv[2]
    crop = ''
    is_target = _is_dark
    specs = []
    for a in argv[3:]:
        if a.startswith('crop='):
            crop = a + ','
        elif a.startswith('target='):
            is_target = TARGETS[a.split('=', 1)[1]]
        else:
            # "cx,cy,rx,ry" 또는 "cx,cy,rx,ry:색" — 뒤에 붙이면 그 대상만 다른 규칙을 쓴다.
            box, _, kind = a.partition(':')
            specs.append((tuple(int(v) for v in box.split(',')),
                          TARGETS[kind] if kind else None))

    rgb = frame(video, at, crop)
    board = bytearray(rgb)
    OUT.mkdir(parents=True, exist_ok=True)
    holes = []

    for n, (spec, own) in enumerate(specs):
        m = mask(rgb, *spec, is_target=own or is_target)
        if not m:
            print(f'{spec}: 대상을 못 찾음')
            continue
        cut0 = shrink(m) or m
        xs = [x for x, _ in cut0]
        ys = [y for _, y in cut0]
        x0, y0 = min(xs), min(ys)
        w, h = max(xs) - x0 + 1, max(ys) - y0 + 1

        cut = shrink(m) or m
        # 가장자리 두 겹은 반투명으로 눕힌다. 딱 떨어지는 알파는 줄인 뒤에도 단면이 서고,
        # 두 겹을 눕히면 오려낸 자국이 그림에 녹는다.
        rim1 = {p for p in cut
                if not all((p[0] + dx, p[1] + dy) in cut
                           for dx in (-1, 0, 1) for dy in (-1, 0, 1))}
        rim2 = {p for p in cut - rim1
                if any((p[0] + dx, p[1] + dy) in rim1
                       for dx in (-1, 0, 1) for dy in (-1, 0, 1))}
        piece = bytearray(w * h * 4)
        for x, y in cut:
            src = (y * WW + x) * 3
            dst = ((y - y0) * w + (x - x0)) * 4
            piece[dst:dst + 3] = rgb[src:src + 3]
            piece[dst + 3] = 110 if (x, y) in rim1 else 195 if (x, y) in rim2 else 255

        # 판에서는 그 자리를 단색으로 덮는다. 원래 어둡던 타이어를 더 어둡게 눌러 봐야
        # 바퀴가 그대로 있는 것처럼 보인다 — 빈 자리인 게 한눈에 보여야 아이가 찾는다.
        # 테를 두르지 않는다. 흰 줄이 있으면 오려낸 자리가 그림 위의 스티커처럼 뜬다.
        for x, y in grow(m):
            src = (y * WW + x) * 3
            board[src], board[src + 1], board[src + 2] = HOLE

        # 조각은 두 배 그대로 저장한다 — 앱이 절반 크기로 그리면서 가장자리가 부드러워진다.
        out = OUT / f'{name}-{n}.png'
        write_png(bytes(piece), w, h, out, alpha=True)
        holes.append((out.name, x0 / SS, y0 / SS, w / SS, h / SS))

    write_png(bytes(board), WW, HH, OUT / f'{name}.jpg', alpha=False, scale=(W, H))

    print(f"    image: require('../assets/puzzles/{name}.jpg'),")
    print('    holes: [')
    for file, x0, y0, w, h in holes:
        print(f"      {{ id: '{Path(file).stem}', image: require('../assets/puzzles/{file}'),"
              f" x: {x0:g}, y: {y0:g}, w: {w:g}, h: {h:g} }},")
    print('    ],')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
