"""Tiled .tmx 를 PNG 로 그림 (Epic RPG World 예제 지도 연구/검수용). 타일 레이어 + 타일 오브젝트, 뒤집기 비트 처리.
  python tools/world/render-tmx.py <map.tmx> <out.png> [scale]
"""
import os, sys, base64, zlib, struct
import xml.etree.ElementTree as ET
from PIL import Image

FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000


def load_tileset(path, firstgid):
    root = ET.parse(path).getroot()
    base = os.path.dirname(path)
    ts = {'firstgid': firstgid, 'tw': int(root.get('tilewidth')), 'th': int(root.get('tileheight')), 'tiles': {}}
    img = root.find('image')
    if img is not None:
        im = Image.open(os.path.normpath(os.path.join(base, img.get('source')))).convert('RGBA')
        cols = int(root.get('columns')) or im.width // ts['tw']
        ts['sheet'] = im
        ts['cols'] = cols
        ts['spacing'] = int(root.get('spacing') or 0)
        ts['margin'] = int(root.get('margin') or 0)
    for t in root.findall('tile'):
        ti = t.find('image')
        if ti is not None:
            p = os.path.normpath(os.path.join(base, ti.get('source')))
            if os.path.exists(p):
                ts['tiles'][int(t.get('id'))] = Image.open(p).convert('RGBA')
    return ts


def tile_image(tss, gid):
    raw = gid & ~(FLIP_H | FLIP_V | FLIP_D)
    ts = None
    for t in tss:
        if t['firstgid'] <= raw:
            ts = t
    if ts is None:
        return None
    lid = raw - ts['firstgid']
    if lid in ts['tiles']:
        im = ts['tiles'][lid]
    elif 'sheet' in ts:
        c, r = lid % ts['cols'], lid // ts['cols']
        x = ts['margin'] + c * (ts['tw'] + ts['spacing'])
        y = ts['margin'] + r * (ts['th'] + ts['spacing'])
        im = ts['sheet'].crop((x, y, x + ts['tw'], y + ts['th']))
    else:
        return None
    if gid & FLIP_D:
        im = im.transpose(Image.TRANSPOSE)
    if gid & FLIP_H:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if gid & FLIP_V:
        im = im.transpose(Image.FLIP_TOP_BOTTOM)
    return im


def layer_data(layer, w, h):
    d = layer.find('data')
    enc = d.get('encoding')
    if enc == 'csv':
        return [int(v) for v in d.text.replace('\n', '').split(',') if v.strip()]
    if enc == 'base64':
        b = base64.b64decode(d.text.strip())
        if d.get('compression') == 'zlib':
            b = zlib.decompress(b)
        return list(struct.unpack('<%dI' % (w * h), b))
    return [int(t.get('gid') or 0) for t in d.findall('tile')]


def render(tmx, out, scale=1.0):
    root = ET.parse(tmx).getroot()
    base = os.path.dirname(tmx)
    W, H = int(root.get('width')), int(root.get('height'))
    TW, TH = int(root.get('tilewidth')), int(root.get('tileheight'))
    tss = []
    for t in root.findall('tileset'):
        src = t.get('source')
        if src:
            tss.append(load_tileset(os.path.normpath(os.path.join(base, src)), int(t.get('firstgid'))))
    tss.sort(key=lambda t: t['firstgid'])
    canvas = Image.new('RGBA', (W * TW, H * TH), (30, 30, 40, 255))
    def walk(node):
        for ch in node:
            if ch.tag == 'group':
                if ch.get('visible') != '0':
                    walk(ch)
            elif ch.tag == 'layer':
                if ch.get('visible') == '0':
                    continue
                data = layer_data(ch, W, H)
                for i, gid in enumerate(data):
                    if not gid:
                        continue
                    im = tile_image(tss, gid)
                    if im is None:
                        continue
                    x, y = (i % W) * TW, (i // W) * TH
                    # 큰 타일은 아래 왼쪽 기준
                    canvas.alpha_composite(im, (x, y + TH - im.height))
            elif ch.tag == 'objectgroup':
                if ch.get('visible') == '0':
                    continue
                objs = sorted(ch.findall('object'), key=lambda o: float(o.get('y')))
                for o in objs:
                    gid = o.get('gid')
                    if not gid:
                        continue
                    im = tile_image(tss, int(gid))
                    if im is None:
                        continue
                    ow, oh = float(o.get('width') or im.width), float(o.get('height') or im.height)
                    if (int(ow), int(oh)) != im.size:
                        im = im.resize((max(1, int(ow)), max(1, int(oh))), Image.NEAREST)
                    canvas.alpha_composite(im, (int(float(o.get('x'))), int(float(o.get('y')) - im.height)))
    walk(root)
    if scale != 1:
        canvas = canvas.resize((int(canvas.width * scale), int(canvas.height * scale)), Image.NEAREST)
    canvas.convert('RGB').save(out)
    print(out, canvas.size)


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
