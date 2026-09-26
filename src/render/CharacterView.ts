/**
 * 사람 그리기: LPC 합성 시트 한 장에서 동작/방향별 프레임을 골라 그림.
 * - 이동: 스냅샷 trail(지나간 좌표)을 스냅샷 간격 동안 따라가며 보간
 * - 앉기: sit 포즈(의자 프레임), 식사는 eat, 일은 work, 들고 걷기는 carry + 물건 스프라이트
 * - 잠: 머리만 남긴 sleep 프레임을 베개 위에 그리고 그 위를 이불 스프라이트로 덮음
 * - 쓰러짐: hurt 마지막 프레임(누운 모습)
 */
import * as THREE from 'three';
import type { PersonSnap } from '../sim/protocol';
import { placeRect } from './GameRenderer';
import { makeSpriteMaterial, pixelTexture, setUvRect } from './SpriteMaterial';
import { ORDER_SCALE, type WorldView } from './WorldView';

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

  constructor(group: THREE.Group, shadowTex: THREE.Texture) {
    this.mat = makeSpriteMaterial(new THREE.Texture());
    this.mesh = new THREE.Mesh(quad, this.mat);
    this.mesh.visible = false;
    group.add(this.mesh);
    const sm = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.35 });
    this.shadow = new THREE.Mesh(quad, sm);
    this.shadow.visible = false;
    group.add(this.shadow);
  }
}

export class CharacterView {
  readonly group = new THREE.Group();
  private nodes = new Map<number, CharacterNode>();
  private shadowTex = makeShadowTexture();
  private lastTick = -1;
  selectedId: number | null = null;
  /** 앉았을 때 발 위치: 칸 아래 가장자리에서 몇 px 위 (src/data/fx.json character.seatInset) */
  seatInset = 4;
  /** 앉아서 든 물건을 서 있을 때보다 몇 px 내릴지 */
  seatCarryDrop = 6;

  constructor(
    private world: WorldView,
    private sheets: SheetProvider,
  ) {}

  /** 새 스냅샷: 보간 경로를 새로 잡음 */
  sync(persons: PersonSnap[], tick: number, tickMs: number, nowMs: number): void {
    const T = this.world.tile;
    const ticks = this.lastTick < 0 ? 1 : Math.max(1, tick - this.lastTick);
    this.lastTick = tick;
    // 스냅샷 한 번에 담긴 시간(실제 ms). 너무 길면(일시정지 해제 직후 등) 250ms로 자름
    const duration = Math.min(Math.max(ticks * tickMs, 16), 1000);
    const seen = new Set<number>();
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
      const pts: number[] = [];
      // 현재 그려진 위치에서 시작해 trail을 따라감 → 끊김 없음
      pts.push(n.fx, n.fy);
      for (let i = 0; i + 1 < p.trail.length; i += 2) {
        const q = this.world.project(p.trail[i], p.trail[i + 1]);
        pts.push(q.x, q.y);
      }
      pts.push(pr.x, pr.y);
      const cum = [0];
      let total = 0;
      for (let i = 2; i < pts.length; i += 2) {
        total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
        cum.push(total);
      }
      // 순간 이동(수 칸 이상 한 번에 튄 경우: 강제 탈출·자리 배정)은 바로 옮김
      if (total > T * 40) {
        n.fx = pr.x;
        n.fy = pr.y;
        n.motion = null;
      } else n.motion = { pts, cum, total, start: nowMs, duration };
    }
    for (const [id, n] of this.nodes) {
      if (seen.has(id)) continue;
      this.group.remove(n.mesh, n.shadow);
      if (n.carry) this.group.remove(n.carry);
      if (n.blanket) this.group.remove(n.blanket);
      this.nodes.delete(id);
    }
  }

  /** 매 프레임: 위치 보간, 프레임 선택, 정렬 */
  update(nowMs: number): void {
    for (const n of this.nodes.values()) this.updateNode(n, nowMs);
  }

  private updateNode(n: CharacterNode, nowMs: number): void {
    const p = n.snap;
    if (!p) return;
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
    // 위치 보간
    let moving = false;
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

    // 보는 층 (23-2): 위층 사람은 숨김, 아래층 사람은 흐린 실루엣
    const vis = this.world.levelVisibility(this.world.levelOfRow(p.y));
    if (p.hidden || !vis.visible) {
      n.mesh.visible = false;
      n.shadow.visible = false;
      if (n.carry) n.carry.visible = false;
      if (n.blanket) n.blanket.visible = false;
      return;
    }

    // 동작 선택
    let anim = p.anim;
    let facing = (p.facing as FacingName) ?? 'down';
    let fixedFrame: number | null = null;
    if (p.collapsed) {
      anim = 'hurt';
    } else if (p.sleeping || (p.pose === 'lie' && p.underBlanket)) {
      anim = 'sleep';
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
      placeRect(n.mesh, footX - sheet.anchorX, footY - sheet.anchorY, fw, fh);
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
    placeRect(n.shadow, footX - 10, footY - 4, 20, 6);
    n.shadow.renderOrder = base + (footY + yo) * ORDER_SCALE - 2;
    n.mat.uniforms.uTint.value.setRGB(vis.tint, vis.tint, vis.tint * 1.05);

    // 들고 있는 물건
    this.updateCarry(n, p.carry, facing, footX, footY, order, p.pose === 'sit' && !moving);
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
