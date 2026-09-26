/**
 * 아기/유아 시트 합성 (lpc.json "infant", tools/lpc/gen-infant.ts 가 만든 레이어).
 *
 * 레이어마다 시트 한 장이 같은 칸 배치 → 팔레트 교체(원본 램프 → 이 사람 램프) 후 z 순서로 겹치면 끝.
 * planInfant 는 순수 함수 (브라우저 합성기와 tools/check-infant.ts 가 같이 씀). 무작위 없음.
 *
 * 배치 (64px 칸, 기준점 32,62 = 발/바닥 닿는 점):
 *   아기 4열 × 6행: 0행 요람(0~1열 숨쉬기, 2~3열 울음) / 1행 바닥 깔개 / 2~5행 품 안 (위, 왼, 아래, 오른)
 *     품 안 프레임은 안은 어른 칸 좌표 그대로 (안는 자세 팔 높이) → 어른 스프라이트 사각형에 겹쳐 그림
 *   유아 8열 × 21행: idle 0 / walk 4 / crawl 8 / sit 12 / fall 16 (각 4방향) / sleep 20 (머리만, 아래)
 */
import type { CharacterSpec, Estate, InfantAnim, InfantLayer, InfantPack, LpcPack, OutfitsData, Plan, PlanSource } from './types';
import { hashString } from './plan';

export type InfantKind = 'baby' | 'toddler';

export interface InfantLook {
  skin: string;
  eyes: string;
  hairStyle: string;
  hairColor: string;
  /** 옷/강보 색 (cloth 램프 이름) */
  main: string;
  /** 깔개 색 */
  accent: string;
  /** 유아 옷: smock | gown | tunic */
  garment: string;
  /** 아기 강보/배내옷 색 (cloth 램프 이름). 기본 "tan" = 표백 안 한 리넨(생성) */
  swaddle?: string;
}

/** 강보 기본 색: 표백 안 한 리넨 (신분과 관계없이. 띠와 깔개는 accent 염료) */
export const SWADDLE_DEFAULT = 'tan';

export interface InfantPlan extends Pick<Plan, 'width' | 'height' | 'sources' | 'ops'> {
  kind: InfantKind;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  anims: Record<string, InfantAnim>;
  sleepCropY?: number;
  layers: string[];
  notes: string[];
}

/** 사람 외형(CharacterSpec)에서 아기/유아 색 고르기: 피부/눈/머리색은 그대로, 옷색은 신분 염료에서 결정적으로 */
export function infantLookFromSpec(spec: CharacterSpec, outfits: OutfitsData, pack: LpcPack): InfantLook {
  const seed = spec.layers?.$seed ?? `${spec.skin}|${spec.hair.color}|${spec.estate}`;
  const dyes = outfits.dyes[spec.estate] ?? outfits.dyes.freeman;
  const pick = (list: string[], key: string) => list[hashString(`${seed}#infant:${key}`) % list.length];
  const garment = pack.infant?.toddler.estateGarment[spec.estate as Estate] ?? 'smock';
  return {
    skin: spec.skin,
    eyes: spec.layers?.$eyes ?? pick(outfits.eyes, 'eyes'),
    hairStyle: spec.hair.style,
    hairColor: spec.hair.color,
    main: spec.layers?.$main ?? pick(dyes.main, 'main'),
    accent: spec.layers?.$accent ?? pick(dyes.accent, 'accent'),
    garment,
    swaddle: SWADDLE_DEFAULT,
  };
}

function colorFor(role: string, look: InfantLook): string {
  switch (role) {
    case 'skin': return look.skin;
    case 'eye': return look.eyes;
    case 'hair': return look.hairColor;
    case 'accent': return look.accent;
    case 'swaddle': return look.swaddle ?? SWADDLE_DEFAULT;
    default: return look.main;
  }
}

export function planInfant(kind: InfantKind, look: InfantLook, pack: LpcPack): InfantPlan {
  const inf: InfantPack | undefined = pack.infant;
  if (!inf) throw new Error('lpc.json has no infant section (run tools/lpc/gen-infant.ts + build-pack.ts)');
  const notes: string[] = [];
  const part = kind === 'baby' ? inf.baby : inf.toddler;
  const layers: InfantLayer[] = [...part.layers];
  if (kind === 'toddler') {
    const t = inf.toddler;
    const g = t.garments[look.garment] ?? t.garments.smock;
    if (!t.garments[look.garment]) notes.push(`garment ${look.garment} unknown, using smock`);
    layers.push(g);
    const hairId = `hair_${look.hairStyle}`;
    const hair = t.hair[hairId] ?? t.hair[Object.keys(t.hair).sort()[hashString(look.hairStyle) % Object.keys(t.hair).length]];
    if (!t.hair[hairId]) notes.push(`hair ${look.hairStyle} has no toddler sheet, using another child style`);
    if (hair) layers.push(hair);
  }
  layers.sort((a, b) => a.z - b.z);
  const sources: PlanSource[] = [];
  const ops: Plan['ops'] = [];
  const W = part.cols * inf.frameW;
  const H = part.rows * inf.frameH;
  for (const l of layers) {
    const src: PlanSource = { path: `${pack.roots.gen}${l.path}` };
    if (l.recolor) {
      const from: string[] = [];
      const to: string[] = [];
      for (const ch of l.recolor) {
        const name = colorFor(ch.role, look);
        const ramp = pack.palettes[ch.material]?.colors[name];
        if (!ramp) {
          notes.push(`${l.path}: unknown ${ch.material} colour ${name}`);
          continue;
        }
        const n = Math.min(ch.source.length, ramp.length);
        for (let k = 0; k < n; k++) if (ch.source[k] !== ramp[k]) { from.push(ch.source[k]); to.push(ramp[k]); }
      }
      if (from.length) src.recolor = { from, to };
    }
    ops.push({ s: sources.length, sx: 0, sy: 0, w: W, h: H, dx: 0, dy: 0 });
    sources.push(src);
  }
  return {
    kind,
    width: W,
    height: H,
    sources,
    ops,
    frameW: inf.frameW,
    frameH: inf.frameH,
    anchorX: inf.anchorX,
    anchorY: inf.anchorY,
    anims: { ...part.anims } as Record<string, InfantAnim>,
    ...(kind === 'toddler' ? { sleepCropY: inf.toddler.sleepCropY } : {}),
    layers: layers.map((l) => l.path),
    notes,
  };
}

/** 프레임 사각형 (시트 px) */
export function infantFrameRect(plan: Pick<InfantPlan, 'anims' | 'frameW' | 'frameH'>, anim: string, dir: string, frame: number): { x: number; y: number; w: number; h: number } | null {
  const a = plan.anims[anim];
  if (!a) return null;
  const di = Math.max(0, a.dirs.indexOf(dir as never));
  const f = Math.max(0, Math.min(a.frames - 1, frame));
  return { x: (a.col + f) * plan.frameW, y: (a.row + (a.dirs.length > 1 ? di : 0)) * plan.frameH, w: plan.frameW, h: plan.frameH };
}

/** 유아 동작 고르기 (CharacterView 가 씀). 입력: 스냅샷 일부 + 지금 움직이는 중인지 */
export interface ToddlerAnimInput {
  anim: string;
  pose: string;
  sleeping: boolean;
  underBlanket: boolean;
  collapsed: boolean;
}
/**
 * - 잠(침대, 이불 아래 누움) → sleep (머리만, 베개 위)
 * - 쓰러짐 → fall 마지막 프레임 (주저앉은 모습)
 * - anim 'crawl' (걷기 2단계 전 이동) → crawl 재생 (스냅샷 사이 보간이 잠깐 끝나도 멈추지 않게, sim 이 멈추면 anim 을 바꿈)
 * - anim 'fall' (떼쓰기, 넘어짐) → fall 한 번 재생 후 마지막 프레임 유지
 * - 그 밖에 움직이는 중 → walk
 * - anim 'sit' 또는 앉은 자세 → sit (놀이 2프레임)
 * - 가만히 서 있음 (anim 'walk' 인데 도착했거나 'idle' 등) → idle
 */
export function toddlerAnim(p: ToddlerAnimInput, moving: boolean): { anim: 'idle' | 'walk' | 'crawl' | 'sit' | 'fall' | 'sleep'; fixedFrame: number | null } {
  if (p.sleeping || (p.pose === 'lie' && p.underBlanket)) return { anim: 'sleep', fixedFrame: null };
  if (p.collapsed) return { anim: 'fall', fixedFrame: 3 };
  if (p.anim === 'crawl') return { anim: 'crawl', fixedFrame: null };
  if (p.anim === 'fall') return { anim: 'fall', fixedFrame: null };
  if (moving) return { anim: 'walk', fixedFrame: null };
  if (p.anim === 'sit' || p.pose === 'sit') return { anim: 'sit', fixedFrame: null };
  return { anim: 'idle', fixedFrame: null };
}
