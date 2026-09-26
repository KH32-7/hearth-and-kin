/**
 * 날씨/분위기 파티클 (docs/07): GPU 점 하나 묶음, 화면 주변에서만 살아 있음 (세계 좌표).
 * - 낙엽: 가을 잎이 흔들리며 떨어짐 (06 단풍색)
 * - 먼지 알갱이: 햇빛 속 떠다니는 반짝임 (낮)
 * - 반딧불: 밤, 물가/풀밭에서 깜빡이며 떠다님 (광원 레이어에도 그려 주변을 조금 밝힘)
 * - 굴뚝 연기: 불 켠 화로 위 (WorldView 가 굴뚝 위치를 줌), 올라가며 퍼지고 옅어짐
 * 픽셀 크기는 세계 px 기준 (정수 배율에서 또렷)
 */
import * as THREE from 'three';

const vert = /* glsl */ `
  attribute vec4 aSeed;     // x,y 기준 위치, z 종류, w 난수
  uniform float uTime;
  uniform float uZoom;
  uniform vec4 uView;       // 화면 세계 범위 x0,y0,w,h
  uniform float uNight;
  varying vec4 vColor;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float kind = aSeed.z;
    float r = aSeed.w;
    float t = uTime;
    vec2 p;
    float size = 1.0;
    vec4 col = vec4(0.0);
    if (kind < 0.5) {
      // 낙엽: 화면 위에서 아래로, 좌우로 흔들림, 화면 범위 안에서 되풀이
      float speed = 14.0 + r * 10.0;
      float life = uView.w / speed + 2.0;
      float ph = fract(t / life + r * 7.13);
      p.x = uView.x + fract(aSeed.x + r * 3.1 + t * 0.004) * uView.z + sin(t * (1.4 + r) + r * 20.0) * 10.0;
      p.y = uView.y - 20.0 + ph * (uView.w + 40.0);
      size = 2.0;
      vec3 c = mix(vec3(0.651, 0.471, 0.165), vec3(0.886, 0.796, 0.431), hash(r * 91.0));
      c = mix(c, vec3(0.62, 0.22, 0.09), step(0.7, hash(r * 13.0)));
      col = vec4(c, (1.0 - uNight * 0.7) * 0.95);
    } else if (kind < 1.5) {
      // 먼지 알갱이 (낮): 천천히 떠오름, 깜빡임
      p.x = uView.x + fract(aSeed.x + t * 0.002 * (r - 0.5)) * uView.z;
      p.y = uView.y + fract(aSeed.y - t * 0.006 * (0.5 + r)) * uView.w;
      float tw = 0.5 + 0.5 * sin(t * (2.0 + r * 3.0) + r * 50.0);
      col = vec4(1.0, 0.97, 0.86, 0.3 * tw * (1.0 - uNight));
      size = 1.0;
    } else {
      // 반딧불 (밤): 제자리 근처 맴돎
      float ax = fract(aSeed.x + r * 0.37);
      float ay = fract(aSeed.y + r * 0.71);
      p.x = uView.x + ax * uView.z + sin(t * 0.7 + r * 30.0) * 18.0 + sin(t * 1.9 + r * 7.0) * 5.0;
      p.y = uView.y + ay * uView.w + cos(t * 0.6 + r * 40.0) * 12.0;
      float bl = smoothstep(0.2, 1.0, sin(t * (1.2 + r) + r * 60.0));
      col = vec4(1.0, 0.93, 0.45, bl * smoothstep(0.35, 0.8, uNight));
      size = 2.0;
    }
    vColor = col;
    gl_Position = projectionMatrix * viewMatrix * vec4(floor(p.x), -floor(p.y), 0.0, 1.0);
    gl_PointSize = size * uZoom;
  }
`;
const frag = /* glsl */ `
  varying vec4 vColor;
  void main() {
    if (vColor.a < 0.02) discard;
    gl_FragColor = vColor;
  }
`;

export class Particles {
  readonly points: THREE.Points;
  readonly glow: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private glowMat: THREE.ShaderMaterial;

  constructor(leaves = 10, motes = 24, flies = 45) {
    const n = leaves + motes + flies;
    const seed = new Float32Array(n * 4);
    let k = 0;
    const put = (kind: number, count: number) => {
      for (let i = 0; i < count; i++, k++) {
        seed[k * 4] = Math.random();
        seed[k * 4 + 1] = Math.random();
        seed[k * 4 + 2] = kind;
        seed[k * 4 + 3] = Math.random();
      }
    };
    put(0, leaves);
    put(1, motes);
    put(2, flies);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const uniforms = {
      uTime: { value: 0 },
      uZoom: { value: 2 },
      uView: { value: new THREE.Vector4(0, 0, 1, 1) },
      uNight: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8e6;
    // 반딧불만 광원 레이어로 한 번 더 (주변을 밝힘)
    this.glowMat = this.mat.clone();
    this.glowMat.uniforms = uniforms;
    this.glow = new THREE.Points(geo, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.layers.set(1);
  }

  update(nowMs: number, view: { x0: number; y0: number; x1: number; y1: number }, deviceZoom: number, darkness: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = nowMs / 1000;
    (u.uView.value as THREE.Vector4).set(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    u.uZoom.value = deviceZoom;
    u.uNight.value = darkness;
  }
}
