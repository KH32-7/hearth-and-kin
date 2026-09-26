"""06c 색감 팔레트 (화사하게) — 이전: 06 색감 팔레트 (docs/레퍼런스_이미지/06_색감_팔레트_추출.png, README 가을 섬) 로 다시 칠하기.
색상 무리(초록 풀·잎 / 흙·나무 갈색)의 픽셀을 밝기 순위대로 팔레트 램프에 옮김 → 명암 결은 살리고 색은 팔레트와 똑같이.
 - 초록(H 55~175): 풀 램프 #50280e(외곽) … #807212 #8a9a3c #a6a624 #b1b44f
 - 흙/갈색(H 12~48, 채도 높음): 흙 램프 #6e5426 #917838 #b08f50 #d0b979 #ddc98a
 - 회색 돌/물/사람 색은 그대로
"""
import colorsys
from PIL import Image

GRASS = ['#34500a', '#587c07', '#689a31', '#7fa826', '#92b31e', '#afc054']
# 흙길 (README 흙길 #ceba75 S43 V81, 자갈 #d8c989): 채도 45% 이하로 누름
DIRT = ['#85542f', '#af7c46', '#cda868', '#dfc47d', '#e7d18b', '#eee09c']
# 목재 (README 목재 #ad8854–#d2b682, 어두운 안쪽 #83502a): 05 헛간처럼 밝게
WOOD = ['#390e05', '#5e2513', '#833f21', '#a2683a', '#c09257', '#dcb77a']
# 돌: 중성 회색 → 따뜻한 회갈 (README 돌벽 #a79c80, 바위 #bab7a3 #8e876c, 흰색 대신 #d9d4c6)
# 광장 흰 판석 (사용자: 누런끼 빼고 더 희게): 푸른빛 도는 흰 돌
SLAB = ['#7d848f', '#a2a9b2', '#bfc5cc', '#d2d6db', '#e0e3e6', '#eceef0']
# 흙길/돌길 (사용자: 누런끼 빼기): 채도 낮춘 회갈 황토
PATH = ['#86684f', '#a88d74', '#bca58b', '#cab59b', '#d6c6ae', '#e2d7c4']
STONE = ['#3e3f4c', '#515360', '#66707c', '#7a8692', '#99a7b6', '#b3bcc9']


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _lerp_ramp(ramp, t):
    t = min(1.0, max(0.0, t))
    f = t * (len(ramp) - 1)
    i = min(len(ramp) - 2, int(f))
    k = f - i
    a, b = _rgb(ramp[i]), _rgb(ramp[i + 1])
    # 픽셀아트: 램프 칸에 스냅 (반은 섞지 않음 → 팔레트 색 그대로)
    return a if k < 0.5 else b


def classify(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    if s > 0.22 and 55 <= hd <= 175 and v > 0.12:
        return 'grass', v
    if s > 0.35 and 12 <= hd <= 48 and v > 0.18:
        return 'dirt', v
    if s < 0.2 and 0.22 < v < 0.97:
        return 'stone', v
    return None, v


def recolor(im: Image.Image, groups=('grass', 'dirt', 'stone'), dirt_ramp=None) -> Image.Image:
    """이미지 전체에서 무리별 밝기 분포를 모아 순위 → 램프"""
    im = im.convert('RGBA')
    px = im.load()
    vals = {'grass': [], 'dirt': [], 'stone': []}
    cls = {}
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            c, v = classify(r, g, b)
            if c in groups:
                vals[c].append(v)
                cls[(x, y)] = (c, v)
    ranks = {}
    for c, vs in vals.items():
        if not vs:
            continue
        vs = sorted(vs)
        n = len(vs)
        # 밝기 → 백분위 (표본 256개 경계)
        edges = [vs[min(n - 1, int(n * k / 256))] for k in range(257)]
        ranks[c] = edges
    ramps = {'grass': GRASS, 'dirt': dirt_ramp or DIRT, 'stone': STONE}
    for (x, y), (c, v) in cls.items():
        e = ranks[c]
        lo, hi = 0, 256
        while lo < hi:
            mid = (lo + hi) // 2
            if e[mid] < v:
                lo = mid + 1
            else:
                hi = mid
        t = lo / 256
        # 가장 어두운 5%는 외곽/틈 색, 나머지는 램프 1칸부터
        ramp = ramps[c]
        rgb = _lerp_ramp(ramp, 0.08 + t * 0.92) if t > 0.05 else _rgb(ramp[0])
        a = px[x, y][3]
        px[x, y] = (*rgb, a)
    return im


def remap_cells(im, orig, cells, ramp, cols=64, T=32):
    """아틀라스 칸(cells)의 풀 아닌 픽셀을 원본 밝기 순위대로 ramp 로 (재질별 색 따로)"""
    px, po = im.load(), orig.load()
    pts = []
    for c in cells:
        x0, y0 = (c % cols) * T, (c // cols) * T
        for y in range(y0, y0 + T):
            for x in range(x0, x0 + T):
                r, g, b, a = po[x, y]
                if a == 0:
                    continue
                k, v = classify(r, g, b)
                if k == 'grass':
                    continue
                pts.append((v, x, y, a))
    if not pts:
        return
    pts.sort()
    n = len(pts)
    for i, (v, x, y, a) in enumerate(pts):
        t = i / n
        rgb = _lerp_ramp(ramp, 0.08 + t * 0.92) if t > 0.04 else _rgb(ramp[0])
        px[x, y] = (*rgb, a)


def desat_cells(im, cells, sat=0.3, vmul=1.03, cols=64, T=32):
    """아틀라스 칸의 풀 아닌 픽셀: 명암 결은 그대로, 누런끼(채도)만 뺌"""
    px = im.load()
    for c in cells:
        x0, y0 = (c % cols) * T, (c // cols) * T
        for y in range(y0, y0 + T):
            for x in range(x0, x0 + T):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                h, s_, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                if s_ > 0.22 and 55 <= h * 360 <= 175:
                    continue
                r2, g2, b2 = colorsys.hsv_to_rgb(h, s_ * sat, min(1.0, v * vmul))
                px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
