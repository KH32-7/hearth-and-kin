"""건물 외관(shell) 데이터 (비주얼 개편 docs/07): Village 팩 "buildings(lighter version)" 의 유니티 프리팹(building (N).prefab)을
읽어 부품(bN_2 아래층 + bN_1 위층/지붕)을 좌표대로 조립 (32px = 1유닛, 가운데 피벗).
  python tools/world/build-shells.py
출력
- assets/generated/world/shells_0.png (외관 아틀라스, git 에 없음)
- src/data/artpacks/shells.json: 외관별 그림 사각형, 발자국(칸), 문 열, 역할/크기, 창문 마스크 사각형
발자국: 가로 = 그림 폭(칸 올림), 세로 = (그림 높이 − 벽 높이 80px) / 32. 그림 아래 끝 = 발자국 맨 아래 줄(앞벽)
"""
import glob, json, os, re
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
SRC = 'assets/vendor/epic-rpg-world/RafaelMatos/ERW - The Village/buildings(lighter version)'
OUT_IMG = 'assets/generated/world/shells_0.png'
OUT_JSON = 'src/data/artpacks/shells.json'
T = 32
STORY = 80

# 문 열 (그림 왼쪽에서 칸), 역할, 크기 등급. 검수판(artifacts/qa/visual/shells_*.png)으로 정함
SPEC = {
    1: (5, 'house', 'medium'), 2: (5, 'house', 'medium'), 3: (5, 'house', 'medium'), 4: (2, 'house', 'large'),
    5: (5, 'house', 'medium'), 6: (5, 'house', 'medium'), 7: (5, 'house', 'large'), 8: (9, 'barn', 'large'),
    9: (2, 'house', 'small'), 10: (2, 'house', 'small'), 12: (13, 'house', 'manor'), 13: (13, 'house', 'large'),
    14: (3, 'house', 'medium'), 15: (10, 'hall', 'manor'), 16: (5, 'barn', 'large'), 17: (6, 'house', 'manor'),
    18: (3, 'house', 'small'), 19: (3, 'townhouse', 'small'), 20: (3, 'townhouse', 'small'), 21: (2, 'townhouse', 'small'),
    22: (2, 'townhouse', 'small'), 23: (2, 'house', 'small'), 24: (8, 'workshop', 'large'), 25: (2, 'tent', 'small'),
    26: (3, 'house', 'small'), 27: (5, 'church', 'large'), 28: (6, 'house', 'large'), 29: (4, 'house', 'medium'),
    30: (2, 'chapel', 'small'), 31: (9, 'inn', 'large'), 32: (3, 'house', 'small'), 33: (3, 'house', 'small'),
    34: (3, 'barn', 'large'), 35: (1, 'shed', 'tiny'), 36: (1, 'shed', 'tiny'), 37: (1, 'shed', 'tiny'), 38: (1, 'shed', 'tiny'),
    39: (3, 'house', 'medium'), 40: (11, 'hall', 'manor'), 41: (4, 'house', 'large'),
}


def parts(pf):
    t = open(pf, encoding='utf8').read()
    out = []
    for b in t.split('--- !u!'):
        m = re.search(r'm_Name: (\S+)', b)
        p = re.search(r'm_LocalPosition: \{x: ([-\d.e]+), y: ([-\d.e]+)', b)
        o = re.search(r'm_SortingOrder: (-?\d+)', b)
        if m:
            out.append({'name': m.group(1)})
        if p and out:
            out[-1]['pos'] = (float(p.group(1)), float(p.group(2)))
        if o and out:
            out[-1]['order'] = int(o.group(1))
    return [o for o in out if re.match(r'b\d', o['name'])]


def find(n):
    g = glob.glob(f'{SRC}/*_parts/{n}.png')
    return g[0] if g else None


def compose(pf):
    """부품 배치 → (전체, 아래 부품, 위 부품들, 구멍 사각형) 같은 좌표계. 구멍 = 아래 부품의 남색 칸 (실내 자리)"""
    ps = [p for p in parts(pf) if find(p['name'])]
    ims = [(p, Image.open(find(p['name'])).convert('RGBA')) for p in ps]
    place = []
    for p, im in sorted(ims, key=lambda t: t[0].get('order', 0)):
        cx, cy = p.get('pos', (0, 0))[0] * T, -p.get('pos', (0, 0))[1] * T
        place.append([p, im, int(round(cx - im.width / 2)), int(round(cy - im.height / 2))])
    def build(place):
        x0 = min(q[2] for q in place)
        y0 = min(q[3] for q in place)
        W = max(q[2] + q[1].width for q in place) - x0
        H = max(q[3] + q[1].height for q in place) - y0
        full = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        roof = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        lo = place[0][0].get('order', 0)
        for p, im, x, y in place:
            full.alpha_composite(im, (x - x0, y - y0))
            (base if p.get('order', 0) == lo else roof).alpha_composite(im, (x - x0, y - y0))
        return full, base, roof
    full, base, roof = build(place)
    if navy_frac(full) > 0.01 and len(place) == 2:
        off = register([(q[0], q[1]) for q in place])
        if off:
            place[1][2] = place[0][2] + off[0]
            place[1][3] = place[0][3] + off[1]
            full, base, roof = build(place)
    bb = full.getbbox()
    full, base, roof = full.crop(bb), base.crop(bb), roof.crop(bb)
    # 구멍: 아래 부품의 남색 칸 → 투명, 사각형 기록
    px = base.load()
    xs, ys = [], []
    for y in range(base.height):
        for x in range(base.width):
            if is_navy(px[x, y]):
                px[x, y] = (0, 0, 0, 0)
                xs.append(x)
                ys.append(y)
    hole = [min(xs), min(ys), max(xs) + 1, max(ys) + 1] if len(xs) > 400 else None
    return full, base, roof, hole


def is_navy(p):
    return p[3] > 0 and abs(p[0] - 60) <= 6 and abs(p[1] - 72) <= 6 and abs(p[2] - 82) <= 6


def navy_frac(im):
    px = im.load()
    n = t = 0
    for y in range(0, im.height, 2):
        for x in range(0, im.width, 2):
            p = px[x, y]
            if p[3]:
                t += 1
                if is_navy(p):
                    n += 1
    return n / max(1, t)


def register(ims):
    """아래 부품(남색 구멍)을 위 부품이 덮는 위치 찾기: 남색을 다 덮고, 둘 다 보이는 벽 픽셀이 같을수록 좋음"""
    import numpy as np
    (p0, a), (p1, b) = sorted(ims, key=lambda t: t[0].get('order', 0))
    A = np.array(a).astype(int)
    Bm = np.array(b).astype(int)
    navy = (A[..., 3] > 0) & (abs(A[..., 0] - 60) <= 6) & (abs(A[..., 1] - 72) <= 6) & (abs(A[..., 2] - 82) <= 6)
    ys, xs = np.where(navy)
    best, bo = None, None
    # 남색 영역 가운데 근처로만 찾음
    cx = (xs.min() + xs.max()) / 2 - b.width / 2
    for dy in range(-b.height, a.height, 1):
        for dx in range(int(cx) - 48, int(cx) + 49, 1):
            # b 를 a 좌표 (dx, dy) 에
            y0, y1 = max(0, dy), min(a.height, dy + b.height)
            x0, x1 = max(0, dx), min(a.width, dx + b.width)
            if y1 <= y0 or x1 <= x0:
                continue
            bs = Bm[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
            ac = A[y0:y1, x0:x1]
            nv = navy[y0:y1, x0:x1]
            cov = (bs[..., 3] > 0)
            covered = (nv & cov).sum()
            if covered < navy.sum() * 0.97:
                continue
            both = cov & (ac[..., 3] > 0) & ~nv
            diff = (np.abs(bs[..., :3] - ac[..., :3]).sum(-1) > 30) & both
            score = diff.sum() - both.sum() * 0.2
            if best is None or score < best:
                best, bo = score, (dx, dy)
    return bo


def is_glass(px):
    r, g, b, a = px
    return a > 200 and b >= 170 and g >= 140 and b > r + 30 and b >= g - 10


def window_mask(im):
    """유리 픽셀 (밝은 하늘색) → 밤에 창문 불빛. 흰 창살은 빼고 유리만"""
    m = Image.new('RGBA', im.size, (0, 0, 0, 0))
    s = im.load()
    d = m.load()
    n = 0
    for y in range(im.height):
        for x in range(im.width):
            if is_glass(s[x, y]):
                d[x, y] = (255, 255, 255, 255)
                n += 1
    return m, n


def main():
    shells = {}
    images = []
    for pf in sorted(glob.glob(f'{SRC}/Prefabs/*.prefab'), key=lambda f: int(re.search(r'\((\d+)\)', f).group(1))):
        n = int(re.search(r'\((\d+)\)', pf).group(1))
        # 지붕 조각이 어긋나게 조립되는 것 (검수에서 제외): 14, 33, 39
        if n not in SPEC:
            continue
        im, base, roof, hole = compose(pf)
        mask, glass = window_mask(im)
        door, role, size = SPEC[n]
        fw = (im.width + T - 1) // T
        fd = max(3, round((im.height - STORY) / T))
        shells[f's{n}'] = {'role': role, 'size': size, 'w': im.width, 'h': im.height, 'foot': [fw, fd], 'door': door, 'glass': glass, 'hole': hole}
        images.append((f's{n}', im, mask))
        if hole:
            # 열린 모습: 아래 부품(구멍 투명) / 들어 올릴 지붕 부품
            images.append((f's{n}__base', base, Image.new('RGBA', base.size, (0, 0, 0, 0))))
            images.append((f's{n}__roof', roof, Image.new('RGBA', roof.size, (0, 0, 0, 0))))
    # 요새 조각 (Highlands, 눈 → 사암): 둥근 탑, 아치 성문, 성벽 계단. 발자국 = 그림 아래쪽 칸
    fort = Image.open('assets/generated/world/fortress_desnow.png').convert('RGBA')
    for sid, box, foot, door, role in [
        ('tower', (320, 512, 416, 704), [3, 3], 1, 'tower'),
        ('gate_arch', (416, 288, 480, 384), [2, 1], 0, 'gate'),
        ('wall_stairs', (0, 544, 128, 656), [4, 3], 2, 'stairs'),
    ]:
        im = fort.crop(box)
        im = im.crop(im.getbbox())
        mask, glass = window_mask(im)
        shells[sid] = {'role': role, 'size': 'small', 'w': im.width, 'h': im.height, 'foot': foot, 'door': door, 'glass': 0}
        images.append((sid, im, Image.new('RGBA', im.size, (0, 0, 0, 0))))
    # 선반 쌓기 (높이순), 폭 4096
    W = 4096
    x = y = rowh = 0
    place = []
    for sid, im, mask in sorted(images, key=lambda t: -t[1].height):
        if x + im.width > W:
            x = 0
            y += rowh + 2
            rowh = 0
        place.append((sid, im, mask, x, y))
        x += im.width + 2
        rowh = max(rowh, im.height)
    H = y + rowh
    # 외관 한 장 + 창문 마스크 한 장 (같은 자리)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    outm = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layers = {}
    for sid, im, mask, px, py in place:
        out.paste(im, (px, py))
        outm.paste(mask, (px, py))
        if '__' in sid:
            k, part = sid.split('__')
            shells[k][part] = [px, py]
        else:
            shells[sid]['x'] = px
            shells[sid]['y'] = py
    # 색 (사용자: 원래 건물 색 그대로, 명도·채도·대비만 손봄. 벽은 밝게)
    #  - 색상(H)은 안 바꿈. 어두운 면 들어 올림(감마 0.75), 채도 ×1.08, 순흑 없음
    #  - 채도 낮은 벽(회벽·돌·흰 칠)은 더 밝게 (+10%, 밝은 쪽으로 대비)
    import colorsys
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s_, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            v2 = 0.04 + 0.96 * v ** 0.82
            v2 = 0.55 + (v2 - 0.55) * 1.08  # 대비 살짝
            if s_ < 0.28 and v > 0.35:
                v2 = min(1.0, v2 * 1.10 + 0.02)
                s_ *= 0.85
            else:
                s_ = min(1.0, s_ * 1.08)
            r2, g2, b2 = colorsys.hsv_to_rgb(h, s_, min(1.0, max(0.05, v2)))
            px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
    out.save(OUT_IMG)
    outm.save(OUT_IMG.replace('.png', '_glass.png'))
    # 창문 빛 번짐 (밤): 외관마다 유리 마스크를 크게 흐린 판 (외관 사각형 안에서만, 이웃 외관에 번지지 않게)
    from PIL import ImageFilter
    outb = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for sid, im, mask, px, py in place:
        if mask.getbbox() is None:
            continue
        a = mask.split()[3].filter(ImageFilter.GaussianBlur(7))
        a = a.point(lambda v: min(255, int(v * 2.2)))
        outb.paste(Image.merge('RGBA', (a.point(lambda v: 255), a.point(lambda v: 255), a.point(lambda v: 255), a)), (px, py))
    outb.save(OUT_IMG.replace('.png', '_glow.png'))
    data = {
        '$comment': 'tools/world/build-shells.py 가 만듦. foot = [가로, 세로] 칸, door = 문 열(발자국 왼쪽에서), 그림 아래 끝 = 발자국 맨 아래 줄 아래 끝',
        'image': OUT_IMG, 'glass': OUT_IMG.replace('.png', '_glass.png'), 'glow': OUT_IMG.replace('.png', '_glow.png'), 'story': STORY, 'shells': shells,
    }
    with open(OUT_JSON, 'w', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(OUT_IMG, (W, H), len(shells), '채')


if __name__ == '__main__':
    main()
