/**
 * Dev helper: print which body types / animations exist for given generator definitions.
 * Usage: npx tsx tools/lpc/coverage.ts <defId...>
 */
import { inspectLayer, BODY_TYPES } from './generator';
import type { CreditInfo } from '../../src/render/lpc/types';

const short: Record<string, string> = { idle: 'I', walk: 'W', sit: 'S', emote: 'E', slash: 'L', thrust: 'T', shoot: 'O', spellcast: 'C', hurt: 'H' };
const credits: CreditInfo[] = [];
for (const id of process.argv.slice(2)) {
  try {
    const d = inspectLayer(id, credits, 'male');
    const lic = [...new Set(d.credits.flatMap((i) => credits[i].licenses))].join(',');
    const cols = BODY_TYPES.filter((b) => b !== 'muscular').map((bt) => {
      const a = d.parts.map((p) => (p.anims[bt] ?? []).map((x) => short[x]).join('')).join('/');
      return `${bt.slice(0, 2)}:${a || '-'}`.padEnd(15);
    });
    console.log(`${id.padEnd(36)} ${d.recolor ? 'R' + d.recolor.map((r) => r.material[0]).join('') : 'V' + (d.variants?.length ?? 0)} ${cols.join(' ')} ${lic}`);
  } catch (e) {
    console.log(`${id}: ${(e as Error).message}`);
  }
}
