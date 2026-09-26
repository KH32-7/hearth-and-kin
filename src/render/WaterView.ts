/**
 * 물 (docs/07): 부지 전체를 덮는 판 하나에 셰이더로 흐르는 물. 바닥 청크가 물 칸을 비우고 물가를 강둑 모양으로 도려내면
 * 그 아래에서 이 물이 보임. 색은 06 팔레트 (얕은 물 #61aba4 → 깊은 물 #2e6b7b), 깊이 띠(픽셀 느낌),
 * 물결 반짝임, 물가 거품, 시간대 색(uAmbient). 픽셀은 세계 1px 격자에 맞춰 양자화
 */
import * as THREE from 'three';
import { globalLight } from './SpriteMaterial';

const vert = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = vec2(wp.x, -wp.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform sampler2D uMask;   // R 물, G 물가까지 거리(0~1), B 물 근처
  uniform vec2 uCells;       // 부지 칸 수
  uniform float uTile;
  uniform float uTime;
  uniform vec3 uAmbient;
  uniform float uNight;
  varying vec2 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    vec2 px = floor(vWorld);                        // 세계 1px 격자
    vec2 cell = px / uTile;
    vec2 uv = (clamp(cell, vec2(0.0), uCells - 0.001) + 0.0) / uCells;
    vec4 m = texture2D(uMask, uv);
    if (m.b < 0.5) discard;                          // 물 근처가 아니면 그리지 않음
    float depth = m.g;                               // 부드러운 깊이 (선형 보간)
    float band = floor(depth * 4.0 + noise(px * 0.05) * 0.6) / 4.0;   // 픽셀 느낌 깊이 띠
    vec3 shallow = vec3(0.384, 0.745, 0.686);        // #62beaf (06c)
    vec3 mid     = vec3(0.161, 0.463, 0.557);        // #29768e
    vec3 deep    = vec3(0.102, 0.310, 0.475);        // #1a4f79
    vec3 col = band < 0.5 ? mix(shallow, mid, band * 2.0) : mix(mid, deep, (band - 0.5) * 2.0);
    // 흐르는 물결: 두 겹 잡음을 흘려 밝은 줄만 남김
    float t = uTime;
    float w1 = noise(vec2(px.x * 0.045 + t * 0.35, px.y * 0.11 - t * 0.12));
    float w2 = noise(vec2(px.x * 0.09 - t * 0.22, px.y * 0.07 + t * 0.18) + 11.0);
    float crest = step(0.78, w1 * 0.6 + w2 * 0.5);
    col = mix(col, vec3(0.62, 0.84, 0.80), crest * 0.55);
    // 반짝임 (드문 점, 깜빡임)
    vec2 sc = floor(px / 3.0);
    float sp = hash(sc + floor(t * 1.6));
    col = mix(col, vec3(0.93, 0.97, 0.90), step(0.9965, sp) * (1.0 - uNight));
    // 물가 거품 띠 (강둑 가까이, 출렁임)
    float foam = 1.0 - smoothstep(0.0, 0.10 + 0.03 * sin(t * 1.3 + px.x * 0.08), depth);
    col = mix(col, vec3(0.80, 0.90, 0.84), step(0.55, foam) * 0.6);
    col *= uAmbient;
    // 밤: 달빛 반사 조금
    col += vec3(0.02, 0.04, 0.07) * uNight * crest;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WaterView {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.DataTexture | null = null;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: null },
        uCells: { value: new THREE.Vector2(1, 1) },
        uTile: { value: 32 },
        uTime: { value: 0 },
        uAmbient: globalLight.uAmbient,
        uNight: { value: 0 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.mesh.renderOrder = -1e6 - 10;
    this.mesh.visible = false;
  }

  /** 물 칸 배열로 마스크 다시 만듦. bounds = 판이 덮는 세계 px 범위 (부지 + 둘레) */
  rebuild(w: number, h: number, isWater: (x: number, y: number) => boolean, tile: number, bounds: { x0: number; y0: number; x1: number; y1: number }): void {
    const n = w * h;
    const water = new Uint8Array(n);
    let any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isWater(x, y)) {
      water[y * w + x] = 1;
      any = true;
    }
    this.mesh.visible = any;
    if (!any) return;
    // 물가까지 거리 (칸, 두 번 훑는 근사 거리 변환)
    const INF = 1e9;
    const dist = new Float32Array(n).fill(INF);
    for (let i = 0; i < n; i++) if (!water[i]) dist[i] = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
        if (y > 0) dist[i] = Math.min(dist[i], dist[i - w] + 1);
        if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - w - 1] + 1.4);
        if (x < w - 1 && y > 0) dist[i] = Math.min(dist[i], dist[i - w + 1] + 1.4);
      }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x < w - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
        if (y < h - 1) dist[i] = Math.min(dist[i], dist[i + w] + 1);
        if (x < w - 1 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w + 1] + 1.4);
        if (x > 0 && y < h - 1) dist[i] = Math.min(dist[i], dist[i + w - 1] + 1.4);
      }
    }
    const data = new Uint8Array(n * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let near = water[i];
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && water[ny * w + nx]) near = 1;
        }
        // DataTexture 행 0 = v 0. 셰이더가 칸 y / h 로 읽으므로 뒤집지 않음
        const o = (y * w + x) * 4;
        data[o] = water[i] * 255;
        data[o + 1] = Math.min(255, Math.round((Math.min(dist[i], 5) / 5) * 255));
        data[o + 2] = near * 255;
        data[o + 3] = 255;
      }
    }
    this.tex?.dispose();
    this.tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.flipY = false;
    this.tex.needsUpdate = true;
    this.mat.uniforms.uMask.value = this.tex;
    (this.mat.uniforms.uCells.value as THREE.Vector2).set(w, h);
    this.mat.uniforms.uTile.value = tile;
    const bw = bounds.x1 - bounds.x0;
    const bh = bounds.y1 - bounds.y0;
    this.mesh.scale.set(bw, bh, 1);
    this.mesh.position.set(bounds.x0 + bw / 2, -(bounds.y0 + bh / 2), 0);
  }

  update(nowMs: number, darkness: number): void {
    this.mat.uniforms.uTime.value = nowMs / 1000;
    this.mat.uniforms.uNight.value = darkness;
  }
}
