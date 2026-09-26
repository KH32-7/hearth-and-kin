/**
 * Verifies that the browser compositor (src/render/lpc/compose.ts, Canvas APIs) produces the same
 * pixels as the Node tool (compose-node.ts) for a few specs.
 * Starts its own Vite dev server on a spare port and drives headless Chromium via Playwright.
 *
 * Usage: npx tsx tools/lpc/verify-browser.ts
 */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
import { planCharacter, randomSpecWith } from '../../src/render/lpc/plan';
import { loadData, mulberry32, renderPlan } from './compose-node';
import type { CharacterSpec } from '../../src/render/lpc/types';

async function main() {
  const { pack, outfits } = loadData();
  const rng = mulberry32(5);
  const specs: CharacterSpec[] = [
    randomSpecWith(outfits, rng, { estate: 'noble', sex: 'female', stage: 'adult' }),
    { ...randomSpecWith(outfits, rng, { estate: 'knight', sex: 'male', stage: 'adult' }), outfit: 'work' },
    randomSpecWith(outfits, rng, { estate: 'serf', sex: 'male', stage: 'child' }),
    { ...randomSpecWith(outfits, rng, { estate: 'freeman', sex: 'female', stage: 'adult' }), pregnant: 2 },
  ];
  const nodeHashes = specs.map((s) => {
    const img = renderPlan(planCharacter(s, pack, outfits));
    return createHash('sha1').update(img.data).digest('hex');
  });

  const server = await createServer({ optimizeDeps: { entries: ['index.html'] }, server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  console.log('vite up');
  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5199/';
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch({ channel: 'chrome' }));
  console.log('browser up');
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log('[page]', m.text()));
    await page.goto(url + 'assets/README.md');
    page.setDefaultTimeout(60000);
    console.log('page loaded', url);
    // plain string so the tsx transform cannot inject helpers into the page code
    const pageCode = `async (list) => {
      const mod = await import('/src/render/lpc/compose.ts');
      const cache = new Map();
      const load = (p) => {
        let pr = cache.get(p);
        if (!pr) {
          pr = fetch('/' + p).then((r) => { if (!r.ok) throw new Error('404 ' + p); return r.blob(); }).then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
          cache.set(p, pr);
        }
        return pr;
      };
      const out = [];
      for (const spec of list) {
        const sheet = await mod.composeCharacter(spec, load);
        const c = sheet.image;
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const digest = await crypto.subtle.digest('SHA-1', data);
        const png = await c.convertToBlob({ type: 'image/png' });
        const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(png); });
        out.push({ png: b64, hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''), fallbacks: sheet.fallbacks.length, w: c.width, h: c.height });
      }
      return out;
    }`;
    const browserHashes: Array<{ hash: string; fallbacks: number; w: number; h: number; png: string }> = await page.evaluate(`(${pageCode})(${JSON.stringify(specs)})`);
    let ok = true;
    browserHashes.forEach((b, i) => {
      const same = b.hash === nodeHashes[i];
      ok &&= same;
      if (!same) {
        const node = renderPlan(planCharacter(specs[i], pack, outfits));
        const br = PNG.sync.read(Buffer.from(b.png, 'base64'));
        let n = 0, semi = 0, maxd = 0;
        const where = new Map<number, number>();
        for (let k = 0; k < node.data.length; k += 4) {
          let d = 0;
          for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(node.data[k + c] - br.data[k + c]));
          if (d > 0) {
            n++;
            maxd = Math.max(maxd, d);
            if (node.data[k + 3] > 0 && node.data[k + 3] < 255) semi++;
            const row = Math.floor(k / 4 / node.width / 64);
            where.set(row, (where.get(row) ?? 0) + 1);
          }
        }
        // attribute differing pixels to the last op that drew an opaque pixel there
        const plan = planCharacter(specs[i], pack, outfits);
        const bySrc = new Map<string, number>();
        const srcImgs = plan.sources.map((ss) => PNG.sync.read(readFileSync(ss.path)));
        for (let k = 0; k < node.data.length; k += 4) {
          if (node.data[k] === br.data[k] && node.data[k + 1] === br.data[k + 1] && node.data[k + 2] === br.data[k + 2]) continue;
          const x = (k / 4) % node.width, y = Math.floor(k / 4 / node.width);
          for (let o = plan.ops.length - 1; o >= 0; o--) {
            const op = plan.ops[o];
            if (x < op.dx || y < op.dy || x >= op.dx + op.w || y >= op.dy + op.h) continue;
            const si = srcImgs[op.s];
            if (si.data[((op.sy + y - op.dy) * si.width + op.sx + x - op.dx) * 4 + 3] === 0) continue;
            const key = plan.sources[op.s].path.replace(/.*spritesheets\//, '') + (plan.sources[op.s].recolor ? ' (recolor)' : '');
            bySrc.set(key, (bySrc.get(key) ?? 0) + 1);
            break;
          }
        }
        console.log('  by source: ' + [...bySrc].slice(0, 6).map(([k, v]) => k + '=' + v).join(', '));
        console.log(`  ${n} px differ (max channel delta ${maxd}), ${semi} of them semi-transparent; by sheet row: ${[...where].map(([r, c]) => r + ':' + c).join(' ')}`);
      }
      console.log(`${same ? 'SAME' : 'DIFF'} spec ${i}: node ${nodeHashes[i].slice(0, 10)} browser ${b.hash.slice(0, 10)} (${b.w}x${b.h}, ${b.fallbacks} fallback notes)`);
    });
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

main();
