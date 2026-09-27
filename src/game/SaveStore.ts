/**
 * 저장 파일 보관 (GDD 27-5, BRIEF 1장: 브라우저는 IndexedDB). 목록용 요약(meta)과 본문(body)을 따로 두어
 * 목록을 볼 때 큰 본문을 읽지 않음. 본문은 gzip (CompressionStream 이 없으면 그대로)
 *
 * 자동 저장: 게임 하루마다, 슬롯 3개 순환 (auto-0 ~ auto-2 중 가장 오래된 것에 덮어씀). 수동 저장: 제한 없음
 */
import type { SaveMeta } from '../sim/protocol';
import type { SimSave } from '../sim/save/save';

export interface SaveRecord {
  id: string;
  kind: 'auto' | 'manual';
  savedAt: number;
  meta: SaveMeta;
  /** 저장본 바이트 수 (압축 뒤) */
  bytes: number;
}

/** sim 밖에서 함께 되살릴 것 (고른 인물, 튜토리얼 진행 …) */
export interface SaveBundle {
  sim: SimSave;
  ui: Record<string, unknown>;
}

const DB = 'hearth-and-kin';
const META = 'saveMeta';
const BODY = 'saveBody';
export const AUTO_SLOTS = 3;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BODY)) db.createObjectStore(BODY);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 본문 = 머리 JSON 한 줄 + 줄바꿈 + sim 그래프 JSON 그대로 (그래프 문자열을 다시 따옴표로 감싸지 않게) */
async function pack(bundle: SaveBundle): Promise<Blob> {
  const head = JSON.stringify({ v: bundle.sim.v, seed: bundle.sim.seed, ui: bundle.ui });
  const blob = new Blob([head, '\n', bundle.sim.graph], { type: 'text/plain' });
  if (typeof CompressionStream === 'undefined') return blob;
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function unpack(blob: Blob): Promise<SaveBundle> {
  const bytes = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gz ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await blob.text();
  const nl = text.indexOf('\n');
  const head = JSON.parse(text.slice(0, nl)) as { v: number; seed: number; ui: Record<string, unknown> };
  return { sim: { v: head.v, seed: head.seed, graph: text.slice(nl + 1) }, ui: head.ui ?? {} };
}

export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;

  private conn(): Promise<IDBDatabase> {
    this.db ??= open();
    return this.db;
  }

  /** 새것부터 */
  async list(): Promise<SaveRecord[]> {
    const db = await this.conn();
    const all = await result(db.transaction(META).objectStore(META).getAll() as IDBRequest<SaveRecord[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }

  async latest(): Promise<SaveRecord | null> {
    return (await this.list())[0] ?? null;
  }

  async put(kind: 'auto' | 'manual', meta: SaveMeta, bundle: SaveBundle): Promise<SaveRecord> {
    const body = await pack(bundle);
    const list = await this.list();
    let id: string;
    if (kind === 'auto') {
      // 빈 슬롯 먼저, 다 찼으면 가장 오래된 것
      const autos = list.filter((r) => r.kind === 'auto');
      const used = new Set(autos.map((r) => r.id));
      const free = Array.from({ length: AUTO_SLOTS }, (_, i) => `auto-${i}`).find((k) => !used.has(k));
      id = free ?? autos.sort((a, b) => a.savedAt - b.savedAt)[0].id;
    } else {
      id = `manual-${Date.now().toString(36)}`;
    }
    const rec: SaveRecord = { id, kind, savedAt: Date.now(), meta, bytes: body.size };
    const db = await this.conn();
    const tx = db.transaction([META, BODY], 'readwrite');
    tx.objectStore(BODY).put(body, id);
    tx.objectStore(META).put(rec);
    await done(tx);
    return rec;
  }

  async read(id: string): Promise<SaveBundle | null> {
    const db = await this.conn();
    const body = await result(db.transaction(BODY).objectStore(BODY).get(id) as IDBRequest<Blob | undefined>);
    return body ? unpack(body) : null;
  }
}
