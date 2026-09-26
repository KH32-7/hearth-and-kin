// 이미지 일부를 잘라 확대: node tools/qa/crop.mjs in.png out.png x y w h scale
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inp, out, x, y, w, h, sc] = process.argv.slice(2);
const b64 = readFileSync(inp).toString('base64');
const browser = await chromium.launch({ channel: 'msedge' });
const S = Number(sc ?? 2);
const page = await browser.newPage({ viewport: { width: Number(w) * S, height: Number(h) * S } });
await page.setContent(`<body style="margin:0;overflow:hidden"><div style="width:${w * S}px;height:${h * S}px;overflow:hidden;position:relative"><img src="data:image/png;base64,${b64}" style="position:absolute;left:${-x * S}px;top:${-y * S}px;image-rendering:pixelated;transform-origin:0 0;transform:scale(${S})"></div></body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: out });
await browser.close();
