/**
 * Audit: plan every estate x sex x stage x outfit (several seeds) and summarise fallbacks,
 * skipped layers and layer counts. Usage: npx tsx tools/lpc/audit.ts
 */
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import type { Estate, OutfitKind, Sex, Stage } from '../../src/render/lpc/types';
import { loadData, mulberry32 } from './compose-node';

const { pack, outfits } = loadData();
const ESTATES: Estate[] = ['serf', 'freeman', 'artisan', 'merchant', 'clergy', 'knight', 'noble'];
const SEXES: Sex[] = ['male', 'female'];
const STAGES: Stage[] = ['child', 'teen', 'adult', 'elder'];
const OUTFITS: OutfitKind[] = ['everyday', 'work', 'formal', 'sleep', 'winter', 'bath'];

const notes = new Map<string, number>();
const layerCount: Record<string, { min: number; max: number; ids: Set<string> }> = {};
const rng = mulberry32(99);
let n = 0;
for (const e of ESTATES) {
  layerCount[e] = { min: 99, max: 0, ids: new Set() };
  for (const sex of SEXES)
    for (const stage of STAGES)
      for (const outfit of OUTFITS)
        for (const preg of stage === 'adult' && sex === 'female' ? [0, 2] : [0])
          for (let k = 0; k < 4; k++) {
            const spec = { ...randomSpecWith(outfits, rng, { estate: e, sex, stage }), outfit, pregnant: preg as 0 | 2 };
            const plan = planCharacter(spec, pack, outfits);
            n++;
            if (outfit === 'everyday') {
              layerCount[e].min = Math.min(layerCount[e].min, plan.layers.length);
              layerCount[e].max = Math.max(layerCount[e].max, plan.layers.length);
            }
            for (const l of plan.layers) layerCount[e].ids.add(l.id);
            for (const f of plan.fallbacks) {
              const key = `[${preg ? 'pregnant' : stage}] ${f.replace(/\d{3,}/g, '#')}`;
              notes.set(key, (notes.get(key) ?? 0) + 1);
            }
          }
}
console.log(`${n} plans`);
console.log('\nlayers per character (everyday) / distinct layer ids used per estate:');
for (const [e, c] of Object.entries(layerCount)) console.log(`  ${e.padEnd(9)} ${c.min}-${c.max} layers, ${c.ids.size} distinct`);
console.log('\nfallback notes (count):');
for (const [k, v] of [...notes].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);
