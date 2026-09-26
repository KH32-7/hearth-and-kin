/**
 * Pure LPC character planner: CharacterSpec -> list of draw ops (source image, source rect, dest rect).
 * Shared by the browser compositor (compose.ts) and the Node tools (tools/lpc/compose-node.ts),
 * so both produce the same sheet. No DOM, no Node, no Math.random.
 */
import type {
  AnimDef, AnimInfo, AnimName, BodyType, CharacterSpec, DrawOp, Facing, LayerDef, LayerPart, LookSlot,
  LpcPack, OutfitsData, Plan, PlanSource, ResolvedLayer, SrcRef, Stage,
} from './types';

// ------------------------------------------------------------------ deterministic hashing

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seedOf(spec: CharacterSpec): string {
  return spec.layers?.$seed ?? `${spec.sex}|${spec.stage}|${spec.estate}|${spec.skin}|${spec.hair.style}|${spec.hair.color}`;
}

/** Deterministic choice among `n` options for a named decision. */
function choose(seed: string, key: string, n: number): number {
  if (n <= 1) return 0;
  return hashString(`${seed}#${key}`) % n;
}

function roll(seed: string, key: string): number {
  return (hashString(`${seed}#${key}`) % 10000) / 10000;
}

// ------------------------------------------------------------------ body type

export function bodyTypeFor(spec: Pick<CharacterSpec, 'sex' | 'stage' | 'pregnant'>): BodyType {
  if (spec.stage === 'child') return 'child';
  if (spec.stage === 'teen') return spec.sex === 'female' && (spec.pregnant ?? 0) > 0 ? 'pregnant' : 'teen';
  if (spec.sex === 'female') return (spec.pregnant ?? 0) > 0 ? 'pregnant' : 'female';
  return 'male';
}

/** Layer slots whose parts move with the head (used by head bob). */
const HEAD_SLOTS = new Set(['head', 'hair', 'beard', 'hat', 'face', 'eyebrows', 'stage']);

// ------------------------------------------------------------------ layer resolution

interface Resolved extends ResolvedLayer {
  group: 'head' | 'body';
  optional: boolean;
  /** hidden by headwear while awake; drawn only in sleep frames (headwear is taken off in bed) */
  sleepOnly?: boolean;
}

function dyeFor(
  spec: CharacterSpec, outfits: OutfitsData, seed: string, role: string, layerKey: string,
): string {
  if (role.startsWith('fixed:')) return role.slice(6);
  if (role.startsWith('metal')) {
    const fixed = role.split(':')[1];
    if (fixed) return fixed;
    const metals = outfits.metals[spec.estate];
    return metals[choose(seed, 'metal', metals.length)];
  }
  const ch = (role === 'accent' || role === 'trim' ? role : 'main') as 'main' | 'accent' | 'trim';
  const override = spec.layers?.[`$${ch}`];
  if (override) return override;
  const list = outfits.dyes[spec.estate][ch];
  return list[choose(seed, `dye:${ch}:${layerKey}`, list.length)];
}

/** The part paths usable for body type `bt` (with clothing fallback). */
function partBody(pack: LpcPack, part: LayerPart, bt: BodyType): BodyType | null {
  if (part.paths[bt]) return bt;
  for (const fb of pack.bodyTypes[bt]?.clothingFallback ?? []) if (part.paths[fb]) return fb;
  return null;
}

function layerSupports(pack: LpcPack, layer: LayerDef, bt: BodyType): boolean {
  return layer.parts.some((p) => partBody(pack, p, bt) !== null);
}

export interface ResolveResult {
  bodyType: BodyType;
  layers: Resolved[];
  notes: string[];
}

/**
 * Resolve a spec into concrete layers with colours (deterministic).
 * Order of the returned list does not matter; drawing order comes from part z.
 */
export function resolveLayers(spec: CharacterSpec, pack: LpcPack, outfits: OutfitsData): ResolveResult {
  const bt = bodyTypeFor(spec);
  const seed = seedOf(spec);
  const notes: string[] = [];
  const out: Resolved[] = [];
  const over = spec.layers ?? {};
  const eyes = over.$eyes ?? outfits.eyes[choose(seed, 'eyes', outfits.eyes.length)];

  const push = (slot: string, id: string, colors: string[], optional = false, sleepOnly = false) => {
    const layer = pack.layers[id];
    if (!layer) {
      notes.push(`unknown layer ${id} (slot ${slot})`);
      return;
    }
    if (!layerSupports(pack, layer, bt)) {
      notes.push(`layer ${id} has no ${bt} sprites (slot ${slot}) - skipped`);
      return;
    }
    out.push({ slot, id, colors, group: HEAD_SLOTS.has(slot) ? 'head' : 'body', optional, ...(sleepOnly ? { sleepOnly } : {}) });
  };

  // body + head
  push('body', 'body', [spec.skin]);
  const heads = outfits.heads[spec.sex][spec.stage];
  const headId = over.$head ?? heads[choose(seed, 'head', heads.length)];
  push('head', headId, [spec.skin, eyes]);
  for (const extra of outfits.stageExtras[spec.stage] ?? []) push('stage', extra, [spec.skin]);

  // look
  const lookId = outfits.estates[spec.estate]?.[spec.sex]?.[spec.stage]?.[spec.outfit];
  const look: LookSlot[] = (lookId && outfits.looks[lookId]) || [];
  if (!lookId) notes.push(`no look for ${spec.estate}/${spec.sex}/${spec.stage}/${spec.outfit}`);
  const hidden = new Set<string>();
  for (const s of look) {
    const ov = over[s.slot];
    let id: string;
    let colors: string[] | null = null;
    if (ov) {
      if (ov === 'none') continue;
      const [lid, c] = ov.split(':');
      id = lid;
      if (c) colors = c.split('+');
    } else {
      if (s.chance !== undefined && s.chance < 1 && roll(seed, `chance:${s.slot}`) >= s.chance) continue;
      let options = s.pick.filter((p) => pack.layers[p] && layerSupports(pack, pack.layers[p], bt));
      // prefer options drawn for this exact body type (e.g. pregnant shirts) over borrowed paths
      const exact = options.filter((p) => pack.layers[p].parts.some((part) => part.paths[bt]));
      if (exact.length) options = exact;
      // ...and among those, the ones with the most animations (avoids e.g. a tank top without idle/sit)
      const animCount = (p: string) => Math.max(...pack.layers[p].parts.map((part) => (part.anims[bt] ?? part.anims[partBody(pack, part, bt) ?? bt] ?? []).length));
      const most = Math.max(...options.map(animCount));
      options = options.filter((p) => animCount(p) === most);
      if (!options.length) {
        notes.push(`slot ${s.slot}: none of [${s.pick.join(', ')}] has ${bt} sprites - skipped`);
        continue;
      }
      id = options[choose(seed, `pick:${s.slot}`, options.length)];
    }
    const layer = pack.layers[id];
    if (!layer) {
      notes.push(`unknown layer ${id} (slot ${s.slot})`);
      continue;
    }
    if (!colors) {
      const roles = s.dye ?? ['main'];
      const n = layer.recolor ? layer.recolor.length : 1;
      colors = [];
      for (let i = 0; i < n; i++) colors.push(dyeFor(spec, outfits, seed, roles[i] ?? roles[0], `${s.slot}${i}`));
    }
    if (layer.variants) {
      // variant layers: colour must be an existing variant name
      const want = colors[0];
      if (!layer.variants.includes(want)) {
        const role = (s.dye ?? ['main'])[0];
        const pool = role.startsWith('fixed:') || role.startsWith('metal') ? [] : outfits.dyes[spec.estate][(role === 'accent' || role === 'trim' ? role : 'main') as 'main'];
        const alt = pool.find((c) => layer.variants!.includes(c)) ?? layer.variants[0];
        notes.push(`${id}: colour ${want} not available, using ${alt}`);
        colors = [alt];
      }
    }
    for (const h of s.hides ?? []) hidden.add(h);
    push(s.slot, id, colors, !!s.optional);
  }

  // hair + beard (after look so hats can hide them)
  {
    const styles = outfits.hair.styles[spec.sex][spec.stage];
    let hairId = `hair_${spec.hair.style}`;
    const hl = pack.layers[hairId];
    if (!hl || !layerSupports(pack, hl, bt)) {
      const alt = styles.map((s) => `hair_${s}`).find((h) => pack.layers[h] && layerSupports(pack, pack.layers[h], bt));
      notes.push(`hair ${spec.hair.style} unavailable for ${bt}, using ${alt?.slice(5) ?? 'none'}`);
      hairId = alt ?? '';
    }
    if (hairId) {
      const hairLayer = pack.layers[hairId];
      const colors = [spec.hair.color];
      // some hair styles carry a second (ribbon) channel
      if (hairLayer.recolor && hairLayer.recolor.length > 1) colors.push(dyeFor(spec, outfits, seed, 'accent', 'hairribbon'));
      push('hair', hairId, colors, false, hidden.has('hair'));
    }
  }
  if (spec.sex === 'male') {
    const chance = outfits.hair.beardChance[spec.stage] ?? 0;
    let beard = over.$beard;
    if (!beard && chance > 0 && roll(seed, 'beard') < chance) {
      beard = outfits.hair.beards[choose(seed, 'beardstyle', outfits.hair.beards.length)];
    }
    if (beard && beard !== 'none') push('beard', beard, [spec.hair.color], false, hidden.has('beard'));
  }
  return { bodyType: bt, layers: out, notes };
}

// ------------------------------------------------------------------ planning

interface PartUse {
  layer: Resolved;
  def: LayerDef;
  part: LayerPart;
  order: number;
}

function sortedParts(pack: LpcPack, layers: Resolved[]): PartUse[] {
  const uses: PartUse[] = [];
  let order = 0;
  for (const l of layers) {
    const def = pack.layers[l.id];
    for (const part of def.parts) uses.push({ layer: l, def, part, order: order++ });
  }
  // lower z first (behind); stable by insertion order
  uses.sort((a, b) => a.part.z - b.part.z || a.order - b.order);
  return uses;
}

class PlanBuilder {
  sources: PlanSource[] = [];
  ops: DrawOp[] = [];
  fallbacks = new Set<string>();
  usedFiles = new Set<string>();
  private srcIndex = new Map<string, number>();

  constructor(private pack: LpcPack) {}

  /** Source for a layer part, generator anim and body type; null if missing. */
  source(u: PartUse, anim: string, bt: BodyType): number | null {
    const pack = this.pack;
    const useBt = partBody(pack, u.part, bt);
    if (!useBt) return null;
    if (!(u.part.anims[useBt] ?? []).includes(anim)) return null;
    const root = u.def.generated ? pack.roots.gen : pack.roots.lpc;
    const folder = `${root}${u.part.paths[useBt]}`;
    const file = pack.sourceAnims[anim]?.file ?? anim;
    let path: string;
    let recolor: PlanSource['recolor'];
    const variantStyle = !!u.def.variants || (u.part.variantDirs ?? []).includes(useBt);
    if (variantStyle) {
      path = `${folder}${file}/${u.layer.colors[0]}.png`;
    } else {
      path = `${folder}${file}.png`;
      if (u.def.recolor) {
        const from: string[] = [];
        const to: string[] = [];
        u.def.recolor.forEach((ch, i) => {
          const name = u.layer.colors[i] ?? u.layer.colors[0];
          const ramp = pack.palettes[ch.material]?.colors[name];
          if (!ramp) {
            this.fallbacks.add(`${u.layer.id}: unknown ${ch.material} colour "${name}" - left uncoloured`);
            return;
          }
          const n = Math.min(ch.source.length, ramp.length);
          for (let k = 0; k < n; k++) {
            if (ch.source[k] === ramp[k]) continue;
            from.push(ch.source[k]);
            to.push(ramp[k]);
          }
        });
        if (from.length) recolor = { from, to };
      }
    }
    const key = `${path}|${recolor ? recolor.from.join(',') + '>' + recolor.to.join(',') : ''}`;
    let idx = this.srcIndex.get(key);
    if (idx === undefined) {
      idx = this.sources.length;
      this.sources.push(recolor ? { path, recolor } : { path });
      this.srcIndex.set(key, idx);
      this.usedFiles.add(`${u.part.paths[useBt]}${file}`);
    }
    if (useBt !== bt) this.fallbacks.add(`${u.layer.id}: uses ${useBt} sprites for ${bt}`);
    return idx;
  }

  op(s: number, sx: number, sy: number, w: number, h: number, dx: number, dy: number) {
    if (w <= 0 || h <= 0) return;
    this.ops.push({ s, sx, sy, w, h, dx, dy });
  }
}

interface Choice {
  bt: BodyType;
  src: SrcRef;
}

/** First (body type, source) alternative whose anim every required layer has. */
function chooseSource(pack: LpcPack, uses: PartUse[], bt: BodyType, alts: SrcRef[], label: string, fb: Set<string>): Choice {
  const bodies: BodyType[] = [bt, ...(pack.bodyTypes[bt]?.clothingFallback ?? [])];
  const required = uses.filter((u) => !u.layer.optional);
  const ids = [...new Set(required.map((u) => u.layer.id))];
  /** number of required layers whose every usable part has `anim` for body `b` */
  const score = (b: BodyType, anim: string) =>
    ids.filter((id) => {
      const parts = required.filter((u) => u.layer.id === id && partBody(pack, u.part, b));
      return parts.length > 0 && parts.every((u) => (u.part.anims[partBody(pack, u.part, b)!] ?? []).includes(anim));
    }).length;
  let best: { b: BodyType; i: number; s: number } | null = null;
  for (const b of bodies) {
    const bodyInfo = pack.bodyTypes[b];
    for (let i = 0; i < alts.length; i++) {
      if (bodyInfo && !bodyInfo.anims.includes(alts[i].anim)) continue;
      const s = score(b, alts[i].anim);
      if (s === ids.length) {
        if (b !== bt) fb.add(`${label}: drawn with ${b} body (some layers lack ${bt} ${alts[i].anim})`);
        else if (i > 0) fb.add(`${label}: using ${alts[i].anim}[${alts[i].frames.join(',')}] (some layers lack ${alts[0].anim})`);
        return { bt: b, src: alts[i] };
      }
      if (!best || s > best.s) best = { b, i, s };
    }
  }
  // nothing satisfies every layer: take the choice that satisfies the most; the rest are skipped (recorded)
  if (!best) return { bt, src: alts[0] };
  if (best.b !== bt) fb.add(`${label}: drawn with ${best.b} body (some layers lack ${bt} ${alts[best.i].anim})`);
  return { bt: best.b, src: alts[best.i] };
}

/**
 * Plan a full character sheet in the pack's standard layout.
 */
export function planCharacter(spec: CharacterSpec, pack: LpcPack, outfits: OutfitsData): Plan {
  const res = resolveLayers(spec, pack, outfits);
  const bt = res.bodyType;
  const allUses = sortedParts(pack, res.layers);
  // awake: without layers hidden by headwear; asleep: headwear off, hidden hair back
  // 감정 표정 ($expr): 깨어 있는 모든 동작에 얼굴 덧그림 (잠은 눈 감은 얼굴)
  const expr = spec.layers?.$expr;
  const exprUses = expr ? faceUses(pack, res.layers, allUses.length, bt, `face_${expr}`) : [];
  const awakeUses = [...allUses.filter((u) => !u.layer.sleepOnly), ...exprUses].sort((x, y) => x.part.z - y.part.z || x.order - y.order);
  const sleepUses = allUses.filter((u) => u.layer.slot !== 'hat');
  let uses = awakeUses;
  const b = new PlanBuilder(pack);
  for (const n of res.notes) b.fallbacks.add(n);
  const W = pack.frameW;
  const H = pack.frameH;
  const dirIndex = (d: Facing) => pack.dirs.indexOf(d);
  const bodyInfo = pack.bodyTypes[bt];
  if (!bodyInfo) throw new Error(`body type ${bt} missing from pack`);

  const srcRow = (src: SrcRef, d: Facing) => (src.row !== undefined ? src.row : (pack.sourceAnims[src.anim]?.rows ?? 4) === 1 ? 0 : dirIndex(d));

  /** copy one frame of every layer (optionally a horizontal band and with vertical offset) */
  const copyFrame = (
    choice: Choice, frame: number, d: Facing, dstCol: number, dstRow: number,
    band?: { y0: number; y1: number; dy?: number; group?: 'head' | 'body'; groupDy?: number; x0?: number; x1?: number },
    extraUses: PartUse[] = [], label = '',
  ) => {
    const all = extraUses.length ? [...uses, ...extraUses].sort((x, y) => x.part.z - y.part.z || x.order - y.order) : uses;
    for (const u of all) {
      const s = b.source(u, choice.src.anim, choice.bt);
      if (s === null) {
        if (partBody(pack, u.part, choice.bt) && !u.layer.optional) b.fallbacks.add(`${label}: ${u.layer.id} lacks ${choice.src.anim} - skipped`);
        continue;
      }
      const sx = frame * W;
      const sy = srcRow(choice.src, d) * H;
      let y0 = band ? band.y0 : 0;
      let y1 = band ? band.y1 : H;
      let dy = band?.dy ?? 0;
      if (band?.group && u.layer.group === band.group) dy += band.groupDy ?? 0;
      // source rows [y0 - dy, y1 - dy) land on dest rows [y0, y1)
      let syy = y0 - dy;
      if (syy < 0) {
        y0 -= syy;
        syy = 0;
      }
      if (syy + (y1 - y0) > H) y1 = H - syy + y0;
      const x0 = band?.x0 ?? 0;
      const x1 = band?.x1 ?? W;
      b.op(s, sx + x0, sy + syy, x1 - x0, y1 - y0, dstCol * W + x0, dstRow * H + y0);
    }
  };

  const anims = {} as Record<AnimName, AnimInfo>;
  let sleepCropY = bodyInfo.sleepCropY;
  const order = (Object.keys(pack.anims) as AnimName[]).sort((x, y) => pack.anims[x].row - pack.anims[y].row);
  for (const name of order) {
    const def: AnimDef = pack.anims[name];
    anims[name] = { row: def.row, frames: def.frames, fps: def.fps, loop: def.loop, dirs: def.dirs };
    if (def.poses) anims[name].poses = { ...def.poses };
    switch (def.recipe) {
      case 'direct':
      case 'work': {
        const alts = def.recipe === 'work' ? [bodyInfo.workSrc, ...def.src] : def.src;
        const choice = chooseSource(pack, uses, bt, alts, name, b.fallbacks);
        def.dirs.forEach((d, di) => {
          for (let i = 0; i < def.frames; i++) {
            const f = choice.src.frames[i % choice.src.frames.length];
            copyFrame(choice, f, d, i, def.row + di, undefined, [], name);
          }
        });
        break;
      }
      case 'sleep': {
        uses = sleepUses;
        const choice = chooseSource(pack, uses, bt, def.src, name, b.fallbacks);
        const extra = sleepFaceUses(pack, res.layers, uses.length, choice.bt);
        if (!extra.length) b.fallbacks.add(`sleep: no closed-eyes face for ${choice.bt}`);
        const crop = (pack.bodyTypes[choice.bt] ?? bodyInfo).sleepCropY;
        sleepCropY = crop;
        def.dirs.forEach((d, di) => {
          for (let i = 0; i < def.frames; i++) {
            copyFrame(choice, choice.src.frames[i], d, i, def.row + di, { y0: 0, y1: crop }, extra, name);
          }
        });
        uses = awakeUses;
        break;
      }
      case 'eat': {
        // lower (seated) source
        const lower = chooseSource(pack, uses, bt, def.src, name, b.fallbacks);
        const info = pack.bodyTypes[lower.bt] ?? bodyInfo;
        const upper = chooseSource(pack, uses, lower.bt, [info.eatUpper], `${name}(arms)`, b.fallbacks);
        def.dirs.forEach((d, di) => {
          for (let i = 0; i < def.frames; i++) {
            const lf = lower.src.frames[i % lower.src.frames.length];
            if (d === 'down' && upper.bt === lower.bt) {
              const uf = upper.src.frames[i % upper.src.frames.length];
              copyFrame(upper, uf, d, i, def.row + di, { y0: 0, y1: info.cutEat, dy: info.eatDy }, [], name);
              const [lx0, lx1] = info.legSpan.sit?.[d]?.[lf] ?? [0, W];
              copyFrame(lower, lf, d, i, def.row + di, { y0: info.cutEat, y1: H, x0: lx0, x1: lx1 }, [], name);
            } else {
              const bob = def.headBob?.[i] ?? 0;
              copyFrame(lower, lf, d, i, def.row + di, { y0: 0, y1: H, group: 'head', groupDy: bob }, [], name);
            }
          }
        });
        break;
      }
      case 'carry': {
        const lower = chooseSource(pack, uses, bt, def.src, name, b.fallbacks);
        const info = pack.bodyTypes[lower.bt] ?? bodyInfo;
        const cu = info.carryUpper;
        const upper = chooseSource(pack, uses, lower.bt, [{ anim: cu.anim, frames: [cu.frame] }], `${name}(arms)`, b.fallbacks);
        def.dirs.forEach((d, di) => {
          for (let i = 0; i < def.frames; i++) {
            const lf = lower.src.frames[i % lower.src.frames.length];
            const bob = info.walkBob[d]?.[lf] ?? 0;
            copyFrame(upper, cu.frame, d, i, def.row + di, { y0: 0, y1: info.cutCarry + bob, dy: bob }, [], name);
            const [lx0, lx1] = info.legSpan.walk?.[d]?.[lf] ?? [0, W];
            copyFrame(lower, lf, d, i, def.row + di, { y0: info.cutCarry + bob, y1: H, x0: lx0, x1: lx1 }, [], name);
          }
        });
        break;
      }
    }
  }

  // credits for every file actually used
  const credits: Plan['credits'] = [];
  const seen = new Set<number>();
  for (const u of [...allUses, ...sleepFaceUses(pack, res.layers, allUses.length, bt)]) {
    for (const ci of u.def.credits) {
      if (seen.has(ci)) continue;
      const c = pack.credits[ci];
      if (!c) continue;
      const matches = [...b.usedFiles].some((f) => f.startsWith(c.file));
      if (!matches && u.def.credits.length > 1) continue;
      seen.add(ci);
      credits.push({ file: c.file, authors: c.authors, licenses: c.licenses });
    }
  }

  return {
    width: pack.cols * W,
    height: pack.rows * H,
    bodyType: bt,
    layers: res.layers.map(({ slot, id, colors }) => ({ slot, id, colors })),
    sources: b.sources,
    ops: b.ops,
    fallbacks: [...b.fallbacks],
    credits,
    anims,
    sleepCropY,
  };
}

/** 표정 레이어 (머리 가족별 face_<표정>@<가족>). 아이 머리는 표정 레이어가 없어 빈 목록 */
function faceUses(pack: LpcPack, layers: Resolved[], orderBase: number, bt: BodyType, base: string): PartUse[] {
  const head = layers.find((l) => l.slot === 'head');
  if (!head || bt === 'child') return [];
  const hd = pack.layers[head.id];
  const def = hd.face ? pack.layers[`${base}@${hd.face}`] : undefined;
  if (!def) return [];
  const layer: Resolved = { slot: 'face', id: `${base}@${hd.face}`, colors: [head.colors[0]], group: 'head', optional: true };
  return def.parts.map((part, i) => ({ layer, def, part, order: orderBase + i }));
}

/** Closed-eyes expression layer for the sleep crop (per head family). */
function sleepFaceUses(pack: LpcPack, layers: Resolved[], orderBase: number, bt: BodyType): PartUse[] {
  const head = layers.find((l) => l.slot === 'head');
  if (!head) return [];
  const hd = pack.layers[head.id];
  const id = bt === 'child' ? 'child_face_closed' : hd.face ? `face_closed@${hd.face}` : '';
  const def = id ? pack.layers[id] : undefined;
  if (!def) return [];
  const layer: Resolved = { slot: 'face', id, colors: [head.colors[0]], group: 'head', optional: true };
  return def.parts.map((part, i) => ({ layer, def, part, order: orderBase + i }));
}

// ------------------------------------------------------------------ random spec

export interface RandomOpts {
  sex?: CharacterSpec['sex'];
  stage?: CharacterSpec['stage'];
  estate?: CharacterSpec['estate'];
}

const ESTATES: CharacterSpec['estate'][] = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
const STAGES: Stage[] = ['child', 'teen', 'adult', 'elder'];

function pickR<T>(rng: () => number, list: T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

/** Random spec using only the passed rng (seeded by the caller). */
export function randomSpecWith(outfits: OutfitsData, rng: () => number, opts: RandomOpts = {}): CharacterSpec {
  const sex = opts.sex ?? (rng() < 0.5 ? 'male' : 'female');
  const stage = opts.stage ?? pickR(rng, STAGES);
  const estate = opts.estate ?? pickR(rng, ESTATES);
  const skin = pickR(rng, outfits.skins);
  const style = pickR(rng, outfits.hair.styles[sex][stage]);
  const color = stage === 'elder' && rng() < 0.8 ? pickR(rng, outfits.hair.elderColors) : pickR(rng, outfits.hair.colors);
  const dyes = outfits.dyes[estate];
  const layers: Record<string, string> = {
    $seed: String(Math.floor(rng() * 0x7fffffff)),
    $main: pickR(rng, dyes.main),
    $accent: pickR(rng, dyes.accent),
    $trim: pickR(rng, dyes.trim),
    $eyes: pickR(rng, outfits.eyes),
  };
  return { sex, stage, pregnant: 0, skin, hair: { style, color }, estate, outfit: 'everyday', layers };
}
