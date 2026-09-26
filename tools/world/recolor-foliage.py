"""나무/덤불/풀/풀지붕 그림을 06 팔레트 잎 색으로 (build-world.ts 뒤에 실행: npm run build:art 가 부름).
 - 초록 잎 → 잎 램프 (#3e3a12 … #717315 #8a9a3c #a6a624 #b1b44f)
 - 붉은/분홍 단풍 → 단풍 램프 (#6b3a14 #a6782a #c9a24a #e2cb6e)
 - 스프라이트 사각형 안에서만 (epic.json 의 foliage id). 외관 아틀라스(shells_0) 는 풀지붕 초록만
  python tools/world/recolor-foliage.py
"""
import colorsys, json, os, re, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)
sys.path.insert(0, os.path.dirname(__file__))

LEAF = ['#1c3d05', '#2c5d06', '#3f7210', '#588a1c', '#689a31', '#92b31e', '#afc054']
AUTUMN = ['#5a220a', '#a76018', '#d0761f', '#f78b2c', '#f7c24f', '#f7dd6a']
FOLIAGE = re.compile(r'^(tree_|bush|shrub|wildflower|flower_bed|tallgrass|grass_|hedge|vine|ivy|herb_patch|orchard|potted_|pot_|reed|fern|leaves|garden_plot|crop_)')


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def classify(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    if s > 0.25 and 60 <= hd <= 175 and v > 0.1:
        return 'leaf', v
    if s > 0.3 and (hd >= 330 or hd <= 22) and v > 0.35:
        return 'autumn', v
    return None, v


def remap(images_rects, groups=('leaf', 'autumn')):
    vals = {g: [] for g in groups}
    hits = []
    for im, rects in images_rects:
        px = im.load()
        for (x0, y0, x1, y1) in rects:
            for y in range(max(0, y0), min(im.height, y1)):
                for x in range(max(0, x0), min(im.width, x1)):
                    r, g, b, a = px[x, y]
                    if a == 0:
                        continue
                    c, v = classify(r, g, b)
                    if c in groups:
                        vals[c].append(v)
                        hits.append((px, x, y, c, v, a))
    edges = {}
    for c, vs in vals.items():
        if vs:
            vs.sort()
            n = len(vs)
            edges[c] = [vs[min(n - 1, int(n * k / 256))] for k in range(257)]
    ramps = {'leaf': LEAF, 'autumn': AUTUMN}
    seen = set()
    for px, x, y, c, v, a in hits:
        key = (id(px), x, y)
        if key in seen:
            continue
        seen.add(key)
        e = edges[c]
        lo, hi = 0, 256
        while lo < hi:
            m = (lo + hi) // 2
            if e[m] < v:
                lo = m + 1
            else:
                hi = m
        ramp = ramps[c]
        k = min(len(ramp) - 1, int(lo / 256 * len(ramp)))
        px[x, y] = (*hexrgb(ramp[k]), a)
    return len(hits)


def main():
    art = json.load(open('src/data/artpacks/epic.json', encoding='utf8'))
    by_img = {}
    for sid, s in art['sprites'].items():
        if not FOLIAGE.match(sid):
            continue
        path = art['images'].get(s['image'])
        if not path or 'vendor' in path:
            continue
        frames = s.get('frames', 1)
        dx = s.get('frameDx', s['w'])
        by_img.setdefault(path, []).append((s['x'], s['y'], s['x'] + dx * (frames - 1) + s['w'], s['y'] + s['h']))
    todo = []
    for path, rects in by_img.items():
        todo.append((path, Image.open(path).convert('RGBA'), rects))
    n = remap([(im, rects) for _, im, rects in todo])
    for path, im, _ in todo:
        im.save(path)
    # 외관: 풀지붕만 (잎 무리), 전체 이미지
    sh = 'assets/generated/world/shells_0.png'
    if os.path.exists(sh):
        im = Image.open(sh).convert('RGBA')
        n2 = remap([(im, [(0, 0, im.width, im.height)])], groups=('leaf',))
        im.save(sh)
    else:
        n2 = 0
    print('잎 픽셀', n, '외관', n2, '이미지', len(todo))


if __name__ == '__main__':
    main()
