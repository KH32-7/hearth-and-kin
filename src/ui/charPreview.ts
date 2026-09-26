/**
 * 가문 만들기 미리보기 (GDD 10-1): 게임과 같은 LPC 합성(composeCharacter / 아기·유아 planInfant) + 같은 색 보정(grading.json).
 * 캔버스에는 스프라이트만 그림 (글자는 DOM). 정수 배율, imageSmoothing 끔.
 */
import grading from '../data/grading.json';
import { applyGrade, type Grade } from '../render/color';
import { composeCharacter, LPC_PACK, OUTFITS, renderPlan } from '../render/lpc/compose';
import { infantLookFromSpec, planInfant, type InfantKind } from '../render/lpc/infant';
import type { CharacterSpec } from '../render/lpc/types';

export interface PreviewSheet {
  image: HTMLCanvasElement | OffscreenCanvas;
  frameW: number;
  frameH: number;
  /** 아기/유아는 infant 칸 배치 (col 이 있음) */
  anims: Record<string, { row: number; col?: number; frames: number; fps: number; dirs: string[] }>;
  infant: InfantKind | null;
}

export type ImageLoader = (path: string) => Promise<CanvasImageSource>;

const cache = new Map<string, Promise<PreviewSheet>>();

function grade(img: HTMLCanvasElement | OffscreenCanvas): void {
  const g = (grading as unknown as { character: Grade }).character;
  const ctx = img.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) return;
  const d = ctx.getImageData(0, 0, img.width, img.height);
  applyGrade(d.data, g);
  ctx.putImageData(d, 0, 0);
}

/** 외형 → 시트 (같은 외형은 캐시). lifeStage 가 baby/toddler 면 아기·유아 시트 */
export function previewSheet(spec: CharacterSpec, lifeStage: string, load: ImageLoader): Promise<PreviewSheet> {
  const key = `${lifeStage}|${JSON.stringify(spec)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<PreviewSheet> => {
      if (lifeStage === 'baby' || lifeStage === 'toddler') {
        const plan = planInfant(lifeStage, infantLookFromSpec(spec, OUTFITS, LPC_PACK), LPC_PACK);
        const image = await renderPlan(plan, load);
        grade(image);
        return { image, frameW: plan.frameW, frameH: plan.frameH, anims: plan.anims as PreviewSheet['anims'], infant: lifeStage };
      }
      const sheet = await composeCharacter(spec, load);
      grade(sheet.image);
      return { image: sheet.image, frameW: sheet.frameW, frameH: sheet.frameH, anims: sheet.anims as unknown as PreviewSheet['anims'], infant: null };
    })();
    cache.set(key, p);
    if (cache.size > 80) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** 한 프레임을 캔버스에 (정수 배율). dir: up/left/down/right */
export function drawFrame(ctx: CanvasRenderingContext2D, sheet: PreviewSheet, anim: string, dir: string, frame: number, dx: number, dy: number, scale: number): void {
  const a = sheet.anims[anim] ?? sheet.anims.idle ?? Object.values(sheet.anims)[0];
  if (!a) return;
  const di = a.dirs.length > 1 ? Math.max(0, a.dirs.indexOf(dir)) : 0;
  const f = ((frame % a.frames) + a.frames) % a.frames;
  const sx = ((a.col ?? 0) + f) * sheet.frameW;
  const sy = (a.row + di) * sheet.frameH;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet.image as CanvasImageSource, sx, sy, sheet.frameW, sheet.frameH, dx, dy, sheet.frameW * scale, sheet.frameH * scale);
}

/** 머리 초상 (게임 HearthGame.portrait 와 같은 자리: 정면 서기 첫 프레임, 32×32) */
export function headCanvas(sheet: PreviewSheet): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if (sheet.infant) {
    const a = sheet.anims[sheet.infant === 'baby' ? 'floor' : 'idle'] ?? Object.values(sheet.anims)[0];
    const di = a.dirs.length > 1 ? Math.max(0, a.dirs.indexOf('down')) : 0;
    g.drawImage(sheet.image as CanvasImageSource, (a.col ?? 0) * sheet.frameW + (sheet.frameW - 32) / 2, (a.row + di) * sheet.frameH + 26, 32, 32, 0, 0, 32, 32);
    return c;
  }
  const idle = sheet.anims.idle ?? Object.values(sheet.anims)[0];
  const row = idle.row + Math.max(0, idle.dirs.indexOf('down'));
  g.drawImage(sheet.image as CanvasImageSource, (sheet.frameW - 32) / 2, row * sheet.frameH + 6, 32, 32, 0, 0, 32, 32);
  return c;
}
