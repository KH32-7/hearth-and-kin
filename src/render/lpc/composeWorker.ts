/**
 * 인물 시트 합성 워커: LPC 겹 불러오기·색 바꾸기·겹치기·화풍 색 보정을 메인 스레드 밖에서.
 * 표정·옷이 바뀔 때마다 메인에서 하던 합성(한 번에 50ms 넘음)이 2·3배속에서 화면을 멈칫하게 하던 것을 없앰.
 * 결과는 ImageBitmap 으로 넘김 (메인은 캔버스에 한 번 그려 텍스처로 씀)
 */
import grading from '../../data/grading.json';
import { applyGrade, type Grade } from '../color';
import { composeCharacter } from './compose';
import type { CharacterSpec } from './types';

type Req = { id: number; spec: CharacterSpec; base: string };

const images = new Map<string, Promise<ImageBitmap>>();
function load(base: string, path: string): Promise<ImageBitmap> {
  let p = images.get(path);
  if (!p) {
    const url = base + path.split('/').map(encodeURIComponent).join('/');
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`이미지 로드 실패: ${path}`);
      return r.blob();
    }).then((b) => createImageBitmap(b));
    images.set(path, p);
    p.catch(() => images.delete(path));
  }
  return p;
}

const G = (grading as unknown as { character: Grade }).character;
const neutral = G.saturation === 1 && G.value === 1 && G.contrast === 1 && G.tint.every((v) => v === 1) && G.paletteSnap === 0;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, spec, base } = ev.data;
  try {
    const sheet = await composeCharacter(spec, (path) => load(base, path));
    const c = sheet.image as OffscreenCanvas;
    if (!neutral) {
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      const data = ctx.getImageData(0, 0, c.width, c.height);
      // 팔레트 스냅(paletteSnap)은 세계 그림 색이 필요해 메인에서만 (지금 설정은 0)
      applyGrade(data.data, G);
      ctx.putImageData(data, 0, 0);
    }
    const bmp = c.transferToImageBitmap();
    const { image: _i, ...meta } = sheet;
    (self as unknown as Worker).postMessage({ id, bmp, meta }, [bmp]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String(e) });
  }
};
