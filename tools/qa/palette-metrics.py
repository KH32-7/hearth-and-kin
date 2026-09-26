"""색감 수치 검사 (docs/레퍼런스_이미지/README.md 기준).
  python tools/qa/palette-metrics.py <이름=이미지> ... [--out artifacts/palette/metrics.md] [--crop x0,y0,x1,y1]
재는 것: 평균 S/V, 가장 어두운/밝은 0.25% 색, 순흑(V<8)/순백(S<5,V>95) 비율, 밝은면·그늘 평균 색상(H)과 차이,
넓은 면(채도 높은 무리) 분포, 흙/돌/목재(H 20~55, 채도>45%) 비율, 풀 평균 H, 물 평균 H
"""
import colorsys, math, os, sys
from PIL import Image


def hsv(p):
    h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
    return h * 360, s * 100, v * 100


def circ_mean(hs, ws=None):
    if not hs:
        return float('nan')
    x = y = 0.0
    for i, h in enumerate(hs):
        w = ws[i] if ws else 1
        x += math.cos(math.radians(h)) * w
        y += math.sin(math.radians(h)) * w
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def measure(path, crop=None):
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(crop)
    im.thumbnail((640, 640))
    px = list(im.getdata())
    hs = [hsv(p) for p in px]
    n = len(hs)
    S = sum(h[1] for h in hs) / n
    V = sum(h[2] for h in hs) / n
    order = sorted(range(n), key=lambda i: hs[i][2])
    k = max(1, n // 400)
    dark = [px[i] for i in order[:k]]
    bright = [px[i] for i in order[-k:]]
    avg = lambda c: '#%02x%02x%02x' % tuple(int(sum(p[j] for p in c) / len(c)) for j in range(3))
    black = sum(1 for h in hs if h[2] < 8) / n * 100
    white = sum(1 for h in hs if h[1] < 5 and h[2] > 95) / n * 100
    vs = sorted(h[2] for h in hs)
    v70, v30 = vs[int(n * 0.7)], vs[int(n * 0.3)]
    lit = [h for h in hs if h[2] >= v70 and h[1] > 15]
    shade = [h for h in hs if h[2] <= v30 and h[1] > 15 and h[2] > 10]
    hl, hsd = circ_mean([h[0] for h in lit]), circ_mean([h[0] for h in shade])
    dh = ((hsd - hl + 180) % 360) - 180
    sl = sum(h[1] for h in lit) / max(1, len(lit))
    ss = sum(h[1] for h in shade) / max(1, len(shade))
    grass = [h for h in hs if 45 <= h[0] <= 170 and h[1] > 25]
    water = [h for h in hs if 170 <= h[0] <= 215 and h[1] > 25]
    earth = [h for h in hs if 18 <= h[0] <= 55 and h[2] > 25]
    earth_hi = sum(1 for h in earth if h[1] > 45) / max(1, len(earth)) * 100
    dark30 = sum(1 for h in hs if h[2] <= 30) / n * 100
    return {
        'S': S, 'V': V, 'dark': avg(dark), 'bright': avg(bright), 'black%': black, 'white%': white,
        'H_lit': hl, 'H_shade': hsd, 'dH': dh, 'S_lit': sl, 'S_shade': ss,
        'grassH': circ_mean([h[0] for h in grass]), 'grass%': len(grass) / n * 100,
        'waterH': circ_mean([h[0] for h in water]), 'earthS>45%': earth_hi, 'V<=30%': dark30,
    }


def main():
    args = sys.argv[1:]
    out = 'artifacts/palette/metrics.md'
    crop = None
    items = []
    i = 0
    while i < len(args):
        if args[i] == '--out':
            out = args[i + 1]
            i += 2
            continue
        if args[i] == '--crop':
            crop = tuple(int(v) for v in args[i + 1].split(','))
            i += 2
            continue
        name, p = args[i].split('=', 1)
        items.append((name, p))
        i += 1
    rows = []
    cols = ['S', 'V', 'dark', 'bright', 'black%', 'white%', 'H_lit', 'H_shade', 'dH', 'S_lit', 'S_shade', 'grassH', 'grass%', 'waterH', 'earthS>45%', 'V<=30%']
    for name, p in items:
        m = measure(p, crop)
        rows.append((name, m))
    fmt = lambda v: f'{v:.1f}' if isinstance(v, float) else str(v)
    lines = ['| 장면 | ' + ' | '.join(cols) + ' |', '|' + '---|' * (len(cols) + 1)]
    for name, m in rows:
        lines.append(f'| {name} | ' + ' | '.join(fmt(m[c]) for c in cols) + ' |')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'a', encoding='utf8') as f:
        f.write('\n'.join(lines) + '\n\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
