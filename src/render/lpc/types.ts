/**
 * Types shared by the LPC planner (pure), the browser compositor and the Node tools.
 * No DOM / Node imports here.
 */

export type Facing = 'up' | 'left' | 'down' | 'right';
export type AnimName =
  | 'idle' | 'walk' | 'sit' | 'emote' | 'slash' | 'thrust' | 'shoot' | 'spellcast' | 'hurt'
  | 'sleep' | 'eat' | 'carry' | 'work';
export type Sex = 'male' | 'female';
export type Stage = 'child' | 'teen' | 'adult' | 'elder';
export type Estate = 'serf' | 'freeman' | 'artisan' | 'merchant' | 'clergy' | 'knight' | 'noble';
export type OutfitKind = 'everyday' | 'work' | 'formal' | 'sleep' | 'winter' | 'bath';
/** LPC generator body types we use. */
export type BodyType = 'male' | 'female' | 'teen' | 'child' | 'pregnant' | 'muscular';
/** Palette materials (generator palette_definitions). */
export type Material = 'body' | 'hair' | 'cloth' | 'metal' | 'eye';

export interface CharacterSpec {
  sex: Sex;
  stage: Stage;
  pregnant?: 0 | 1 | 2;
  skin: string;
  hair: { style: string; color: string };
  estate: Estate;
  outfit: OutfitKind;
  /**
   * Optional overrides. Keys:
   *  - `<slot>`: `"<layerId>"` or `"<layerId>:<color>"` (multi-channel: `"<layerId>:<c1>+<c2>"`); `"none"` removes the slot
   *  - `$seed`: integer string; picks among outfit options deterministically (stable look across outfit kinds)
   *  - `$expr`: 감정 표정 (happy, sad, angry, shame, blush, shock, eyeroll, tears, happy2, sad2, angry2) — 깨어 있는 동작 전부에 덧그림
   *  - `$main` / `$accent` / `$trim`: dye names (cloth palette) for the person's dye channels
   *  - `$eyes`: eye colour, `$beard`: beard layer id or "none", `$head`: head layer id
   */
  layers?: Record<string, string>;
}

export interface AnimInfo {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
  dirs: Facing[];
  /** named poses -> frame index (sit: ground / crossLegged / chair) */
  poses?: Record<string, number>;
}

export interface CreditInfo {
  file: string;
  authors: string[];
  licenses: string[];
  urls?: string[];
}

// ---------------------------------------------------------------- pack (src/data/artpacks/lpc.json)

export interface SrcAnimInfo {
  /** file/folder name in the generator (e.g. combat_idle) */
  file: string;
  frames: number;
  /** 4 = one row per direction (up,left,down,right); 1 = single row (hurt: faces down) */
  rows: number;
}

/** A source choice: generator animation + list of source frame indices (length = our frame count). */
export interface SrcRef {
  anim: string;
  frames: number[];
  /** fixed source direction row (e.g. hurt) */
  row?: number;
}

export interface AnimDef extends AnimInfo {
  /**
   * direct: copy src frames (first alternative whose anim all required layers have)
   * sleep:  head+shoulders crop of `src` (down only) + closed-eye face layer
   * eat:    down = upper(eatUpper)+lower(src) split at bodyType.cutEat; other dirs = src with head bob
   * carry:  upper(carryUpper) + lower(src walk) split at bodyType.cutCarry, upper follows walk bob
   * work:   like direct, but body type may override source (bodyType.workSrc)
   */
  recipe: 'direct' | 'sleep' | 'eat' | 'carry' | 'work';
  src: SrcRef[];
  /** named poses (sit): pose name -> frame index */
  poses?: Record<string, number>;
  /** head-group vertical bob per frame for recipe eat (dirs other than down) */
  headBob?: number[];
  note?: string;
}

export interface BodyTypeInfo {
  /** sleep crop: rows [0, sleepCropY) of the frame are kept */
  sleepCropY: number;
  /** eat (down): destination row where upper (arms) part ends and seated lower part starts */
  cutEat: number;
  /** eat (down): vertical offset applied to the upper source */
  eatDy: number;
  /** carry: destination row where upper (held arms) part ends and walking legs start */
  cutCarry: number;
  /** carry: per direction, per walk source frame (0..8), vertical bob of the torso relative to frame 0 */
  walkBob: Record<Facing, number[]>;
  /** x span [x0, x1) of the legs (measured on the lowest rows) per source anim ('walk' | 'sit'), direction and source frame */
  legSpan: Record<string, Record<Facing, Array<[number, number]>>>;
  eatUpper: SrcRef;
  carryUpper: { anim: string; frame: number };
  workSrc: SrcRef;
  /** generator animations whose base body file exists for this body type */
  anims: string[];
  /** body type to borrow clothing paths from when a layer lacks this body type */
  clothingFallback: BodyType[];
}

export interface PaletteSet {
  /** colours of the source image (in the generator's base variant), dark -> light */
  source: string[];
  /** target colour ramps by name */
  colors: Record<string, string[]>;
}

export interface LayerPart {
  z: number;
  /** repo-root-relative folder prefix per body type (ends with '/'), `${root}${path}${anim}.png` or `${root}${path}${anim}/${variant}.png` */
  paths: Partial<Record<BodyType, string>>;
  /** generator animations whose file exists, per body type */
  anims: Partial<Record<BodyType, string[]>>;
  /** body types whose files are pre-coloured (`<anim>/<colour>.png`) although the layer is recolorable */
  variantDirs?: BodyType[];
}

export interface RecolorChannel {
  material: Material;
  /** source colours (explicit or the material's base ramp) */
  source: string[];
  /** channel role used for colour resolution: skin | hair | eye | main | accent | trim | metal | fixed:<name> */
  role?: string;
}

export interface LayerDef {
  name: string;
  type: string;
  parts: LayerPart[];
  /** recolorable layer (single source image per anim) */
  recolor?: RecolorChannel[];
  /** pre-coloured variants (one file per variant) */
  variants?: string[];
  /** indices into pack.credits */
  credits: number[];
  /** for head layers: expression folder key (male/female/elderly) */
  face?: string;
  /** true for layers produced by our tools (assets/generated/lpc) */
  generated?: boolean;
}

export interface LpcPack {
  id: string;
  /** folder prefix of generator sprites and of our generated sprites (repo-root relative) */
  roots: { lpc: string; gen: string };
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  cols: number;
  rows: number;
  dirs: Facing[];
  sourceAnims: Record<string, SrcAnimInfo>;
  anims: Record<AnimName, AnimDef>;
  bodyTypes: Partial<Record<BodyType, BodyTypeInfo>>;
  palettes: Record<Material, PaletteSet>;
  layers: Record<string, LayerDef>;
  credits: CreditInfo[];
  /** 아기/유아 시트 (tools/lpc/gen-infant.ts) */
  infant?: InfantPack;
}

// ---------------------------------------------------------------- outfits (src/data/outfits.json)

/** One slot of a look: pick one of `pick` (layer ids); colour each channel by role. */
export interface LookSlot {
  slot: string;
  pick: string[];
  /** channel roles, one per recolor channel or one for variant layers: main|accent|trim|metal:<name>|fixed:<name> */
  dye?: string[];
  /** chance 0..1 that this slot is worn at all (default 1) */
  chance?: number;
  /** other slots removed while this one is worn (e.g. a hood hides `hair`) */
  hides?: string[];
  /** true: skipped in animations it lacks instead of changing the animation source for everyone (capes) */
  optional?: boolean;
}

export interface OutfitsData {
  skins: string[];
  eyes: string[];
  hair: {
    colors: string[];
    elderColors: string[];
    styles: Record<Sex, Record<Stage, string[]>>;
    beards: string[];
    beardChance: Record<Stage, number>;
  };
  heads: Record<Sex, Record<Stage, string[]>>;
  /** extra layers always added per stage (e.g. elder wrinkles) */
  stageExtras: Record<Stage, string[]>;
  /** allowed dyes per estate (sumptuary law, GDD 16-2), cumulative */
  dyes: Record<Estate, { main: string[]; accent: string[]; trim: string[] }>;
  metals: Record<Estate, string[]>;
  looks: Record<string, LookSlot[]>;
  /** estate -> sex -> stage -> outfit -> look id */
  estates: Record<Estate, Record<Sex, Record<Stage, Record<OutfitKind, string>>>>;
}

// ---------------------------------------------------------------- plan

export interface ResolvedLayer {
  slot: string;
  id: string;
  /** colour name per recolor channel, or the variant name */
  colors: string[];
}

export interface PlanSource {
  path: string;
  /** palette swaps applied to the whole source image before drawing */
  recolor?: { from: string[]; to: string[] };
}

/** One integer-aligned copy of a rect from a source image to the sheet (source-over). */
export interface DrawOp {
  s: number; // index into plan.sources
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

export interface Plan {
  width: number;
  height: number;
  bodyType: BodyType;
  layers: ResolvedLayer[];
  sources: PlanSource[];
  ops: DrawOp[];
  /** human readable notes about fallbacks / skipped layers */
  fallbacks: string[];
  credits: Array<{ file: string; authors: string[]; licenses: string[] }>;
  anims: Record<AnimName, AnimInfo>;
  /** rows [0, sleepCropY) of a sleep frame hold head + shoulders (actual crop used) */
  sleepCropY: number;
}

// ---------------------------------------------------------------- infant (lpc.json "infant", tools/lpc/gen-infant.ts)

/** One recolourable sheet of the infant layouts (every layer is a whole sheet in the same cell layout). */
export interface InfantLayer {
  id?: string;
  /** relative to pack.roots.gen */
  path: string;
  z: number;
  /** role: skin | eye | hair | main | accent */
  recolor?: Array<{ material: Material; source: string[]; role: string }>;
}

export interface InfantAnim {
  row: number;
  col: number;
  frames: number;
  fps: number;
  loop: boolean;
  dirs: Facing[];
}

export interface InfantPack {
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  baby: {
    cols: number;
    rows: number;
    layers: InfantLayer[];
    anims: Record<'cradle' | 'cradle_cry' | 'floor' | 'floor_cry' | 'held' | 'held_cry', InfantAnim>;
    place: {
      cradle: { lift: number };
      floor: { lift: number };
      held: { front: Record<Facing, boolean>; dy: Partial<Record<BodyType, number>>; seatedDy: number };
    };
  };
  toddler: {
    cols: number;
    rows: number;
    layers: InfantLayer[];
    garments: Record<string, InfantLayer>;
    estateGarment: Record<Estate, string>;
    hair: Record<string, InfantLayer>;
    anims: Record<'idle' | 'walk' | 'crawl' | 'sit' | 'fall' | 'sleep', InfantAnim>;
    sleepCropY: number;
    heads: Array<{ col: number; row: number; dir: Facing; dx: number; dy: number; masked: boolean }>;
  };
  credits: Array<{ file: string; authors: string[]; licenses: string[]; note?: string }>;
}
