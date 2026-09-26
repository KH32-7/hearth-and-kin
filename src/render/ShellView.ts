/**
 * 건물 외관 (docs/07): Village 팩 완성 외관(프리팹 조립, tools/world/build-shells.py)을 부지의 shells 자리에 그림.
 * - 순서: 발자국 아래 끝 줄 (사람/물건과 같은 ORDER 규칙) → 뒤에 선 사람은 지붕에 가려지고, 안에 든 사람은 외관에 가려짐
 * - 걷힘: 외관마다 불투명도 목표(0~1)를 게임이 정함 (우리 가족이 안에 있거나 지붕 끔/건축 모드 → 0 → 실내가 보임)
 * - 밤: 창 유리 마스크를 따뜻한 빛으로 (장면 + 광원 레이어)
 * 게임 로직은 칸만 앎. 그림 크기/위치는 shells.json 에만
 */
import * as THREE from 'three';
import { placeRect, staticGroup } from './GameRenderer';
import { makeSpriteMaterial, pixelTexture, setUvRect } from './SpriteMaterial';
import { makeAoMaterial, makeShadowMaterial, SHADOW_ORDER, shadowQuad } from './Shadows';

export interface ShellDef {
  role: string;
  size: string;
  w: number;
  h: number;
  foot: [number, number];
  door: number;
  x: number;
  y: number;
  glass: number;
  /** 열린 모습 (A: 지붕 들어 올리기): 아래 부품(구멍 투명) / 지붕 부품의 아틀라스 자리 */
  base?: [number, number];
  roof?: [number, number];
}
export interface ShellsData {
  image: string;
  glass: string;
  /** 창문 빛 번짐 (유리 마스크를 흐린 판) */
  glow?: string;
  story: number;
  shells: Record<string, ShellDef>;
}
export interface ShellPlace {
  id: string;
  x: number;
  y: number;
  tag?: string;
}

interface Node {
  place: ShellPlace;
  def: ShellDef;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  glass: THREE.Mesh | null;
  glassMat: THREE.MeshBasicMaterial | null;
  /** 창문 빛 번짐 (광원 레이어만, 밤) */
  glowMesh: THREE.Mesh | null;
  alpha: number;
  target: number;
  shadow: THREE.Mesh | null;
  shadowMat: THREE.ShaderMaterial | null;
  /** A 방식 부품 (없으면 통째로 들어 올림) */
  baseMesh: THREE.Mesh | null;
  roofMesh: THREE.Mesh | null;
  /** 열림 진행 0 닫힘 ~ 1 열림 */
  open: number;
  top: number;
  /** 실내를 보여 줄 집 (열림, 또는 닫히는 중) */
  reveal: boolean;
}

const quad = new THREE.PlaneGeometry(1, 1);

export class ShellView {
  readonly group = staticGroup();
  private nodes: Node[] = [];
  private tex: THREE.Texture | null = null;
  private glassTex: THREE.Texture | null = null;
  private glowTex: THREE.Texture | null = null;
  private img: { width: number; height: number } | null = null;

  constructor(readonly data: ShellsData, private tile: number, private orderScale: number) {}

  setImages(img: HTMLImageElement, glass: HTMLImageElement | null, glow: HTMLImageElement | null = null): void {
    this.tex = pixelTexture(img);
    this.img = img;
    if (glass) this.glassTex = pixelTexture(glass);
    if (glow) {
      this.glowTex = new THREE.Texture(glow);
      this.glowTex.needsUpdate = true;
      this.glowTex.magFilter = THREE.LinearFilter;
      this.glowTex.minFilter = THREE.LinearFilter;
    }
  }

  /** 외관 목록이 바뀌면 다시 만듦 */
  build(places: ShellPlace[]): void {
    for (const n of this.nodes) {
      this.group.remove(n.mesh);
      n.mat.dispose();
      for (const m of [n.baseMesh, n.roofMesh]) if (m) {
        this.group.remove(m);
        (m.material as THREE.ShaderMaterial).dispose();
      }
      if (n.shadow) {
        this.group.remove(n.shadow);
        n.shadowMat?.dispose();
      }
      if (n.glass) {
        this.group.remove(n.glass);
        n.glassMat?.dispose();
      }
      if (n.glowMesh) {
        this.group.remove(n.glowMesh);
        (n.glowMesh.material as THREE.Material).dispose();
      }
    }
    this.nodes = [];
    if (!this.tex || !this.img) return;
    const T = this.tile;
    for (const p of places) {
      const d = this.data.shells[p.id];
      if (!d) continue;
      const mat = makeSpriteMaterial(this.tex);
      setUvRect(mat, this.img.width, this.img.height, d.x, d.y, d.w, d.h);
      const mesh = new THREE.Mesh(quad, mat);
      const bottom = (p.y + d.foot[1]) * T;
      placeRect(mesh, p.x * T, bottom - d.h, d.w, d.h);
      // 발자국 맨 아래 줄의 사람/물건보다 앞 (+3)
      mesh.renderOrder = bottom * this.orderScale + 3;
      this.group.add(mesh);
      let glass: THREE.Mesh | null = null;
      let glassMat: THREE.MeshBasicMaterial | null = null;
      if (this.glassTex && d.glass > 0) {
        glassMat = new THREE.MeshBasicMaterial({ map: this.glassTex, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, color: 0xffcf6a, opacity: 0 });
        const g = this.glassTex.image as { width: number; height: number };
        const tx = glassMat.map!.clone();
        tx.needsUpdate = true;
        tx.repeat.set(d.w / g.width, d.h / g.height);
        tx.offset.set(d.x / g.width, 1 - (d.y + d.h) / g.height);
        glassMat.map = tx;
        glass = new THREE.Mesh(quad, glassMat);
        placeRect(glass, p.x * T, bottom - d.h, d.w, d.h);
        glass.renderOrder = mesh.renderOrder + 1;
        // 광원 레이어에도 (주변을 밝힘)
        glass.layers.enable(1);
        this.group.add(glass);
      }
      // 창문 빛 번짐: 흐린 유리 판을 광원 레이어에만 (창 둘레 벽과 땅이 은은히 밝아짐)
      let glowMesh: THREE.Mesh | null = null;
      if (this.glowTex && d.glass > 0) {
        const gm = new THREE.MeshBasicMaterial({ map: this.glowTex.clone(), transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, color: 0xffc860, opacity: 0 });
        const g = this.glowTex.image as { width: number; height: number };
        gm.map!.needsUpdate = true;
        gm.map!.repeat.set(d.w / g.width, d.h / g.height);
        gm.map!.offset.set(d.x / g.width, 1 - (d.y + d.h) / g.height);
        glowMesh = new THREE.Mesh(quad, gm);
        // 조금 아래로 (창 빛이 벽 아래와 땅에 떨어짐)
        placeRect(glowMesh, p.x * T, bottom - d.h + 10, d.w, d.h);
        glowMesh.layers.set(1);
        glowMesh.renderOrder = mesh.renderOrder + 2;
        this.group.add(glowMesh);
      }
      // 땅 그림자 (외관 실루엣을 해 쪽 반대로 눕힘)
      const shadowMat = makeShadowMaterial(this.tex);
      // 건물: 앞으로 눕히면 정면 아래 넓은 검은 판이 되어 어색함 (사용자) → 실루엣을 오른쪽 아래로 조금 밀어 벽 옆·밑에만 붙는 그림자
      // 물건·나무와 똑같은 해 투영 (발 줄에서 눕힘, 같은 길이) → 방향이 늘 같고 밑동에 붙음
      shadowMat.uniforms.uBase.value = 0;
      setUvRect(shadowMat, this.img.width, this.img.height, d.x, d.y, d.w, d.h);
      const shadow = new THREE.Mesh(shadowQuad, shadowMat);
      placeRect(shadow, p.x * T, bottom - d.h, d.w, d.h);
      shadow.renderOrder = SHADOW_ORDER;
      this.group.add(shadow);
      // 접지 그림자: 발자국 밑동(앞벽 아래)을 따라 짧은 띠
      const ao = new THREE.Mesh(quad, makeAoMaterial(0.55));
      placeRect(ao, p.x * T - 2, bottom, d.w + 4, 12);
      ao.renderOrder = SHADOW_ORDER + 1;
      this.group.add(ao);
      // A 방식: 지붕 부품은 위로 들리며 사라지고, 아래 부품(벽)은 조금 늦게 사라짐
      let baseMesh: THREE.Mesh | null = null, roofMesh: THREE.Mesh | null = null;
      if (d.base && d.roof) {
        const part = (at: [number, number], extra: number) => {
          const m = makeSpriteMaterial(this.tex!);
          setUvRect(m, this.img!.width, this.img!.height, at[0], at[1], d.w, d.h);
          const me = new THREE.Mesh(quad, m);
          placeRect(me, p.x * T, bottom - d.h, d.w, d.h);
          me.renderOrder = mesh.renderOrder + extra;
          me.visible = false;
          this.group.add(me);
          return me;
        };
        baseMesh = part(d.base, 0);
        roofMesh = part(d.roof, 0.5);
      }
      this.nodes.push({ place: p, def: d, mesh, mat, glass, glassMat, glowMesh, alpha: 1, target: 1, shadow, shadowMat, baseMesh, roofMesh, open: 0, top: mesh.position.y, reveal: false });
    }
  }

  /** 칸 (x, y) 가 외관 발자국 안인 외관 번호 (없으면 -1) */
  at(x: number, y: number): number {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (x >= n.place.x && x < n.place.x + n.def.foot[0] && y >= n.place.y && y < n.place.y + n.def.foot[1]) return i;
    }
    return -1;
  }

  /** 발자국 칸들 (지붕 자동 합성에서 뺌) */
  footCells(w: number): Set<number> {
    const out = new Set<number>();
    for (const n of this.nodes) for (let y = n.place.y; y < n.place.y + n.def.foot[1]; y++) for (let x = n.place.x; x < n.place.x + n.def.foot[0]; x++) out.add(y * w + x);
    return out;
  }

  /** 걷는 방식: 'fade' (스타듀식 화면 전환 뒤, 이웃 외관 포함 바로 걷음) / 'lift' (A: 제자리에서 지붕이 들리고 벽이 사라짐) */
  mode: 'fade' | 'lift' = 'fade';

  /** 매 프레임: 불투명도 목표 (open = 걷을 외관 번호), 밤 창문 */
  update(dtMs: number, open: Set<number>, allOpen: boolean, darkness: number, nowMs: number): void {
    if (this.mode === 'lift') return this.updateLift(dtMs, open, allOpen, darkness, nowMs);
    const k = Math.min(1, dtMs / 220);
    // 걷힌 집의 실내(발자국 + 벽 높이)를 가리는 이웃 외관도 반쯤 걷음
    const T = this.tile;
    const openRects: [number, number, number, number][] = [];
    for (const i of open) {
      const n = this.nodes[i];
      if (!n) continue;
      const x0 = n.place.x * T, x1 = (n.place.x + n.def.foot[0]) * T;
      const y1 = (n.place.y + n.def.foot[1]) * T, y0 = n.place.y * T - this.data.story;
      openRects.push([x0, y0, x1, y1]);
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      let tgt = allOpen || open.has(i) ? 0 : 1;
      n.reveal = tgt === 0 || (n.reveal && n.alpha < 0.98);
      if (tgt === 1 && openRects.length) {
        const bx0 = n.place.x * T, bx1 = bx0 + n.def.w;
        const by1 = (n.place.y + n.def.foot[1]) * T, by0 = by1 - n.def.h;
        for (const [x0, y0, x1, y1] of openRects) if (bx0 < x1 && bx1 > x0 && by0 < y1 && by1 > y0 && by1 > y1 - T) tgt = 0;
      }
      n.target = tgt;
      if (n.alpha !== n.target) {
        n.alpha += (n.target - n.alpha) * k;
        if (Math.abs(n.alpha - n.target) < 0.02) n.alpha = n.target;
      }
      n.mat.uniforms.uOpacity.value = n.alpha;
      n.mesh.visible = n.alpha > 0.01;
      // A 방식에서 넘어온 부품/높이 되돌림
      n.open = 0;
      n.mesh.position.y = n.top;
      n.mesh.updateMatrix();
      if (n.baseMesh) n.baseMesh.visible = false;
      if (n.roofMesh) n.roofMesh.visible = false;
      if (n.shadowMat) n.shadowMat.uniforms.uFade.value = n.alpha;
      if (n.glassMat && n.glass) {
        // 집마다 조금 다르게 깜빡 (촛불)
        const flick = 0.9 + 0.1 * Math.sin(nowMs / 170 + i * 1.7) * Math.sin(nowMs / 410 + i);
        n.glassMat.opacity = Math.max(0, darkness - 0.15) * 1.1 * flick * n.alpha;
        n.glass.visible = n.glassMat.opacity > 0.01;
      }
      if (n.glowMesh) {
        const gm = n.glowMesh.material as THREE.MeshBasicMaterial;
        gm.opacity = Math.max(0, darkness - 0.15) * 0.9 * n.alpha;
        n.glowMesh.visible = gm.opacity > 0.01;
      }
    }
  }

  /**
   * A 방식 (Grass Land 2.0 오두막처럼): 연 집만 제자리에서 열림. 0.7초
   *  - 지붕 부품: 위로 56px 들리며 사라짐 (0 → 0.6)
   *  - 벽 부품(구멍 투명): 0.35 부터 사라짐 → 발자국 크기 그대로의 실내가 드러남
   *  - 부품이 없는 외관은 통째로 들리며 사라짐
   * 앞을 가리는 이웃 외관은 반투명(0.35)
   */
  private updateLift(dtMs: number, open: Set<number>, allOpen: boolean, darkness: number, nowMs: number): void {
    const T = this.tile;
    const step = dtMs / 700;
    const ease = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
    const openRects: [number, number, number, number][] = [];
    for (const i of open) {
      const n = this.nodes[i];
      if (!n) continue;
      openRects.push([n.place.x * T, n.place.y * T - this.data.story, (n.place.x + n.def.foot[0]) * T, (n.place.y + n.def.foot[1]) * T]);
    }
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const want = allOpen || open.has(i) ? 1 : 0;
      n.open = want > n.open ? Math.min(1, n.open + step) : Math.max(0, n.open - step * 1.4);
      n.reveal = want === 1 || n.open > 0.001;
      // 연 집을 가리는 이웃 (아래쪽 외관의 지붕)
      let cover = 1;
      if (!want && openRects.length) {
        const bx0 = n.place.x * T, bx1 = bx0 + n.def.w;
        const by1 = (n.place.y + n.def.foot[1]) * T, by0 = by1 - n.def.h;
        for (const [x0, , x1, y1] of openRects) if (bx0 < x1 && bx1 > x0 && by0 < y1 && by1 > y1) cover = 0.35;
      }
      n.target = cover;
      n.alpha += (n.target - n.alpha) * Math.min(1, dtMs / 160);
      const o = n.open;
      const parts = n.baseMesh && n.roofMesh;
      if (o <= 0.001 || !parts) {
        // 닫힘, 또는 부품 없음: 통째로 들리며 사라짐
        n.mat.uniforms.uOpacity.value = n.alpha * (1 - ease(o / 0.9));
        n.mesh.position.y = n.top + ease(o) * 40;
        n.mesh.updateMatrix();
        n.mesh.visible = (n.mat.uniforms.uOpacity.value as number) > 0.01;
        if (n.baseMesh) n.baseMesh.visible = false;
        if (n.roofMesh) n.roofMesh.visible = false;
      } else {
        n.mesh.visible = false;
        const rm = n.roofMesh!.material as THREE.ShaderMaterial;
        const bm = n.baseMesh!.material as THREE.ShaderMaterial;
        rm.uniforms.uOpacity.value = 1 - ease(o / 0.6);
        n.roofMesh!.position.y = n.top + ease(o / 0.6) * 56;
        n.roofMesh!.updateMatrix();
        n.roofMesh!.visible = (rm.uniforms.uOpacity.value as number) > 0.01;
        bm.uniforms.uOpacity.value = 1 - ease((o - 0.35) / 0.55);
        n.baseMesh!.visible = (bm.uniforms.uOpacity.value as number) > 0.01;
      }
      const vis = (1 - o) * n.alpha;
      if (n.shadowMat) n.shadowMat.uniforms.uFade.value = vis;
      if (n.glassMat && n.glass) {
        const flick = 0.9 + 0.1 * Math.sin(nowMs / 170 + i * 1.7) * Math.sin(nowMs / 410 + i);
        n.glassMat.opacity = Math.max(0, darkness - 0.15) * 1.1 * flick * vis;
        n.glass.visible = n.glassMat.opacity > 0.01;
      }
      if (n.glowMesh) {
        const gm = n.glowMesh.material as THREE.MeshBasicMaterial;
        gm.opacity = Math.max(0, darkness - 0.15) * 0.9 * vis;
        n.glowMesh.visible = gm.opacity > 0.01;
      }
    }
  }

  /** 실내를 보여 줄 외관 번호들 */
  revealedSet(): Set<number> {
    const out = new Set<number>();
    for (let i = 0; i < this.nodes.length; i++) if (this.nodes[i].reveal) out.add(i);
    return out;
  }

  /** 외관 번호 → 발자국 사각형 (칸) */
  footRect(i: number): [number, number, number, number] | null {
    const n = this.nodes[i];
    return n ? [n.place.x, n.place.y, n.place.x + n.def.foot[0] - 1, n.place.y + n.def.foot[1] - 1] : null;
  }

  /** 문 앞 칸 근처(발자국 아래 두 줄 안)나 발자국 안이면 그 외관 */
  nearDoor(x: number, y: number): number {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (['tower', 'gate', 'stairs'].includes(n.def.role)) continue;
      const fx = n.place.x, fy = n.place.y, fw = n.def.foot[0], fd = n.def.foot[1];
      if (x >= fx && x < fx + fw && y >= fy && y < fy + fd + 2) return i;
    }
    return -1;
  }

  get count(): number {
    return this.nodes.length;
  }
}
