// Sanity checks for a lot: overlaps, slots reachable (not blocked), windows have a free inside cell, all ids known.
// npx tsx tools/world/check-lot.ts [lotId=cottage]
import fs from 'node:fs';

const lotId = process.argv[2] ?? 'cottage';
const lot = JSON.parse(fs.readFileSync(`src/data/lots/${lotId}.json`, 'utf8'));
const defs = JSON.parse(fs.readFileSync('src/data/objects.json', 'utf8'));
const art = JSON.parse(fs.readFileSync('src/data/artpacks/epic.json', 'utf8'));
const W = lot.w, H = lot.h;
const errs: string[] = [];
for (const k of ['ground', 'floor', 'walls']) if (lot[k].length !== W * H) errs.push(`${k} length ${lot[k].length} != ${W * H}`);
lot.ground.forEach((t: string) => { if (!art.tiles[t]) errs.push('unknown ground tile ' + t); });
lot.floor.forEach((t: string | null) => { if (t && !art.tiles[t]) errs.push('unknown floor tile ' + t); });
lot.walls.forEach((t: string | null) => { if (t && !art.walls[t]) errs.push('unknown wall style ' + t); });
const wall = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || lot.walls[y * W + x] != null;
const blocked = new Map<number, string>();
const rotF = (f: string, r: number) => { const o = ['down', 'left', 'up', 'right']; return o[(o.indexOf(f) + r) % 4]; };
for (const o of lot.objects) {
  const d = defs[o.id];
  if (!d) { errs.push('unknown object ' + o.id); continue; }
  if (!art.objects[o.id]) errs.push('no art for ' + o.id);
  for (let j = 0; j < d.footprint.h; j++) for (let i = 0; i < d.footprint.w; i++) {
    const x = o.x + i, y = o.y + j, k = y * W + x;
    if (d.wallMounted) { if (!wall(x, y)) errs.push(`${o.id}@${o.x},${o.y} wall-mounted but (${x},${y}) is not a wall`); continue; }
    if (wall(x, y) && !lot.openings.some((p: { x: number; y: number }) => p.x === x && p.y === y)) errs.push(`${o.id}@${o.x},${o.y} overlaps wall at ${x},${y}`);
    if (!d.blocks) continue;
    if (blocked.has(k)) errs.push(`${o.id}@${o.x},${o.y} overlaps ${blocked.get(k)} at ${x},${y}`);
    blocked.set(k, `${o.id}@${o.x},${o.y}`);
  }
}
for (const o of lot.objects) {
  const d = defs[o.id]; if (!d) continue;
  for (const s of d.slots) {
    const x = o.x + s.dx, y = o.y + s.dy, k = y * W + x;
    const inside = s.dx >= 0 && s.dy >= 0 && s.dx < d.footprint.w && s.dy < d.footprint.h;
    const bad = wall(x, y) || (!inside && blocked.has(k));
    const note = `${o.id}@${o.x},${o.y} slot ${s.id} (${x},${y}) facing ${rotF(s.facing, o.rot ?? 0)}`;
    if (bad) (s.id.endsWith('_l') || s.id === 'front2' ? console.log('  (alt slot unusable) ' + note) : errs.push('blocked ' + note));
  }
}
for (const p of lot.openings) if (p.kind === 'window') {
  const cand = [[p.x, p.y - 1], [p.x, p.y + 1], [p.x - 1, p.y], [p.x + 1, p.y]].filter(([x, y]) => !wall(x, y) && lot.floor[y * W + x]);
  if (!cand.some(([x, y]) => !blocked.has(y * W + x))) errs.push(`window ${p.x},${p.y} has no free inside cell`);
}
const counts: Record<string, number> = {};
for (const o of lot.objects) counts[o.id] = (counts[o.id] ?? 0) + 1;
const missing = Object.keys(defs).filter((k) => !counts[k]);
if (missing.length) errs.push('object types not placed: ' + missing.join(', '));
console.log(errs.length ? errs.join('\n') : `OK: ${lot.objects.length} objects, ${Object.keys(counts).length} types, chairs=${counts.chair}`);
process.exit(errs.length ? 1 : 0);
