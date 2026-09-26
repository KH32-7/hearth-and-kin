/**
 * 부지 JSON → Tiled(.tmj) 내보내기. 게임은 .tmj 를 읽음 (src/sim/world/tiled.ts lotFromTiled).
 * 사용: npx tsx tools/lot-to-tiled.ts [cottage]
 * Tiled 에서 고친 뒤에는 .tmj 가 원본. check:data 가 둘이 같은지 검사함
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { lotToTiled } from '../src/sim/world/tiled';
import type { LotDef } from '../src/sim/core/types';

const id = process.argv[2] ?? 'cottage';
const lot = JSON.parse(readFileSync(`src/data/lots/${id}.json`, 'utf8')) as LotDef;
const pack = JSON.parse(readFileSync('src/data/artpacks/epic.json', 'utf8')) as { tilePx: number };
const map = lotToTiled(lot, pack.tilePx);
writeFileSync(`src/data/lots/${id}.tmj`, JSON.stringify(map));
console.log(`src/data/lots/${id}.tmj (${map.width}x${map.height}, 타일 ${map.tilesets[0].tilecount}종, 물건 ${lot.objects.length})`);
