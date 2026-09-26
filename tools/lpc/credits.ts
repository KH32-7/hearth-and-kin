/**
 * Writes assets/CREDITS.json entries for every LPC layer referenced by src/data/outfits.json
 * (via src/data/artpacks/lpc.json, which already holds the generator's per-folder credits),
 * including our derived child garments. Only entries whose id starts with "lpc:" are replaced;
 * everything else in CREDITS.json is kept.
 *
 * Usage: npx tsx tools/lpc/credits.ts [--print <layerId...>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { LpcPack } from '../../src/render/lpc/types';

const CREDITS = 'assets/CREDITS.json';
const pack: LpcPack = JSON.parse(readFileSync('src/data/artpacks/lpc.json', 'utf8'));

interface CreditEntry {
  id: string;
  pack: string;
  files: string;
  source: string;
  authors: string[];
  licenses: string[];
  attribution: string;
  modified: boolean;
  notes: string;
  usedBy: string[];
}

function entries(): CreditEntry[] {
  const byCredit = new Map<number, string[]>();
  for (const [id, l] of Object.entries(pack.layers)) for (const ci of l.credits) byCredit.set(ci, [...(byCredit.get(ci) ?? []), id]);
  const out: CreditEntry[] = [];
  pack.credits.forEach((c, i) => {
    const used = byCredit.get(i);
    if (!used) return;
    const generated = used.some((id) => pack.layers[id].generated);
    const root = generated ? pack.roots.gen : pack.roots.lpc;
    out.push({
      id: `lpc:${c.file}`,
      pack: generated ? 'hearth-and-kin (derived from LPC)' : 'Universal LPC Spritesheet Character Generator',
      files: `${root}${c.file}`,
      source: c.urls?.[0] ?? 'https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator',
      authors: c.authors,
      licenses: c.licenses,
      attribution: `"${c.file}" by ${c.authors.join(', ')}. License: ${c.licenses.join(' / ')}.${c.urls?.length ? ' ' + c.urls.join(' ') : ''}`,
      modified: generated,
      notes: generated
        ? 'pixel-edited by tools/lpc/gen-child-garments.ts; see assets/SHARE_ALIKE.md'
        : 'unmodified layer; palette-swapped at runtime (src/render/lpc/recolor.ts)',
      usedBy: used.sort(),
    });
  });
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--print') {
  const want = new Set(args.slice(1));
  for (const e of entries()) if (!want.size || e.usedBy.some((u) => want.has(u))) console.log(e.attribution);
} else {
  const existing: Array<{ id?: string }> = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : [];
  const kept = existing.filter((e) => !(typeof e.id === 'string' && e.id.startsWith('lpc:')));
  const mine = entries();
  writeFileSync(CREDITS, JSON.stringify([...kept, ...mine], null, 2) + '\n');
  console.log(`${CREDITS}: kept ${kept.length} entries, wrote ${mine.length} lpc: entries`);
}
