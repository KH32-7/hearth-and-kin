/**
 * 사람 그리기: LPC 합성 시트 한 장에서 동작/방향별 프레임을 골라 그림.
 * - 이동: 스냅샷 trail(지나간 좌표)을 스냅샷 간격 동안 따라가며 보간
 * - 앉기: sit 포즈(의자 프레임), 식사는 eat, 일은 work, 들고 걷기는 carry + 물건 스프라이트
 * - 잠: 머리만 남긴 sleep 프레임을 베개 위에 그리고 그 위를 이불 스프라이트로 덮음
 * - 쓰러짐: hurt 마지막 프레임(누운 모습)
 */
import * as THREE from 'three';
import type { PersonSnap } from '../sim/protocol';
import { placeRect, staticGroup } from './GameRenderer';
import { makeSpriteMaterial, pixelTexture, setUvRect } from './SpriteMaterial';
import { ORDER_SCALE, type WorldView } from './WorldView';
import grading from '../data/grading.json';
import { applyGrade, PaletteIndex, type Grade } from './color';
import { LPC_PACK, OUTFITS, renderPlan } from './lpc/compose';
import { bodyTypeFor, randomSpecWith } from './lpc/plan';
import { infantFrameRect, infantLookFromSpec, planInfant, toddlerAnim, type InfantKind, type InfantLook, type InfantPlan } from './lpc/infant';
import type { CharacterSpec, Stage } from './lpc/types';
import { Rng } from '../sim/core/rng';
import balance from '../data/balance.json';
import story from '../data/story.json';

const WALK_TILES_PER_MIN = (balance as { movement: { walkTilesPerMinute: number } }).movement.walkTilesPerMinute;
const HORSE_MULT = (story as { travel?: { horseSpeedMult?: number } }).travel?.horseSpeedMult ?? 1;

export type FacingName = 'up' | 'left' | 'down' | 'right';

/** artifacts/contracts.md ComposedSheet 와 같은 모양 */
export interface SheetLike {
  image: HTMLCanvasElement | OffscreenCanvas;
  frameW: number;
  frameH: number;
  anchorX: number;
  anchorY: number;
  anims: Record<string, { row: number; frames: number; fps: number; loop: boolean; dirs: FacingName[] }>;
  /** 선택: 잠 프레임에서 머리+어깨가 끝나는 줄 */
  sleepCropY?: number;
}

export type SheetProvider = (p: PersonSnap) => SheetLike | null;

const quad = new THREE.PlaneGeometry(1, 1);
/** 들고 있는 물건: 방향별 발 기준 위치(px)와 캐릭터 앞/뒤 */
const CARRY_OFFSET: Record<FacingName, { dx: number; dy: number; front: boolean }> = {
  down: { dx: 0, dy: -18, front: true },
  up: { dx: 0, dy: -20, front: false },
  left: { dx: -9, dy: -19, front: true },
  right: { dx: 9, dy: -19, front: true },
};

interface Motion {
  pts: number[];
  cum: number[];
  total: number;
  start: number;
  duration: number;
}

class CharacterNode {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  carry: THREE.Mesh | null = null;
  carryMat: THREE.ShaderMaterial | null = null;
  blanket: THREE.Mesh | null = null;
  blanketMat: THREE.ShaderMaterial | null = null;
  shadow: THREE.Mesh;
  sheet: SheetLike | null = null;
  tex: THREE.Texture | null = null;
  snap: PersonSnap | null = null;
  motion: Motion | null = null;
  /** 앞으로 걸어갈 경로 (세계 px 점, 평평한 배열) — 일정한 속도로 따라감 */
  path: number[] = [];
  /** 걷는 속도 (px/ms, 스냅샷마다 새로 걸은 거리 ÷ 그 시간의 이동 평균) */
  speed = 0;
  /** 스냅샷 간격 (ms, 이동 평균) */
  interval = 0;
  lastMs = -1;
  /** 틱 사이 예측 위치 (워커 motion, 세계 px): 있으면 여기로 실시간으로 따라감 */
  pred: { x: number; y: number; at: number } | null = null;
  /** 예측 위치 열쇠 그림 (시각, 자리): 조금 늦춘 시각으로 두 열쇠 사이를 보간 → 고른 속도 */
  keys: { t: number; x: number; y: number; start?: boolean }[] = [];
  /** 최근 예측 걸음 속도 (px/ms, 0 = 모름) */
  vk = 0;
  /** 현재 그려진 발 위치 (세계 px) */
  fx = 0;
  fy = 0;
  animStart = 0;
  lastAnimKey = '';
  selected = false;
  /** 앉거나 누운 물건 (행동이 끝나 action 이 비어도 자세가 남아 있는 동안 기억) */
  seatObj = -1;
  /** 서 있는 층 판 (스냅샷 목표 위치 기준) */
  slab = 0;
  /** 말 (18-5, LPC Horses 128px 칸) */
  horse: THREE.Mesh | null = null;
  horseMat: THREE.ShaderMaterial | null = null;
  horseColor = -1;
  /** 이번 프레임에 그린 것 (품 안 아기가 안은 사람에게 붙을 때 씀) */
  drawn: { rectX: number; rectY: number; anim: string; frame: number; facing: FacingName; order: number; seated: boolean } | null = null;
  /** 아기/유아 시트 키 (바뀌면 텍스처 교체) */
  infantKey = '';

  constructor(group: THREE.Group, shadowTex: THREE.Texture) {
    this.mat = makeSpriteMaterial(new THREE.Texture());
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.visible = false;
    group.add(this.mesh);
    const sm = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.4, color: 0x50280e });
    this.shadow = new THREE.Mesh(quad, sm);
    this.shadow.visible = false;
    group.add(this.shadow);
  }
}

/** 직접 조작 인물이 새 위치를 따라가는 시간 (ms, 스냅샷 간격 정도) */
const DIRECT_FOLLOW_MS = 40;

export class CharacterView {
  readonly group = staticGroup();
  private nodes = new Map<number, CharacterNode>();
  private shadowTex = makeShadowTexture();
  private lastTick = -1;
  selectedId: number | null = null;
  /** 앉았을 때 발 위치: 칸 아래 가장자리에서 몇 px 위 (src/data/fx.json character.seatInset) */
  seatInset = 4;
  /** 앉아서 든 물건을 서 있을 때보다 몇 px 내릴지 */
  seatCarryDrop = 6;
  /** 말 시트 (털색 0~4): HearthGame 이 불러 넣음. 128px 칸, 행 0~3 = 질주 위/왼/아래/오른 */
  horseTextures: THREE.Texture[] = [];
  /**
   * 아기/유아 시트 (lpc.json infant): 이 뷰가 직접 합성함. 게임이 바꿔 끼울 수 있는 훅
   *  - infantLoader: 그림 불러오기 (기본: BASE_URL 기준 <img>)
   *  - infantLookFor: 사람 → 피부/눈/머리/옷 색 (기본: appearance 의 CharacterSpec 또는 마을 시드)
   */
  infantLoader: (path: string) => Promise<CanvasImageSource> = defaultLoader;
  infantLookFor: ((p: PersonSnap) => InfantLook | null) | null = null;
  private infantSheets = new Map<string, { image: HTMLCanvasElement | OffscreenCanvas; plan: InfantPlan } | 'loading' | 'failed'>();
  /** 안은 사람 id → 아기 id */
  private holding = new Map<number, number>();
  private worldPalette: PaletteIndex | null = null;
  infantErrors: string[] = [];

  constructor(
    private world: WorldView,
    private sheets: SheetProvider,
  ) {}

  /** 새 스냅샷: 보간 경로를 새로 잡음 */
  /** 틱 하나의 실제 ms (예측 걸음 속도 상한 계산용) */
  private tickMs = 1000;

  sync(persons: PersonSnap[], tick: number, tickMs: number, nowMs: number): void {
    const T = this.world.tile;
    if (tickMs > 0 && Number.isFinite(tickMs)) this.tickMs = tickMs;
    // 틱이 지나지 않은 스냅샷(대기열 변경 등으로 중간에 온 것)은 이동 보간을 새로 잡지 않음 → 걸음 속도가 들쭉날쭉하지 않게
    const advanced = this.lastTick < 0 || tick !== this.lastTick;
    const ticks = this.lastTick < 0 ? 1 : Math.max(1, tick - this.lastTick);
    this.lastTick = tick;
    // 스냅샷 한 번에 담긴 시간(실제 ms). 너무 길면(일시정지 해제 직후 등) 250ms로 자름
    const duration = Math.min(Math.max(ticks * tickMs, 16), 1000);
    const seen = new Set<number>();
    this.holding.clear();
    for (const p of persons) if (p.lifeStage === 'baby' && p.infant?.place === 'held' && p.infant.heldBy >= 0) this.holding.set(p.infant.heldBy, p.id);
    for (const p of persons) {
      seen.add(p.id);
      let n = this.nodes.get(p.id);
      // 층 판 좌표 → 화면 px (층 높이, 계단 오르기 반영): 층을 건너도 화면에서 짧게 이어짐
      const pr = this.world.project(p.x, p.y);
      if (!n) {
        n = new CharacterNode(this.group, this.shadowTex);
        n.fx = pr.x;
        n.fy = pr.y;
        this.nodes.set(p.id, n);
      }
      n.snap = p;
      n.slab = pr.slab;
      if (p.direct) {
        // 직접 조작(WASD): 스냅샷 간격(약 33ms)만큼만 따라감 → 키 입력에 바로 반응
        n.path = [];
        const pts = [n.fx, n.fy, pr.x, pr.y];
        const total = Math.hypot(pr.x - n.fx, pr.y - n.fy);
        n.motion = total > T * 40 ? null : { pts, cum: [0, total], total, start: nowMs, duration: DIRECT_FOLLOW_MS };
        if (total > T * 40) {
          n.fx = pr.x;
          n.fy = pr.y;
        }
        continue;
      }
      n.motion = null;
      // 틱 사이 예측 위치를 받는 중이면 경로를 쌓지 않고 틱 결과 자리를 새 예측으로 (앞질러 간 자리로 되돌아가지 않게)
      if (n.pred && nowMs - n.pred.at < 300) {
        n.path = [];
        if (Math.hypot(pr.x - n.fx, pr.y - n.fy) > T * 40) {
          n.fx = pr.x;
          n.fy = pr.y;
        }
        continue;
      }
      if (!advanced) continue;
      // 새로 걸은 경로 (trail + 지금 위치)를 경로 끝에 이어 붙임
      let lx = n.path.length ? n.path[n.path.length - 2] : n.fx;
      let ly = n.path.length ? n.path[n.path.length - 1] : n.fy;
      let fresh = 0;
      const add = (x: number, y: number) => {
        const d = Math.hypot(x - lx, y - ly);
        if (d < 0.05) return;
        fresh += d;
        n!.path.push(x, y);
        lx = x;
        ly = y;
      };
      for (let i = 0; i + 1 < p.trail.length; i += 2) {
        const q = this.world.project(p.trail[i], p.trail[i + 1]);
        add(q.x, q.y);
      }
      add(pr.x, pr.y);
      // 순간 이동(수십 칸: 강제 탈출·자리 배정·층 이동 실패)은 바로 옮김
      let left = Math.hypot((n.path[0] ?? n.fx) - n.fx, (n.path[1] ?? n.fy) - n.fy);
      for (let i = 2; i < n.path.length; i += 2) left += Math.hypot(n.path[i] - n.path[i - 2], n.path[i + 1] - n.path[i - 1]);
      if (left > T * 40) {
        n.fx = pr.x;
        n.fy = pr.y;
        n.path = [];
        continue;
      }
      n.interval = n.interval ? n.interval * 0.8 + duration * 0.2 : duration;
      if (fresh > 0.5) {
        const v = fresh / duration;
        n.speed = n.speed > 0 ? n.speed * 0.75 + v * 0.25 : v;
      }
    }
    for (const [id, n] of this.nodes) {
      if (seen.has(id)) continue;
      this.group.remove(n.mesh, n.shadow);
      if (n.carry) this.group.remove(n.carry);
      if (n.horse) this.group.remove(n.horse);
      if (n.blanket) this.group.remove(n.blanket);
      this.nodes.delete(id);
    }
  }

  /** 불러오기 뒤: 같은 번호의 다른 인물이 있을 수 있으니 전부 새로 (보간 기준도) */
  reset(): void {
    this.sync([], -1, this.tickMs, performance.now());
  }

  /** 틱 사이 걷는 사람의 예측 위치 (칸 좌표) */
  motion(ids: number[], xy: number[], nowMs: number): void {
    for (let i = 0; i < ids.length; i++) {
      const n = this.nodes.get(ids[i]);
      if (!n || n.snap?.direct) continue;
      const pr = this.world.project(xy[i * 2], xy[i * 2 + 1]);
      if (!n.pred || !n.keys.length) {
        n.path = [];
        n.keys = [{ t: nowMs - 34, x: n.fx, y: n.fy, start: true }];
      }
      // 최근 예측 걸음 속도 (px/ms): 따라잡기 속도 상한의 기준
      const lk = n.keys[n.keys.length - 1];
      if (lk && !lk.start && nowMs - lk.t > 5 && nowMs - lk.t <= 80) {
        const dd = Math.hypot(pr.x - lk.x, pr.y - lk.y);
        if (dd > 0.01 && dd < this.world.tile * 2) {
          const v = dd / (nowMs - lk.t);
          n.vk = n.vk > 0 ? n.vk * 0.7 + v * 0.3 : v;
        }
      }
      n.keys.push({ t: nowMs, x: pr.x, y: pr.y });
      if (n.keys.length > 8) n.keys.shift();
      n.pred = { x: pr.x, y: pr.y, at: performance.now() };
    }
  }

  /** 매 프레임: 위치 보간, 프레임 선택, 정렬 */
  update(nowMs: number): void {
    // 품 안 아기는 안은 사람을 먼저 그린 뒤에 (같은 프레임 위치에 붙임)
    const held: CharacterNode[] = [];
    for (const n of this.nodes.values()) {
      if (n.snap?.lifeStage === 'baby' && n.snap.infant?.place === 'held') held.push(n);
      else this.updateNode(n, nowMs);
    }
    for (const n of held) this.updateNode(n, nowMs);
  }

  /** 스냅샷 경로 보간: 그려질 발 위치 갱신, 움직이는 중이면 true (걷는 방향으로 facing 갱신) */
  private interpolate(n: CharacterNode, p: PersonSnap, nowMs: number): boolean {
    let moving = false;
    const dt = n.lastMs < 0 ? 16 : Math.min(100, Math.max(0, nowMs - n.lastMs));
    n.lastMs = nowMs;
    // 예측 위치를 실시간으로: 조금 늦춘 시각(50ms)에서 열쇠 두 개 사이를 보간 (고른 속도, 멈칫 없음)
    if (!n.motion && n.pred && nowMs - n.pred.at < 300 && n.keys.length) {
      const rt = nowMs - 50;
      const K = n.keys;
      let x = K[K.length - 1].x;
      let y = K[K.length - 1].y;
      let tx = 0;
      let ty = 0;
      if (rt <= K[0].t) {
        x = K[0].x;
        y = K[0].y;
      } else {
        for (let i = 0; i + 1 < K.length; i++) {
          if (rt > K[i + 1].t) continue;
          const f = (rt - K[i].t) / Math.max(1, K[i + 1].t - K[i].t);
          x = K[i].x + (K[i + 1].x - K[i].x) * f;
          y = K[i].y + (K[i + 1].y - K[i].y) * f;
          tx = K[i + 1].x - K[i].x;
          ty = K[i + 1].y - K[i].y;
          break;
        }
      }
      // 걸음 속도 상한: 틱 안에서 걷기 시작해 예측 없이 한 번에 몇 칸 옮겨진 경우(쉬다가 새 행동)에도 순간이동처럼 보이지 않게
      // 최근 걸음 속도의 1.5배(모르면 보통 걸음의 1.3배)까지만 따라가고, 크게 벌어지면(문·계단 이동) 바로 옮김
      let d = Math.hypot(x - n.fx, y - n.fy);
      const T = this.world.tile;
      const vmax = Math.max(((1.3 * WALK_TILES_PER_MIN * T) / this.tickMs) * (p.riding !== undefined ? HORSE_MULT : 1), n.vk * 1.5);
      const lim = vmax * dt;
      if (d > lim && d < T * 8) {
        x = n.fx + ((x - n.fx) / d) * lim;
        y = n.fy + ((y - n.fy) / d) * lim;
        d = lim;
      }
      n.fx = x;
      n.fy = y;
      if (Math.hypot(tx, ty) > 0.05) p.facing = Math.abs(tx) > Math.abs(ty) ? (tx > 0 ? 'right' : 'left') : ty > 0 ? 'down' : 'up';
      return d > 0.01;
    }
    if (n.pred && nowMs - n.pred.at >= 300) {
      n.pred = null;
      n.keys = [];
    }
    if (!n.motion && n.path.length) {
      // 경로를 일정한 속도로: 남은 거리가 스냅샷 한 번 몫보다 많으면 조금 빠르게, 적으면 조금 느리게 (멈췄다 뛰는 걸음 없음)
      let left = Math.hypot(n.path[0] - n.fx, n.path[1] - n.fy);
      for (let i = 2; i < n.path.length; i += 2) left += Math.hypot(n.path[i] - n.path[i - 2], n.path[i + 1] - n.path[i - 1]);
      const target = Math.max(1, n.speed * (n.interval || 500));
      const k = Math.min(2.2, Math.max(0.85, 0.85 + 0.3 * (left / target) + (left > target * 3 ? 0.6 : 0)));
      let step = Math.max(0.02, n.speed) * k * dt;
      while (step > 0 && n.path.length) {
        const bx = n.path[0];
        const by = n.path[1];
        const dx = bx - n.fx;
        const dy = by - n.fy;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (d <= step) {
          n.fx = bx;
          n.fy = by;
          step -= d;
          n.path.splice(0, 2);
        } else {
          n.fx += (dx / d) * step;
          n.fy += (dy / d) * step;
          step = 0;
        }
        moving = true;
      }
      return moving;
    }
    if (n.motion) {
      const m = n.motion;
      const t = Math.min(1, (nowMs - m.start) / m.duration);
      const d = t * m.total;
      let i = 1;
      while (i < m.cum.length - 1 && m.cum[i] < d) i++;
      const seg = m.cum[i] - m.cum[i - 1];
      const f = seg > 0 ? (d - m.cum[i - 1]) / seg : 1;
      const ax = m.pts[(i - 1) * 2];
      const ay = m.pts[(i - 1) * 2 + 1];
      const bx = m.pts[i * 2];
      const by = m.pts[i * 2 + 1];
      n.fx = ax + (bx - ax) * f;
      n.fy = ay + (by - ay) * f;
      moving = t < 1 && m.total > 0.5;
      if (moving && seg > 0) {
        const dx = bx - ax;
        const dy = by - ay;
        p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
      if (t >= 1) n.motion = null;
    }
    return moving;
  }

  private updateNode(n: CharacterNode, nowMs: number): void {
    const p = n.snap;
    if (!p) return;
    const infantKind: InfantKind | null = p.lifeStage === 'baby' ? 'baby' : p.lifeStage === 'toddler' ? 'toddler' : null;
    if (infantKind) {
      this.updateInfant(n, p, infantKind, nowMs);
      return;
    }
    n.drawn = null;
    // 위치 보간 (그림이 아직 없어도: 그림이 준비되는 순간 제자리에서 나타나게)
    const moving = this.interpolate(n, p, nowMs);
    const sheet = this.sheets(p);
    if (!sheet) {
      n.mesh.visible = false;
      return;
    }
    if (sheet !== n.sheet) {
      n.sheet = sheet;
      n.tex?.dispose();
      n.tex = pixelTexture(sheet.image as HTMLCanvasElement);
      n.mat.uniforms.map.value = n.tex;
    }

    // 보는 층 (23-2): 위층 사람은 숨김, 아래층 사람은 흐린 실루엣
    const vis = this.world.levelVisibility(this.world.levelOfRow(p.y));
    if (p.hidden || !vis.visible || this.world.hiddenInShell(p.x, p.y)) {
      n.mesh.visible = false;
      n.shadow.visible = false;
      if (n.horse) n.horse.visible = false;
      if (n.carry) n.carry.visible = false;
      if (n.blanket) n.blanket.visible = false;
      return;
    }

    // 동작 선택
    let anim = p.anim;
    let facing = (p.facing as FacingName) ?? 'down';
    let fixedFrame: number | null = null;
    // 아기를 안고 있음: 팔을 앞으로 모은 carry 자세 (서 있으면 첫 프레임에 멈춤, 앉으면 앉은 자세 그대로 무릎 위)
    const holdingBaby = this.holding.has(p.id);
    if (p.collapsed) {
      anim = 'hurt';
    } else if (p.sleeping || (p.pose === 'lie' && p.underBlanket)) {
      anim = 'sleep';
    } else if (holdingBaby && p.riding === undefined && !(p.pose === 'sit' && !moving)) {
      anim = 'carry';
      if (!moving) fixedFrame = 0;
    } else if (p.riding !== undefined && this.horseTextures[p.riding]) {
      // 말 위: 의자 자세로 안장에 앉음
      anim = 'sit';
      fixedFrame = (sheet.anims.sit as { poses?: Record<string, number> } | undefined)?.poses?.chair ?? 2;
    } else if (moving || p.anim === 'walk') {
      anim = p.carry ? 'carry' : 'walk';
      if (!moving && p.anim === 'walk') anim = p.carry ? 'carry' : 'idle';
    } else if (p.pose === 'sit' && anim !== 'eat') {
      anim = 'sit';
      fixedFrame = (sheet.anims.sit as { poses?: Record<string, number> } | undefined)?.poses?.chair ?? 2;
    }
    const info = sheet.anims[anim] ?? sheet.anims.idle;
    if (!info.dirs.includes(facing)) facing = info.dirs[0];
    const key = `${anim}:${facing}`;
    if (key !== n.lastAnimKey) {
      n.lastAnimKey = key;
      n.animStart = nowMs;
    }
    let frame: number;
    if (fixedFrame !== null) frame = Math.min(fixedFrame, info.frames - 1);
    else if (anim === 'sit') frame = info.frames - 1;
    else if (info.fps <= 0) frame = 0;
    else {
      const raw = Math.floor(((nowMs - n.animStart) / 1000) * info.fps);
      frame = info.loop ? raw % info.frames : Math.min(raw, info.frames - 1);
    }
    const row = info.row + (info.dirs.length > 1 ? info.dirs.indexOf(facing) : 0);
    const fw = sheet.frameW;
    const fh = sheet.frameH;
    const img = sheet.image as { width: number; height: number };
    setUvRect(n.mat, img.width, img.height, frame * fw, row * fh, fw, fh);

    // 발 위치 → 스프라이트 사각형 (정수 픽셀). 정렬은 판 안 발 위치 + 층 기준값
    const yo = this.world.yOff(n.slab);
    const base = this.world.orderBase(n.slab);
    const footX = Math.round(n.fx);
    let footY = Math.round(n.fy);
    let order = base + (footY + yo) * ORDER_SCALE + 2;
    n.mesh.visible = true;
    n.shadow.visible = !p.sleeping && p.pose !== 'lie';
    const sleepHead = anim === 'sleep';
    if (sleepHead) {
      // 베개 위 머리: 팩의 lieHeads(머리 중심)에 맞춤. 머리 중심은 잘린 줄보다 약 15px 위 (LPC 정면 프레임)
      const crop = sheet.sleepCropY ?? 39;
      const act = p.action;
      const bedUid = act ? act.stepObj : -1;
      const head = bedUid >= 0 ? this.world.lieHead(bedUid, footX, footY) : null;
      const hx = head ? head.x : footX;
      const hy = head ? head.y : footY - 12;
      placeRect(n.mesh, hx - sheet.anchorX, hy - (crop - 15), fw, fh);
      const bedBottom = bedUid >= 0 ? this.world.objectBottom(bedUid) : null;
      order = bedBottom !== null ? bedBottom * ORDER_SCALE + 1 : base + (footY + yo + 16) * ORDER_SCALE + 1;
      this.updateBlanket(n, bedUid, order + 1);
    } else {
      if (n.blanket) n.blanket.visible = false;
      if (p.collapsed) footY += 4;
      // 앉기: 엉덩이가 좌석 윗면에 오도록 발을 칸 아래쪽 가장자리 가까이 (LPC 의자 자세는 다리가 앞으로 나옴)
      const seated = p.pose === 'sit' && !moving;
      if (seated) footY = (Math.floor((n.fy + yo) / this.world.tile) + 1) * this.world.tile - this.seatInset - yo;
      const riding = anim === 'sit' && p.riding !== undefined && !!this.horseTextures[p.riding];
      // 말 위: 안장 높이만큼 올려 그림 (옆모습은 안장이 등 가운데, 앞/뒷모습은 조금 낮게)
      const lift = riding ? (facing === 'left' || facing === 'right' ? 16 : 12) : 0;
      const rectX = footX - sheet.anchorX + (riding && facing === 'left' ? 2 : riding && facing === 'right' ? -2 : 0);
      placeRect(n.mesh, rectX, footY - lift - sheet.anchorY, fw, fh);
      n.drawn = { rectX, rectY: footY - lift - sheet.anchorY, anim, frame, facing, order: 0, seated };
      this.updateHorse(n, riding ? p.riding! : -1, facing, footX, footY, order, nowMs);
      // 앉기: 의자/걸상 위에 그림. 등을 보이고 앉거나(위쪽) 통 안(목욕)이면 물건이 몸을 가림
      if (p.pose === 'stand') n.seatObj = -1;
      else if (p.action && p.action.stepObj >= 0 && p.action.phase === 'perform') n.seatObj = p.action.stepObj;
      if (p.pose === 'sit' && n.seatObj >= 0) {
        const bottom = this.world.objectBottom(n.seatObj);
        if (bottom !== null) {
          const cover = facing === 'up' || this.world.objectTags(n.seatObj).includes('bath');
          order = bottom * ORDER_SCALE + (cover ? -1 : 1);
        }
      }
    }
    n.mesh.renderOrder = order;
    if (n.drawn) n.drawn.order = order;
    placeRect(n.shadow, footX - 10, footY - 4, 20, 6);
    n.shadow.renderOrder = base + (footY + yo) * ORDER_SCALE - 2;
    n.mat.uniforms.uTint.value.setRGB(vis.tint, vis.tint, vis.tint * 1.05);

    // 들고 있는 물건
    this.updateCarry(n, p.carry, facing, footX, footY, order, p.pose === 'sit' && !moving);
  }

  // ------------------------------------------------------------------ 아기/유아 (lpc.json infant)

  /** 아기/유아 외형 색: 훅 → appearance 의 CharacterSpec → 마을 시드 → id */
  private infantLook(p: PersonSnap): InfantLook {
    const hooked = this.infantLookFor?.(p);
    if (hooked) return hooked;
    const a = (p.appearance ?? {}) as Record<string, unknown>;
    let spec: CharacterSpec;
    if (typeof a.skin === 'string' && a.hair && typeof a.estate === 'string') spec = a as unknown as CharacterSpec;
    else {
      // HearthGame 과 같은 방식 (마을 사람 시드 → randomSpec), 아기/유아 단계는 아동 목록으로
      const rng = new Rng((Number(a.seed) >>> 0) || p.id + 1);
      const stage = (['child', 'teen', 'adult', 'elder'].includes(String(a.stage)) ? a.stage : 'child') as Stage;
      const estate = (typeof a.estate === 'string' && a.estate in OUTFITS.dyes ? a.estate : 'freeman') as CharacterSpec['estate'];
      spec = randomSpecWith(OUTFITS, () => rng.next(), { sex: a.sex === 'female' ? 'female' : 'male', stage, estate });
    }
    return infantLookFromSpec(spec, OUTFITS, LPC_PACK);
  }

  /** 아기/유아 시트 (합성 끝날 때까지 null) */
  private infantSheet(kind: InfantKind, look: InfantLook): { key: string; image: HTMLCanvasElement | OffscreenCanvas; plan: InfantPlan } | null {
    const key = `${kind}|${look.skin}|${look.eyes}|${look.hairStyle}|${look.hairColor}|${look.main}|${look.accent}|${kind === 'toddler' ? look.garment : ''}`;
    const hit = this.infantSheets.get(key);
    if (hit && typeof hit !== 'string') return { key, ...hit };
    if (!hit) {
      this.infantSheets.set(key, 'loading');
      let plan: InfantPlan;
      try {
        plan = planInfant(kind, look, LPC_PACK);
      } catch (e) {
        this.infantSheets.set(key, 'failed');
        this.infantErrors.push(String(e));
        return null;
      }
      renderPlan(plan, this.infantLoader)
        .then((image) => {
          this.gradeInfant(image);
          this.infantSheets.set(key, { image, plan });
        })
        .catch((e) => {
          this.infantSheets.set(key, 'failed');
          this.infantErrors.push(`infant ${key}: ${String(e)}`);
        });
    }
    return null;
  }

  /** 다른 인물 시트와 같은 화풍 보정 (src/data/grading.json, HearthGame.gradeSheet 와 같은 함수) */
  private gradeInfant(img: HTMLCanvasElement | OffscreenCanvas): void {
    const g = (grading as unknown as { character: Grade }).character;
    const neutral = g.saturation === 1 && g.value === 1 && g.contrast === 1 && g.tint.every((v) => v === 1) && g.paletteSnap === 0;
    if (neutral) return;
    const ctx = img.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, img.width, img.height);
    if (g.paletteSnap > 0 && !this.worldPalette) this.worldPalette = new PaletteIndex(this.world.paletteColors());
    applyGrade(data.data, g, this.worldPalette ?? undefined);
    ctx.putImageData(data, 0, 0);
  }

  private hideNode(n: CharacterNode): void {
    n.mesh.visible = false;
    n.shadow.visible = false;
    if (n.horse) n.horse.visible = false;
    if (n.carry) n.carry.visible = false;
    if (n.blanket) n.blanket.visible = false;
    n.drawn = null;
  }

  /**
   * 아기: 요람(자기 위치, 요람 매트 높이만큼 올림) / 바닥 깔개 / 품 안(안은 사람 스프라이트 사각형에 겹침, 위 보기는 뒤에)
   * 유아: idle / walk / crawl / sit / fall / sleep (머리만, 베개 위)
   */
  private updateInfant(n: CharacterNode, p: PersonSnap, kind: InfantKind, nowMs: number): void {
    const moving = this.interpolate(n, p, nowMs);
    const vis = this.world.levelVisibility(this.world.levelOfRow(p.y));
    const inf = LPC_PACK.infant;
    const sheet = inf ? this.infantSheet(kind, this.infantLook(p)) : null;
    if (!inf || !sheet || p.hidden || !vis.visible || this.world.hiddenInShell(p.x, p.y)) {
      this.hideNode(n);
      return;
    }
    if (sheet.key !== n.infantKey) {
      n.infantKey = sheet.key;
      n.sheet = null;
      n.tex?.dispose();
      n.tex = pixelTexture(sheet.image as HTMLCanvasElement);
      n.mat.uniforms.map.value = n.tex;
    }
    if (n.carry) n.carry.visible = false;
    if (n.horse) n.horse.visible = false;
    const plan = sheet.plan;
    const fw = plan.frameW;
    const fh = plan.frameH;
    let facing = (p.facing as FacingName) ?? 'down';
    let anim = 'idle';
    let fixedFrame: number | null = null;
    const yo = this.world.yOff(n.slab);
    const base = this.world.orderBase(n.slab);
    let footX = Math.round(n.fx);
    let footY = Math.round(n.fy);
    let rectX = footX - plan.anchorX;
    let rectY = footY - plan.anchorY;
    let order = base + (footY + yo) * ORDER_SCALE + 2;
    let shadow = false;
    let blanketBed = -1;

    if (kind === 'baby') {
      const place = p.infant?.place ?? 'cradle';
      const cry = !!p.infant?.crying;
      const holder = place === 'held' ? this.nodes.get(p.infant!.heldBy) : undefined;
      if (place === 'held' && holder?.drawn && holder.snap && holder.mesh.visible) {
        const h = holder.drawn;
        facing = h.facing;
        anim = cry ? 'held_cry' : 'held';
        const ib = inf.baby.place.held;
        const ha = (holder.snap.appearance ?? {}) as { sex?: string; stage?: string; pregnant?: number };
        const bt = bodyTypeFor({ sex: ha.sex === 'female' ? 'female' : 'male', stage: (ha.stage === 'teen' ? 'teen' : 'adult') as Stage, pregnant: (ha.pregnant ?? 0) as 0 | 1 | 2 });
        // 안은 사람 carry 프레임의 윗몸 들썩임 (plan.ts carry 와 같은 값)
        let bob = 0;
        if (h.anim === 'carry') {
          const src = LPC_PACK.anims.carry.src[0].frames;
          bob = LPC_PACK.bodyTypes[bt]?.walkBob[h.facing]?.[src[h.frame % src.length]] ?? 0;
        }
        rectX = h.rectX;
        rectY = h.rectY + (ib.dy[bt] ?? 0) + bob + (h.seated ? ib.seatedDy : 0);
        order = h.order + (ib.front[facing] ? 1 : -1);
        n.fx = holder.fx;
        n.fy = holder.fy;
        footX = Math.round(n.fx);
        footY = Math.round(n.fy);
      } else if (place === 'held') {
        // 안은 사람이 안 보이면(다른 층, 숨음, 아직 합성 전) 같이 숨김
        this.hideNode(n);
        return;
      } else if (place === 'floor') {
        anim = cry ? 'floor_cry' : 'floor';
        facing = 'down';
        rectY = footY - inf.baby.place.floor.lift - plan.anchorY;
        order = base + (footY + yo) * ORDER_SCALE + 1;
      } else {
        anim = cry ? 'cradle_cry' : 'cradle';
        facing = 'down';
        rectY = footY - inf.baby.place.cradle.lift - plan.anchorY;
        const obj = p.action?.stepObj ?? -1;
        const bottom = obj >= 0 ? this.world.objectBottom(obj) : null;
        order = bottom !== null ? bottom * ORDER_SCALE + 1 : base + (footY + yo) * ORDER_SCALE + 3;
      }
    } else {
      shadow = true;
      if (p.sleeping || (p.pose === 'lie' && p.underBlanket)) {
        anim = 'sleep';
        facing = 'down';
        shadow = false;
        // 베개 위 머리 (어른 잠과 같은 규칙: 머리 중심 = 잘린 줄 - 15)
        const crop = plan.sleepCropY ?? 44;
        const bedUid = p.action ? p.action.stepObj : -1;
        const head = bedUid >= 0 ? this.world.lieHead(bedUid, footX, footY) : null;
        const hx = head ? head.x : footX;
        const hy = head ? head.y : footY - 12;
        rectX = hx - plan.anchorX;
        rectY = hy - (crop - 15);
        const bedBottom = bedUid >= 0 ? this.world.objectBottom(bedUid) : null;
        order = bedBottom !== null ? bedBottom * ORDER_SCALE + 1 : base + (footY + yo + 16) * ORDER_SCALE + 1;
        blanketBed = bedUid;
      } else {
        // crawl(걷기 2단계 전) / walk / fall(떼쓰기) / sit / idle: src/render/lpc/infant.ts toddlerAnim
        const pick = toddlerAnim(p, moving);
        anim = pick.anim;
        fixedFrame = pick.fixedFrame;
      }
      if (anim === 'sit' && p.pose === 'sit' && !moving) {
        // 의자/걸상 위 (어른과 같은 발 위치 규칙)
        footY = (Math.floor((n.fy + yo) / this.world.tile) + 1) * this.world.tile - this.seatInset - yo;
        rectY = footY - plan.anchorY;
      }
    }
    const info = plan.anims[anim];
    if (!info) {
      this.hideNode(n);
      return;
    }
    if (!info.dirs.includes(facing)) facing = info.dirs[0] as FacingName;
    const key = `${anim}:${facing}`;
    if (key !== n.lastAnimKey) {
      n.lastAnimKey = key;
      n.animStart = nowMs;
    }
    let frame: number;
    if (fixedFrame !== null) frame = Math.min(fixedFrame, info.frames - 1);
    else if (info.fps <= 0) frame = 0;
    else {
      const raw = Math.floor(((nowMs - n.animStart) / 1000) * info.fps);
      frame = info.loop ? raw % info.frames : Math.min(raw, info.frames - 1);
    }
    const r = infantFrameRect(plan, anim, facing, frame)!;
    const img = sheet.image as { width: number; height: number };
    setUvRect(n.mat, img.width, img.height, r.x, r.y, fw, fh);
    placeRect(n.mesh, rectX, rectY, fw, fh);
    n.mesh.renderOrder = order;
    n.mesh.visible = true;
    n.mat.uniforms.uTint.value.setRGB(vis.tint, vis.tint, vis.tint * 1.05);
    n.shadow.visible = shadow;
    if (shadow) {
      placeRect(n.shadow, footX - 7, footY - 3, 14, 4);
      n.shadow.renderOrder = base + (footY + yo) * ORDER_SCALE - 2;
    }
    if (blanketBed >= 0) this.updateBlanket(n, blanketBed, order + 1);
    else if (n.blanket) n.blanket.visible = false;
    n.drawn = { rectX, rectY, anim, frame, facing, order, seated: false };
  }

  /** 말: 질주 4프레임 (방향별 행). 사람 바로 뒤에 그림 (아래쪽을 보면 말 머리가 사람 앞) */
  private updateHorse(n: CharacterNode, color: number, facing: FacingName, fx: number, fy: number, order: number, nowMs: number): void {
    if (color < 0) {
      if (n.horse) n.horse.visible = false;
      return;
    }
    const tex = this.horseTextures[color];
    if (!n.horse) {
      n.horseMat = makeSpriteMaterial(tex);
      n.horse = new THREE.Mesh(quad, n.horseMat);
      this.group.add(n.horse);
    }
    if (n.horseColor !== color) {
      n.horseMat!.uniforms.map.value = tex;
      n.horseColor = color;
    }
    const row = facing === 'up' ? 0 : facing === 'left' ? 1 : facing === 'down' ? 2 : 3;
    const frame = Math.floor(nowMs / 90) % 4;
    const img = tex.image as { width: number; height: number };
    setUvRect(n.horseMat!, img.width, img.height, frame * 128, row * 128, 128, 128);
    // 발굽이 칸의 발 위치에 오게 (시트 칸 아래 여백 약 18px)
    placeRect(n.horse, fx - 64, fy - 100, 128, 128);
    n.horse.renderOrder = facing === 'down' ? order + 1 : order - 1;
    n.horse.visible = true;
  }

  private updateCarry(n: CharacterNode, item: string | null, facing: FacingName, fx: number, fy: number, order: number, seated = false): void {
    if (!item) {
      if (n.carry) n.carry.visible = false;
      return;
    }
    const id = `carry_${item}`;
    const ref = this.world.spriteRef(id);
    if (!ref) {
      if (n.carry) n.carry.visible = false;
      return;
    }
    const t = this.world.textureFor(ref.image);
    if (!t) return;
    if (!n.carry) {
      n.carryMat = makeSpriteMaterial(t.tex);
      n.carry = new THREE.Mesh(quad, n.carryMat);
      this.group.add(n.carry);
    }
    n.carryMat!.uniforms.map.value = t.tex;
    setUvRect(n.carryMat!, t.w, t.h, ref.x, ref.y, ref.w, ref.h);
    const off = CARRY_OFFSET[facing];
    // 앉아 있으면 무릎 위 (서 있을 때 가슴 높이보다 낮게)
    const dy = seated ? off.dy + this.seatCarryDrop : off.dy;
    placeRect(n.carry, fx + off.dx - ref.anchorX, fy + dy - ref.anchorY, ref.w, ref.h);
    n.carry.renderOrder = order + (off.front ? 1 : -1);
    n.carry.visible = true;
  }

  private updateBlanket(n: CharacterNode, bedUid: number, order: number): void {
    const id = bedUid >= 0 ? this.world.blanketSprite(bedUid) : null;
    const ref = id ? this.world.spriteRef(id) : undefined;
    const rect = bedUid >= 0 ? this.world.objectRect(bedUid) : null;
    if (!ref || !rect) {
      if (n.blanket) n.blanket.visible = false;
      return;
    }
    const t = this.world.textureFor(ref.image);
    if (!t) return;
    if (!n.blanket) {
      n.blanketMat = makeSpriteMaterial(t.tex);
      n.blanket = new THREE.Mesh(quad, n.blanketMat);
      this.group.add(n.blanket);
    }
    const T = this.world.tile;
    n.blanketMat!.uniforms.map.value = t.tex;
    setUvRect(n.blanketMat!, t.w, t.h, ref.x, ref.y, ref.w, ref.h);
    placeRect(n.blanket, rect.x * T - ref.anchorX, rect.screenBottom - ref.anchorY, ref.w, ref.h);
    n.blanket.renderOrder = order;
    n.blanket.visible = true;
  }

  /** 화면 좌표(세계 px)에 있는 사람 (불투명 영역은 몸통 사각형 근사) */
  pick(wx: number, wy: number): number | null {
    let best: { id: number; order: number } | null = null;
    for (const [id, n] of this.nodes) {
      if (!n.mesh.visible || !n.snap) continue;
      const left = n.fx - 12;
      const right = n.fx + 12;
      const top = n.fy - 50;
      const bottom = n.fy + 2;
      if (wx < left || wx > right || wy < top || wy > bottom) continue;
      if (!best || n.mesh.renderOrder > best.order) best = { id, order: n.mesh.renderOrder };
    }
    return best?.id ?? null;
  }

  /** 머리 위 연출 기준점: 서 있으면 머리 위, 앉으면 조금 낮게, 누우면 베개 머리 위 */
  headAnchor(id: number): { x: number; y: number } | null {
    const n = this.nodes.get(id);
    if (!n || !n.snap || !n.mesh.visible) return null;
    const pos = n.mesh.position;
    const sc = n.mesh.scale;
    // 스프라이트 사각형 위쪽 가장자리 + 머리 여백 (LPC 프레임 윗줄 ~10px 투명)
    const top = -(pos.y + sc.y / 2);
    const x = Math.round(pos.x);
    return { x, y: Math.round(top + 12) };
  }

  /** 테스트 훅/카메라 추적: 그려진 발 위치 */
  drawnPosition(id: number): { x: number; y: number } | null {
    const n = this.nodes.get(id);
    return n ? { x: n.fx, y: n.fy } : null;
  }

  /** y정렬 감사: 보이는 사람의 스프라이트 사각형, 발 위치, 순서, 앉거나 누운 물건 */
  sortItems(): { id: number; left: number; top: number; right: number; bottom: number; foot: number; order: number; onObj: number }[] {
    const out = [];
    for (const [id, n] of this.nodes) {
      if (!n.mesh.visible || !n.snap) continue;
      const pos = n.mesh.position;
      const sc = n.mesh.scale;
      const onObj = n.snap.pose !== 'stand' ? n.seatObj : -1;
      // 앉은 사람의 깊이는 좌석 아랫변 기준 (그리기 규칙과 같음)
      const seatBottom = onObj >= 0 ? this.world.objectBottom(onObj) : null;
      // 침대 없이 바닥에 누운 사람의 깊이는 몸 길이만큼 아래 (그리기 규칙 footY + 16 과 같음)
      const floorLie = seatBottom === null && n.lastAnimKey.startsWith('sleep') ? 16 : 0;
      const localFoot = Math.round(n.fy) + this.world.yOff(n.slab) + this.world.orderBase(n.slab) / ORDER_SCALE;
      out.push({
        id, left: pos.x - sc.x / 2, right: pos.x + sc.x / 2, top: -(pos.y + sc.y / 2), bottom: -(pos.y - sc.y / 2),
        foot: seatBottom ?? localFoot + floorLie, order: n.mesh.renderOrder, onObj,
      });
    }
    return out;
  }

  /** y정렬 검사용: 보이는 캐릭터의 (발 y, renderOrder) */
  sortSamples(): { id: number; footY: number; order: number; lying: boolean }[] {
    const out: { id: number; footY: number; order: number; lying: boolean }[] = [];
    for (const [id, n] of this.nodes) {
      if (!n.mesh.visible || !n.snap) continue;
      out.push({ id, footY: Math.round(n.fy), order: n.mesh.renderOrder, lying: n.lastAnimKey.startsWith('sleep') });
    }
    return out;
  }
}

/** 기본 그림 불러오기 (Assets.url 과 같은 경로 규칙, 같은 경로는 한 번만) */
const loaded = new Map<string, Promise<CanvasImageSource>>();
function defaultLoader(path: string): Promise<CanvasImageSource> {
  let pr = loaded.get(path);
  if (!pr) {
    pr = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`이미지 로드 실패: ${path}`));
      img.src = (import.meta.env.BASE_URL ?? '/') + path.split('/').map(encodeURIComponent).join('/');
    });
    loaded.set(path, pr);
  }
  return pr;
}

function makeShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 6;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20,12,8,1)';
  g.beginPath();
  g.ellipse(10, 3, 9, 2.5, 0, 0, Math.PI * 2);
  g.fill();
  const t = pixelTexture(c);
  return t;
}
