/**
 * Node-side access to the LPC generator repo (sheet_definitions, palette_definitions, spritesheets).
 * Used by build-pack.ts and credits.ts. Never imported by browser code.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BodyType, LayerDef, LayerPart, Material, PaletteSet, RecolorChannel, CreditInfo } from '../../src/render/lpc/types';

export const GEN_ROOT = 'assets/vendor/lpc/lpc-generator/';
export const SPRITE_ROOT = GEN_ROOT + 'spritesheets/';
export const BODY_TYPES: BodyType[] = ['male', 'female', 'teen', 'child', 'pregnant', 'muscular'];
/** generator animation names we read (file/folder names). */
export const SRC_ANIMS = ['idle', 'walk', 'sit', 'emote', 'slash', 'thrust', 'shoot', 'spellcast', 'hurt'];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.json') && !f.startsWith('meta_')) out.push(p);
  }
  return out;
}

let defIndex: Map<string, string> | null = null;
/** def id (file basename without .json) -> file path */
export function defFiles(): Map<string, string> {
  if (defIndex) return defIndex;
  defIndex = new Map();
  for (const f of walk(GEN_ROOT + 'sheet_definitions')) {
    const id = f.split(/[\\/]/).pop()!.replace(/\.json$/, '');
    defIndex.set(id, f);
  }
  return defIndex;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readDef(id: string): any {
  const f = defFiles().get(id);
  if (!f) throw new Error(`unknown LPC sheet definition: ${id}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

// ---------------------------------------------------------------- palettes

interface MaterialMeta { default: string; base: string }
const MATERIAL_DIRS: Record<Material, string> = { body: 'body', hair: 'hair', cloth: 'cloth', metal: 'metal', eye: 'eye' };

export function materialMeta(m: Material): MaterialMeta {
  return JSON.parse(readFileSync(`${GEN_ROOT}palette_definitions/${MATERIAL_DIRS[m]}/meta_${MATERIAL_DIRS[m]}.json`, 'utf8'));
}

export function paletteVersion(m: Material, version: string): Record<string, string[]> {
  const f = `${GEN_ROOT}palette_definitions/${MATERIAL_DIRS[m]}/${MATERIAL_DIRS[m]}_${version}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  // "all" palettes live elsewhere
  const all = `${GEN_ROOT}palette_definitions/all/all_${version}.json`;
  if (existsSync(all)) return JSON.parse(readFileSync(all, 'utf8'));
  throw new Error(`palette ${m}.${version} not found`);
}

/** Resolve a colour key like "light", "lpcr.ivory", "ulpc.brown" to a colour ramp for a material. */
export function resolveColor(m: Material, key: string): string[] {
  const meta = materialMeta(m);
  const parts = key.split('.');
  const [version, name] = parts.length > 1 ? [parts[0], parts[1]] : [meta.default, parts[0]];
  const ramp = paletteVersion(m, version)[name];
  if (!ramp) throw new Error(`colour ${m}.${key} not found`);
  return ramp.map((c) => c.toLowerCase());
}

export function buildPalette(m: Material, keys: string[]): PaletteSet {
  const meta = materialMeta(m);
  const colors: Record<string, string[]> = {};
  for (const k of keys) colors[k.replace(/^ulpc\./, '').replace(/^lpcr\./, '')] = resolveColor(m, k);
  return { source: resolveColor(m, meta.base), colors };
}

// ---------------------------------------------------------------- layers

function listPngNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, ''));
}

/**
 * Inspect a generator definition and produce our LayerDef (paths per body type, verified animation files).
 * `faceKey` expands `${head}` placeholders (expressions).
 */
export function inspectLayer(id: string, credits: CreditInfo[], faceKey?: string): LayerDef {
  const d = readDef(id);
  const isRecolor = !!d.recolors;
  const variants: string[] | undefined = d.variants;
  const parts: LayerPart[] = [];
  for (let i = 1; i < 10; i++) {
    const l = d[`layer_${i}`];
    if (!l) continue;
    if (l.custom_animation) continue; // oversize weapon frames: not used
    const part: LayerPart = { z: l.zPos ?? 100, paths: {}, anims: {} };
    for (const bt of BODY_TYPES) {
      let p: string | undefined = l[bt];
      if (!p) continue;
      if (p.includes('${')) {
        if (!faceKey) continue;
        p = p.replace(/\$\{head\}/g, faceKey);
      }
      const anims: string[] = [];
      let variantStyle = false;
      for (const a of SRC_ANIMS) {
        if (isRecolor && existsSync(`${SPRITE_ROOT}${p}${a}.png`)) {
          anims.push(a);
        } else if (listPngNames(`${SPRITE_ROOT}${p}${a}`).length) {
          // pre-coloured files (legacy layout, even for some recolor items)
          anims.push(a);
          if (isRecolor) variantStyle = true;
        }
      }
      if (!anims.length) continue;
      part.paths[bt] = p;
      part.anims[bt] = anims;
      if (variantStyle) (part.variantDirs ??= []).push(bt);
    }
    if (Object.keys(part.paths).length) parts.push(part);
  }

  let recolor: RecolorChannel[] | undefined;
  if (isRecolor) {
    const r = d.recolors;
    const chans = r.material ? [r] : Object.keys(r).sort().map((k) => r[k]);
    recolor = chans.map((c: { material: Material; base?: string; source?: string[] }) => {
      let source: string[];
      if (c.source) source = c.source.map((x) => x.toLowerCase());
      else if (c.base) source = resolveColor(c.material, c.base);
      else source = resolveColor(c.material, materialMeta(c.material).base);
      return { material: c.material, source };
    });
  }

  // credits: keep entries of this definition; dedupe globally by file
  const creditIdx: number[] = [];
  for (const c of d.credits ?? []) {
    let idx = credits.findIndex((x) => x.file === c.file);
    if (idx < 0) {
      credits.push({ file: c.file, authors: c.authors ?? [], licenses: c.licenses ?? [], urls: c.urls ?? [] });
      idx = credits.length - 1;
    }
    creditIdx.push(idx);
  }

  const def: LayerDef = { name: d.name, type: d.type_name, parts, credits: creditIdx };
  if (recolor) def.recolor = recolor;
  if (!isRecolor && variants) def.variants = variants.map((v: string) => v.replaceAll(' ', '_'));
  return def;
}

/** Map a head definition's name ("Human Male Elderly") to its expression folder key via face_closed's replace_in_path. */
export function faceKeyForHead(headId: string): string | undefined {
  const face = readDef('face_closed');
  const name = readDef(headId).name.replace(/ /g, '_');
  return face.replace_in_path?.head?.[name];
}
