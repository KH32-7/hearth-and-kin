/**
 * Dev helper: print a compact summary of every LPC generator sheet definition.
 * Usage: npx tsx tools/lpc/catalog-dump.ts [filterRegex]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'assets/vendor/lpc/lpc-generator/sheet_definitions';
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.json') && !f.startsWith('meta_')) out.push(p);
  }
  return out;
}

for (const file of walk(ROOT).sort()) {
  const rel = relative(ROOT, file).split(String.fromCharCode(92)).join('/');
  if (filter && !filter.test(rel)) continue;
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const layers: string[] = [];
  for (let i = 1; i < 10; i++) {
    const l = d[`layer_${i}`];
    if (!l) continue;
    const bts = Object.keys(l).filter((k) => !['zPos', 'custom_animation'].includes(k));
    const paths = new Set(bts.map((b) => l[b]));
    layers.push(`L${i}z${l.zPos}${l.custom_animation ? '(' + l.custom_animation + ')' : ''}[${bts.join(',')}]${paths.size === 1 ? '' : '*'}`);
  }
  const lic = new Set<string>();
  for (const c of d.credits ?? []) for (const x of c.licenses ?? []) lic.add(x);
  const rec = d.recolors
    ? 'R:' + (d.recolors.material ?? Object.values(d.recolors).map((r: any) => r?.material).filter(Boolean).join('+'))
    : '';
  const vars = d.variants ? `V${d.variants.length}` : '';
  const anims = (d.animations ?? []).filter((a: string) => !a.startsWith('1h_') && a !== 'watering' && a !== 'climb' && a !== 'jump').join(',');
  console.log(`${rel} | ${d.type_name} | ${layers.join(' ')} | ${vars}${rec} | ${anims} | ${[...lic].join(',')}`);
}
