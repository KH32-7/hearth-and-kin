/**
 * 메인 스레드 쪽 워커 창구. 의도(intent)를 보내고 스냅샷을 받음.
 */
import type { MenuEntry } from '../sim/sim';
import type { FromWorker, Snapshot, ToWorker } from '../sim/protocol';

type Pending = { resolve: (v: unknown) => void };

export class SimClient {
  private worker: Worker;
  private nextReq = 1;
  private pending = new Map<number, Pending>();
  snap: Snapshot | null = null;
  /** 스냅샷을 받은 시각 (보간 기준) */
  snapAt = 0;
  private listeners: Array<(s: Snapshot) => void> = [];
  errors: string[] = [];

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      this.errors.push(ev.message);
      console.error('sim worker error', ev.message);
    };
  }

  private onMessage(m: FromWorker): void {
    if (m.type === 'snapshot') {
      this.snap = m.snap;
      this.snapAt = performance.now();
      for (const l of this.listeners) l(m.snap);
    } else if (m.type === 'motion') {
      // 워커 시각 → 메인 시각 (가장 짧은 전달 지연 기준): 도착이 들쑥날쑥해도 간격은 워커가 찍은 대로
      const off = performance.now() - m.at;
      this.motionOffset = this.motionOffset === null ? off : Math.min(off, this.motionOffset + 0.5);
      for (const l of this.motionListeners) l(m.ids, m.xy, m.at + this.motionOffset);
    } else if (m.type === 'reply') {
      this.pending.get(m.reqId)?.resolve(m.result);
      this.pending.delete(m.reqId);
    } else if (m.type === 'menu') {
      this.pending.get(m.reqId)?.resolve(m.entries);
      this.pending.delete(m.reqId);
    } else if (m.type === 'error') {
      this.errors.push(m.message);
      console.error('sim error', m.message);
    }
  }

  private motionOffset: number | null = null;
  private motionListeners: ((ids: number[], xy: number[], tick: number) => void)[] = [];
  /** 틱 사이 예측 위치 (걷는 사람만) */
  onMotion(fn: (ids: number[], xy: number[], tick: number) => void): void {
    this.motionListeners.push(fn);
  }

  onSnapshot(fn: (s: Snapshot) => void): void {
    this.listeners.push(fn);
  }

  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  request<T>(build: (reqId: number) => ToWorker): Promise<T> {
    const reqId = this.nextReq++;
    return new Promise<T>((resolve) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void });
      this.worker.postMessage(build(reqId));
    });
  }

  menu(personId: number, targetUid: number): Promise<MenuEntry[]> {
    return this.request((reqId) => ({ type: 'menu', personId, targetUid, reqId }));
  }

  queue(personId: number, interactionId: string, targetUid: number): Promise<{ ok: boolean; reason?: string }> {
    return this.request((reqId) => ({ type: 'queue', personId, interactionId, targetUid, reqId }));
  }

  menuPerson(personId: number, targetPersonId: number): Promise<MenuEntry[]> {
    return this.request((reqId) => ({ type: 'menuPerson', personId, targetPersonId, reqId }));
  }

  /** 소원 길잡이: 그 소원을 이루는 상호작용과 가까운 물건·사람 */
  wishHint(personId: number, wishId: string): Promise<{ interactionIds: string[]; uids: number[]; persons: number[] }> {
    return this.request((reqId) => ({ type: 'wishHint', personId, wishId, reqId }));
  }

  /** 상태를 바꾸는 의도 (Simulation.apply) */
  intent<T = unknown>(intent: Record<string, unknown>): Promise<T> {
    return this.request((reqId) => ({ type: 'intent', intent, reqId }));
  }

  goto(personId: number, x: number, y: number): Promise<{ ok: boolean }> {
    return this.request((reqId) => ({ type: 'goto', personId, x, y, reqId }));
  }

  /** 다음 스냅샷을 기다림 (테스트 훅용) */
  nextSnapshot(): Promise<Snapshot> {
    return new Promise((resolve) => {
      const fn = (s: Snapshot) => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        resolve(s);
      };
      this.listeners.push(fn);
    });
  }
}
