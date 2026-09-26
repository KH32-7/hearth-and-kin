/**
 * Pixel-edit script: synthesises child clothing and a closed-eyes child face from the LPC child base.
 *
 * Why: the LPC generator's child clothes (shirt/pants/skirt) exist for the walk animation only, so a
 * child would be naked in idle/sit/slash/hurt. We derive garments from the child body itself:
 * every body pixel inside a garment region is re-shaded from the skin ramp to the same index of the
 * LPC cloth "white" ramp, so the result keeps LPC shading/outlines and recolours with the cloth
 * palettes like any generator layer. Regions are rows relative to the body's shoulder/feet line;
 * hands (pixels outside the leg column span in the lower rows) stay skin.
 *
 * Outputs (CC-BY-SA 3.0 derivative of "body/bodies/child", see assets/SHARE_ALIKE.md):
 *   assets/generated/lpc/child/<garment>/<anim>.png   garments: tunic, tunic_long, dress, dress_long, hose, shoes
 *   assets/generated/lpc/child/face_closed/<anim>.png closed eyes overlay (skin palette)
 *   assets/generated/lpc/layers.json                  layer definitions merged by build-pack.ts
 *
 * Usage: npx tsx tools/lpc/gen-child-garments.ts && npx tsx tools/lpc/build-pack.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readPng, writePng, newImg, type Img } from './png';
import { SPRITE_ROOT, resolveColor, readDef } from './generator';
import type { CreditInfo, LayerDef } from '../../src/render/lpc/types';

const OUT = 'assets/generated/lpc/';
const ANIMS = ['idle', 'walk', 'sit', 'slash', 'hurt'];
const F = 64;

const SKIN = resolveColor('body', 'light'); // 6 colours dark -> light (index 0 = outline)
const CLOTH = resolveColor('cloth', 'white');
const hexToInt = (h: string) => parseInt(h.slice(1), 16);
const skinIdx = new Map(SKIN.map((c, i) => [hexToInt(c), i]));

function px(img: Img, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  if (img.data[i + 3] === 0) return -1;
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
}
function put(img: Img, x: number, y: number, hex: string) {
  const i = (y * img.width + x) * 4;
  const v = hexToInt(hex);
  img.data[i] = (v >> 16) & 255;
  img.data[i + 1] = (v >> 8) & 255;
  img.data[i + 2] = v & 255;
  img.data[i + 3] = 255;
}

interface FrameInfo { top: number; bottom: number; legX0: number; legX1: number }
function frameInfo(img: Img, fx: number, fy: number): FrameInfo {
  let top = F, bottom = -1;
  for (let y = 0; y < F; y++)
    for (let x = 0; x < F; x++)
      if (px(img, fx + x, fy + y) >= 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  let legX0 = F, legX1 = -1;
  for (let y = Math.max(0, bottom - 5); y <= bottom; y++)
    for (let x = 0; x < F; x++)
      if (px(img, fx + x, fy + y) >= 0) { legX0 = Math.min(legX0, x); legX1 = Math.max(legX1, x); }
  return { top, bottom, legX0: legX0 - 1, legX1: legX1 + 1 };
}

/** garment regions: [firstRow, lastRow] relative to top/bottom, and whether hands outside the leg span are kept skin */
type Region = (fi: FrameInfo) => { y0: number; y1: number; handRow: number };
const GARMENTS: Record<string, { region: Region; z: number; name: string; type: string }> = {
  tunic: { name: 'Child tunic', type: 'clothes', z: 35, region: (f) => ({ y0: f.top, y1: Math.min(f.top + 13, f.bottom - 3), handRow: f.top + 8 }) },
  tunic_long: { name: 'Child long tunic', type: 'clothes', z: 35, region: (f) => ({ y0: f.top, y1: Math.min(f.top + 15, f.bottom - 3), handRow: f.top + 9 }) },
  dress: { name: 'Child dress', type: 'clothes', z: 35, region: (f) => ({ y0: f.top, y1: f.bottom - 4, handRow: f.top + 8 }) },
  dress_long: { name: 'Child long dress', type: 'clothes', z: 35, region: (f) => ({ y0: f.top, y1: f.bottom - 2, handRow: f.top + 9 }) },
  hose: { name: 'Child hose', type: 'legs', z: 20, region: (f) => ({ y0: f.top + 9, y1: f.bottom - 2, handRow: f.top + 9 }) },
  shoes: { name: 'Child shoes', type: 'shoes', z: 15, region: (f) => ({ y0: f.bottom - 1, y1: f.bottom, handRow: f.bottom - 1 }) },
};

function makeGarment(body: Img, region: Region, withHem: boolean, anim: string): Img {
  const out = newImg(body.width, body.height);
  for (let fy = 0; fy < body.height; fy += F)
    for (let fx = 0; fx < body.width; fx += F) {
      const fi = frameInfo(body, fx, fy);
      if (fi.bottom < 0) continue;
      const { y0, y1, handRow } = region(fi);
      // hurt frame 5 lies on its back with the head at the bottom: mirror the region vertically
      const flip = anim === 'hurt' && fx / F === 5;
      // seated poses: thighs leave the feet column span, so the hand rule would uncover them
      const handRule = anim !== 'sit' && !flip;
      for (let yy = y0; yy <= y1; yy++)
        for (let x = 0; x < F; x++) {
          const y = flip ? fi.top + fi.bottom - yy : yy;
          const c = px(body, fx + x, fy + y);
          if (c < 0) continue;
          const si = skinIdx.get(c);
          if (si === undefined) continue;
          // hands: lower rows outside the legs' column span stay skin
          if (handRule && yy >= handRow && (x < fi.legX0 || x > fi.legX1)) continue;
          let ci = si;
          // hem: last garment row drawn one shade darker so the edge reads against skin
          if (withHem && yy === y1 && ci > 1) ci = Math.max(1, ci - 2);
          put(out, fx + x, fy + y, CLOTH[ci]);
        }
    }
  return out;
}

/** Closed eyes: interior non-skin (eye) pixels -> skin, bottom eye row -> dark lid line. */
function makeClosedFace(head: Img): Img {
  const out = newImg(head.width, head.height);
  for (let fy = 0; fy < head.height; fy += F)
    for (let fx = 0; fx < head.width; fx += F) {
      // eye pixels: non-skin colours, or outline colour with opaque pixels 2px left and right (inside the face)
      const eye: Array<[number, number]> = [];
      for (let y = 0; y < F; y++)
        for (let x = 2; x < F - 2; x++) {
          const c = px(head, fx + x, fy + y);
          if (c < 0) continue;
          const si = skinIdx.get(c);
          const interior = px(head, fx + x - 2, fy + y) >= 0 && px(head, fx + x + 2, fy + y) >= 0
            && px(head, fx + x, fy + y - 3) >= 0 && px(head, fx + x, fy + y + 2) >= 0;
          if ((si === undefined || si === 0) && interior) eye.push([x, y]);
        }
      if (!eye.length) continue;
      const ys = eye.map((e) => e[1]);
      const yMax = Math.max(...ys);
      const yMin = Math.min(...ys);
      for (const [x, y] of eye) {
        const lid = y === yMax - (yMax - yMin >= 2 ? 1 : 0);
        put(out, fx + x, fy + y, lid ? SKIN[1] : SKIN[4]);
      }
    }
  return out;
}

function childCredit(): CreditInfo {
  const body = readDef('body').credits.find((c: CreditInfo) => c.file === 'body/bodies/child');
  return {
    file: 'child/',
    authors: [...body.authors, 'Hearth & Kin (pixel-edit script tools/lpc/gen-child-garments.ts)'],
    licenses: ['CC-BY-SA 3.0'],
    urls: body.urls,
  };
}

function main() {
  const layers: Record<string, LayerDef & { creditEntries: CreditInfo[] }> = {};
  const credit = childCredit();
  for (const [g, def] of Object.entries(GARMENTS)) {
    const anims: string[] = [];
    for (const a of ANIMS) {
      const body = readPng(`${SPRITE_ROOT}body/bodies/child/${a}.png`);
      writePng(`${OUT}child/${g}/${a}.png`, makeGarment(body, def.region, g !== 'shoes', a));
      anims.push(a);
    }
    layers[`child_${g}`] = {
      name: def.name, type: def.type, generated: true, credits: [], creditEntries: [credit],
      parts: [{ z: def.z, paths: { child: `child/${g}/` }, anims: { child: anims } }],
      recolor: [{ material: 'cloth', source: CLOTH }],
    };
  }
  // closed eyes for the child head (sleep)
  const faceAnims: string[] = [];
  for (const a of ['idle', 'walk']) {
    const head = readPng(`${SPRITE_ROOT}head/heads/human/child/${a}.png`);
    writePng(`${OUT}child/face_closed/${a}.png`, makeClosedFace(head));
    faceAnims.push(a);
  }
  const headCredit = readDef('heads_human_child').credits[0] as CreditInfo;
  layers.child_face_closed = {
    name: 'Child closed eyes', type: 'expression', generated: true, credits: [],
    creditEntries: [{ file: 'child/face_closed', authors: [...headCredit.authors, 'Hearth & Kin (pixel-edit script tools/lpc/gen-child-garments.ts)'], licenses: ['CC-BY 3.0', 'OGA-BY 3.0'], urls: headCredit.urls }],
    parts: [{ z: 101, paths: { child: 'child/face_closed/' }, anims: { child: faceAnims } }],
    recolor: [{ material: 'body', source: SKIN }],
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}layers.json`, JSON.stringify({ _comment: 'Generated by tools/lpc/gen-child-garments.ts; merged into src/data/artpacks/lpc.json by build-pack.ts', layers }, null, 1) + '\n');
  console.log(`wrote ${Object.keys(layers).length} generated layers to ${OUT}`);
}

main();
