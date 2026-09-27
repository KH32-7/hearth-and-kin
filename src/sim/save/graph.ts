/**
 * 저장 파일 객체 그래프 (GDD 27-5, 30-3). sim 상태 전체를 JSON 한 덩어리로.
 *
 * - 정적 데이터(SimData 안의 객체)는 값 대신 데이터 안 경로만 적음 → 불러올 때 같은 데이터 객체를 가리킴
 * - 함수 속성은 적지 않음. 불러올 때는 새로 만든 sim 의 같은 자리 객체에 **제자리로 덮어씀** —
 *   생성자에서 만든 host 콜백 묶음과 그 콜백이 붙잡은 객체가 그대로 살아 있음
 * - 같은 객체를 여러 곳에서 가리키면 한 번만 적고 나머지는 번호로 (순환 참조도 됨)
 * - Map, Set, 형식 배열(바이트를 base64), 클래스 인스턴스(프로토타입 이름), NaN/Infinity/undefined 를 되살림
 */

type Enc = null | boolean | number | string | Enc[] | { [k: string]: Enc };

const SEP = '\u001f';

/** 데이터 안 모든 객체 → 처음 만난 경로 (저장과 불러오기가 같은 데이터에서 같은 순서로 걸음) */
export function staticPaths(data: object): { byObj: Map<object, string>; byPath: Map<string, object> } {
  const byObj = new Map<object, string>();
  const byPath = new Map<string, object>();
  const stack: [object, string][] = [[data, '']];
  while (stack.length) {
    const [o, path] = stack.pop()!;
    if (byObj.has(o)) continue;
    byObj.set(o, path);
    byPath.set(path, o);
    if (ArrayBuffer.isView(o)) continue;
    const kids: [unknown, string][] = [];
    // 컴파일된 데이터(data.compiled)는 Map 안에 있음: 원시 키는 키로, 객체 키는 순서로
    if (o instanceof Map) {
      let i = 0;
      for (const [k, v] of o) {
        if (k && typeof k === 'object') kids.push([k, `k:${i}`]);
        kids.push([v, k && typeof k === 'object' ? `v:${i}` : `m:${String(k)}`]);
        i++;
      }
    } else if (o instanceof Set) {
      let i = 0;
      for (const v of o) kids.push([v, `s:${i++}`]);
    } else for (const k of Object.keys(o)) kids.push([(o as Record<string, unknown>)[k], k]);
    for (let i = kids.length - 1; i >= 0; i--) {
      const [v, seg] = kids[i];
      if (v && typeof v === 'object') stack.push([v as object, path ? path + SEP + seg : seg]);
    }
  }
  return { byObj, byPath };
}

type TypedArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array | Uint8ClampedArray;
const TYPED: Record<string, new (n: number | ArrayBuffer) => TypedArray> = {
  Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray,
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}
const B64I = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
function fromB64(s: string): Uint8Array {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64I[s.charCodeAt(i)] << 18) | (B64I[s.charCodeAt(i + 1)] << 12) | ((B64I[s.charCodeAt(i + 2)] & 63) << 6) | (B64I[s.charCodeAt(i + 3)] & 63);
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** host 묶음의 get 속성: 값이 아니라 다른 상태를 비춤 → 적지 않고 덮어쓰지 않음 */
function isAccessor(o: object, k: string): boolean {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return !!d && (d.get !== undefined || d.set !== undefined);
}

const keyCache = new WeakMap<ClassTable, Map<object, string>>();
function tableKeys(table: ClassTable): Map<object, string> {
  let m = keyCache.get(table);
  if (!m) {
    m = new Map();
    for (const k in table) m.set(table[k].prototype, k);
    keyCache.set(table, m);
  }
  return m;
}

/** 이름이 바뀌어도(압축 빌드) 같은 키로 찾을 클래스. 나머지는 생성자 이름 */
export type ClassTable = Record<string, { prototype: object }>;

function className(o: object, table: ClassTable): string | null {
  const proto = Object.getPrototypeOf(o);
  if (proto === Object.prototype) return null;
  if (proto === null) return '~null';
  const key = tableKeys(table).get(proto);
  if (key) return key;
  return (proto.constructor as { name?: string } | undefined)?.name || '~anon';
}

/** 클래스별로 저장하지 않는 속성 (길찾기 작업 버퍼처럼 틱 사이에 뜻이 없는 것). 불러올 때는 새 객체 값을 그대로 둠 */
export type Transient = Record<string, string[]>;

export function encodeGraph(root: object, data: object, table: ClassTable, transient: Transient = {}): string {
  const statics = staticPaths(data).byObj;
  const ids = new Map<object, number>();

  const enc = (v: unknown): Enc | undefined => {
    switch (typeof v) {
      case 'number':
        if (Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
        return { n: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
      case 'string':
      case 'boolean':
        return v;
      case 'undefined':
        return { u: 1 };
      case 'function':
      case 'symbol':
        return undefined;
      case 'bigint':
        throw new Error('save: bigint');
    }
    if (v === null) return null;
    const o = v as object;
    const sp = statics.get(o);
    if (sp !== undefined) return { $: sp };
    const seen = ids.get(o);
    if (seen !== undefined) return { '@': seen };
    const id = ids.size;
    ids.set(o, id);
    if (ArrayBuffer.isView(o)) {
      const ta = o as TypedArray;
      return { '#': id, t: 'x', c: ta.constructor.name, v: toB64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)) };
    }
    if (Array.isArray(o)) {
      const out: Enc[] = [];
      for (let i = 0; i < o.length; i++) out.push(enc(o[i]) ?? null);
      return { '#': id, t: 'a', v: out };
    }
    if (o instanceof Map) {
      const out: Enc[] = [];
      for (const [k, val] of o) {
        const ev = enc(val);
        if (ev === undefined) continue;
        out.push([enc(k) ?? null, ev]);
      }
      return { '#': id, t: 'm', v: out };
    }
    if (o instanceof Set) {
      const out: Enc[] = [];
      for (const val of o) out.push(enc(val) ?? null);
      return { '#': id, t: 's', v: out };
    }
    if (o instanceof Date || o instanceof RegExp || o instanceof WeakMap || o instanceof WeakSet || o instanceof Promise) throw new Error(`save: 저장할 수 없는 객체 ${o.constructor.name}`);
    const props: Record<string, Enc> = {};
    const cn = className(o, table);
    const skip = cn ? transient[cn] : undefined;
    for (const k of Object.keys(o)) {
      if (isAccessor(o, k) || skip?.includes(k)) continue;
      const ev = enc((o as Record<string, unknown>)[k]);
      if (ev !== undefined) props[k] = ev;
    }
    return cn ? { '#': id, t: 'o', c: cn, v: props } : { '#': id, t: 'o', v: props };
  };

  return JSON.stringify(enc(root));
}

/**
 * 저장본을 fresh(같은 데이터·같은 설정으로 새로 만든 루트)에 덮어씀. fresh 그래프에서 같은 자리에 같은 종류 객체가 있으면
 * 그 객체를 그대로 쓰고(콜백이 붙잡은 참조 유지) 없으면 새로 만듦
 */
export function decodeInto(json: string, fresh: object, data: object, table: ClassTable, transient: Transient = {}): void {
  const statics = staticPaths(data).byPath;
  const protos = new Map<string, object>();
  for (const k in table) protos.set(k, table[k].prototype);
  const freshByClass = new Map<string, object[]>();
  // fresh 그래프의 클래스 프로토타입 (저장 뒤 새로 생긴 인스턴스도 같은 클래스면 여기서 찾음)
  (function collect() {
    const seen = new Set<object>();
    const stack: unknown[] = [fresh];
    const dataSet = new Set(statics.values());
    while (stack.length) {
      const v = stack.pop();
      if (!v || typeof v !== 'object' || seen.has(v) || dataSet.has(v)) continue;
      seen.add(v);
      if (ArrayBuffer.isView(v)) continue;
      const cn = className(v, table);
      if (cn && !protos.has(cn)) protos.set(cn, Object.getPrototypeOf(v));
      if (cn) freshByClass.set(cn, (freshByClass.get(cn) ?? []).concat([v]));
      if (v instanceof Map) for (const [k, x] of v) stack.push(k, x);
      else if (v instanceof Set) for (const x of v) stack.push(x);
      else for (const k of Object.keys(v)) stack.push((v as Record<string, unknown>)[k]);
    }
  })();

  const root = JSON.parse(json) as Enc;
  // 하나뿐인 클래스 인스턴스(SocietyLink 같은 시스템)는 경로와 상관없이 짝지음: 저장본에서 먼저 닿은 경로가
  // fresh 에서 그 객체가 있는 경로와 달라도, 생성자 콜백이 붙잡은 바로 그 객체에 덮어써야 함
  const savedCount = new Map<string, number>();
  (function count(e: Enc) {
    if (!e || typeof e !== 'object') return;
    if (Array.isArray(e)) return e.forEach(count);
    if ('#' in e && typeof e.c === 'string') savedCount.set(e.c, (savedCount.get(e.c) ?? 0) + 1);
    if ('v' in e && typeof e.v === 'object') count(e.v as Enc);
    else if (!('#' in e)) for (const k of Object.keys(e)) count(e[k]);
  })(root);
  const single = new Map<string, object>();
  for (const [cn, list] of freshByClass) if (list.length === 1 && savedCount.get(cn) === 1) single.set(cn, list[0]);

  const nodes: object[] = [];
  const claimed = new Set<object>();
  const staticSet = new Set(statics.values());
  const reusable = (f: unknown): f is object => !!f && typeof f === 'object' && !claimed.has(f) && !staticSet.has(f);

  const dec = (e: Enc, f: unknown): unknown => {
    if (e === null || typeof e !== 'object') return e;
    if (Array.isArray(e)) throw new Error('save: 잘못된 노드');
    if ('@' in e) {
      const r = nodes[e['@'] as number];
      if (!r) throw new Error(`save: 앞에 없는 참조 ${e['@']}`);
      return r;
    }
    if ('$' in e) {
      const s = statics.get(e.$ as string);
      if (!s) throw new Error(`save: 데이터에 없는 경로 ${String(e.$).split(SEP).join('.')}`);
      return s;
    }
    if ('n' in e) return e.n === 'NaN' ? NaN : e.n === 'Inf' ? Infinity : -Infinity;
    if ('u' in e) return undefined;
    const id = e['#'] as number;
    const t = e.t as string;
    if (t === 'x') {
      const Ctor = TYPED[e.c as string];
      if (!Ctor) throw new Error(`save: 형식 배열 ${String(e.c)}`);
      const bytes = fromB64(e.v as string);
      const copy = new Ctor(bytes.slice().buffer);
      let out: TypedArray;
      if (reusable(f) && f.constructor === Ctor && (f as TypedArray).length === copy.length) {
        (f as TypedArray).set(copy as never);
        out = f as TypedArray;
        claimed.add(f);
      } else out = copy;
      nodes[id] = out;
      return out;
    }
    if (t === 'a') {
      const arr = reusable(f) && Array.isArray(f) ? f : [];
      if (arr === f) claimed.add(arr);
      nodes[id] = arr;
      const old = arr.slice();
      const v = e.v as Enc[];
      arr.length = v.length;
      for (let i = 0; i < v.length; i++) arr[i] = v[i] === null && typeof old[i] === 'function' ? old[i] : dec(v[i], old[i]);
      return arr;
    }
    if (t === 'm') {
      const map = reusable(f) && f instanceof Map ? f : new Map();
      if (map === f) claimed.add(map);
      nodes[id] = map;
      const old = new Map(map);
      map.clear();
      // 함수 값(sim.gates 같은 등록표)은 적지 않았으니 새 객체 것을 그대로
      for (const [k, x] of old) if (typeof x === 'function') map.set(k, x);
      for (const pair of e.v as Enc[][]) {
        const k = dec(pair[0], undefined);
        map.set(k, dec(pair[1], k !== null && typeof k === 'object' ? undefined : old.get(k)));
      }
      return map;
    }
    if (t === 's') {
      const set = reusable(f) && f instanceof Set ? f : new Set();
      if (set === f) claimed.add(set);
      nodes[id] = set;
      const oldFns = [...set].filter((x) => typeof x === 'function');
      set.clear();
      for (const x of oldFns) set.add(x);
      for (const x of e.v as Enc[]) set.add(dec(x, undefined));
      return set;
    }
    // 객체
    const cn = (e.c as string | undefined) ?? null;
    let obj: Record<string, unknown>;
    const one = cn ? single.get(cn) : undefined;
    if (one && !claimed.has(one)) {
      obj = one as Record<string, unknown>;
      claimed.add(one);
    } else if (reusable(f) && (!cn || !single.has(cn)) && !Array.isArray(f) && !(f instanceof Map) && !(f instanceof Set) && !ArrayBuffer.isView(f) && className(f, table) === cn) {
      obj = f as Record<string, unknown>;
      claimed.add(f);
    } else if (cn === null) obj = {};
    else if (cn === '~null') obj = Object.create(null);
    else {
      const proto = protos.get(cn);
      if (!proto) throw new Error(`save: 모르는 클래스 ${cn}`);
      obj = Object.create(proto);
    }
    nodes[id] = obj;
    const props = e.v as Record<string, Enc>;
    const skip = cn ? transient[cn] : undefined;
    const dataKey = (k: string) => !isAccessor(obj, k) && !skip?.includes(k) && typeof obj[k] !== 'function';
    const savedKeys = Object.keys(props);
    const haveKeys = Object.keys(obj).filter(dataKey);
    // 속성 순서도 상태 (Object.keys 순회 순서 → 결정론). 순서가 같으면 제자리에(클래스 모양 유지), 다르면 지우고 저장 순서로
    const oldVals = new Map<string, unknown>();
    if (haveKeys.length !== savedKeys.length || haveKeys.some((k, i) => k !== savedKeys[i])) {
      for (const k of haveKeys) {
        oldVals.set(k, obj[k]);
        delete obj[k];
      }
    }
    for (const k of savedKeys) obj[k] = dec(props[k], oldVals.has(k) ? oldVals.get(k) : obj[k]);
    // 클래스 인스턴스: 저장본에 없는 필드(저장 뒤 코드에 새로 생긴 필드)는 생성자 기본값으로 남김. 일반 객체(사전)는 저장본 그대로
    if (cn !== null) for (const [k, v] of oldVals) if (!(k in props)) obj[k] = v;
    return obj;
  };

  const out = dec(root, fresh);
  if (out !== fresh) throw new Error('save: 루트 종류가 다름');
}
