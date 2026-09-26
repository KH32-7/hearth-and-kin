/**
 * 렌더 후처리 (docs/07): 장면 → 렌더 타깃, 광원 레이어(1) → 광원 타깃(반 해상도), 합성 셰이더 한 번.
 * - 색 보정: 06c 화사하게 (명도·채도 조금 올림, 그늘 푸른 보라 / 밝은 곳 크림, 저녁·밤 남색 #383a49, 순흑·순백 없음)
 * - 광원: 불/촛불/등불/창문 빛이 밤에 주변을 밝힘 (알베도 × 빛, 따뜻한 공기 번짐)
 * - 구름 그림자: 세계 좌표 잡음이 천천히 흐름 (낮에만)
 * - 비네트, 옅은 대기
 * 끄기: ?fx=0 (픽셀 비교 테스트)
 */
import * as THREE from 'three';

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tLight;
  uniform vec4 uView;       // 세계 px: 왼쪽, 위, 너비, 높이
  uniform float uTime;
  uniform float uNight;     // 0 낮 ~ 1 밤
  uniform float uCool;      // 0 따뜻한 한낮 ~ 1 차가운 저녁/밤 그림자
  uniform float uGrade;     // 색 보정 세기
  uniform float uClouds;
  uniform vec4 uRoom;       // 실내 화면: 보이는 세계 사각형 (x0,y0,x1,y1 px), x1<x0 이면 끔
  uniform float uRoomK;     // 실내 화면 전환 (0 바깥 ~ 1 실내)
  uniform vec2 uLightTexel; // 빛 맵 한 칸 (uv)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.03 + 7.1) * 0.3 + noise(p * 4.1 + 3.3) * 0.15; }

  vec3 grade(vec3 c) {
    // 06c "화사하게" (docs/레퍼런스_이미지 README 조정안 2). 에셋은 이미 06c 램프로 칠해져 있어 여기서는 톤만:
    //  - 낮: 명도 조금 올림 (감마 0.9), 채도 있는 면만 채도 +12% (흰 판석/회색 돌은 그대로 → 누런끼 안 생김)
    //  - 밤: 들어 올리지 않음 (깊게 두어 불빛이 살게)
    //  - 어두운 칸은 푸른·보라 쪽, 밝은 칸은 따뜻한 크림 쪽으로 조금. 순흑/순백 없음
    vec3 h = rgb2hsv(c);
    // 저녁/밤은 채도를 눌러 차분하게 (00 저녁 광장 S≈32)
    h.y = min(1.0, h.y * (1.0 + 0.2 * smoothstep(0.25, 0.5, h.y) * (1.0 - uCool)) * mix(1.0, 0.7, uCool * (1.0 - uNight * 0.8)));
    vec3 o = hsv2rgb(h);
    // 낮은 더 밝고 화사하게 (사용자), 밤은 들어 올리지 않음
    o = pow(max(o, 0.0), vec3(mix(0.82, 1.05, uNight))) * mix(1.05, 1.0, uNight);
    float l = dot(o, vec3(0.299, 0.587, 0.114));
    vec3 shadowTint = mix(vec3(0.20, 0.21, 0.36), vec3(0.16, 0.17, 0.30), uCool);
    o = mix(o, o * 0.72 + shadowTint * 0.28, (1.0 - smoothstep(0.04, 0.32, l)) * 0.35);
    o = mix(o, o * vec3(1.0, 0.985, 0.9), smoothstep(0.62, 1.0, l) * 0.35);
    o = vec3(0.045, 0.025, 0.02) + o * 0.95;
    return mix(c, clamp(o, 0.0, 1.0), uGrade);
  }

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    c = grade(c);
    vec2 world = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;
    // 구름 그림자 (세계에 붙어 천천히 흐름)
    float cl = fbm(world / 380.0 + vec2(uTime * 0.012, uTime * 0.004));
    float cloud = smoothstep(0.56, 0.74, cl) * uClouds * (1.0 - uNight);
    c *= 1.0 - cloud * 0.1;
    // 광원: 알베도 × 빛 (밤에 셈), 따뜻한 공기 번짐
    // 빛 맵은 살짝 흐리게 (창문·등불 빛이 부드럽게 번지게, 사용자): 가운데 + 두 겹 고리 12곳
    vec3 L = texture2D(tLight, vUv).rgb * 0.28;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472;
      vec2 d1 = vec2(cos(a), sin(a)) * uLightTexel * 2.5;
      vec2 d2 = vec2(cos(a + 0.5236), sin(a + 0.5236)) * uLightTexel * 5.5;
      L += texture2D(tLight, vUv + d1).rgb * 0.075 + texture2D(tLight, vUv + d2).rgb * 0.045;
    }
    float gain = mix(0.35, 3.0, uNight);
    c = c * (1.0 + L * gain) + L * L * 0.10 * uNight;
    // 빛 구도: 해가 드는 쪽(왼쪽 위에서 비스듬히)으로 밝은 웅덩이 하나, 가장자리는 눌러 시선을 모음
    vec2 d = vUv - 0.5;
    d.x *= uView.z / uView.w;
    vec2 fc = vec2(-0.08, 0.06);
    float pool = 1.0 - smoothstep(0.05, 0.62, length(d - fc));
    c *= mix(1.0, 1.0 + 0.10 * pool, 1.0 - uNight) * mix(1.0, 0.9, (1.0 - pool) * (1.0 - uNight));
    float v = smoothstep(0.38, 1.0, length(d) * 1.25);
    c = mix(c, c * mix(vec3(0.82, 0.80, 0.78), vec3(0.62, 0.64, 0.78), uCool), v * 0.4);
    // 실내 화면 (스타듀식): 집 사각형 밖은 어둠, 구름/대기 없음
    if (uRoom.z > uRoom.x) {
      vec2 q = max(uRoom.xy - world, world - uRoom.zw);
      float out_ = step(0.0, max(q.x, q.y));
      // 실내 분위기: 방 가장자리(벽 쪽)로 갈수록 어둡고, 방 전체는 조금 따뜻하게. 밤엔 더 어둡게 해서 등불/화덕 빛이 살아남
      vec2 rc = (world - (uRoom.xy + uRoom.zw) * 0.5) / max((uRoom.zw - uRoom.xy) * 0.5, vec2(1.0));
      float edge = smoothstep(0.45, 1.05, length(rc * vec2(0.9, 1.0)));
      vec3 warm = mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.86, 0.72), uNight);
      c = mix(c, c * warm * (1.0 - edge * mix(0.22, 0.3, uNight)), (1.0 - out_) * uRoomK);
      c = mix(c, vec3(0.055, 0.04, 0.035), out_ * uRoomK);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class PostFX {
  enabled = true;
  private rt: THREE.WebGLRenderTarget;
  private lightRt: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly mat: THREE.ShaderMaterial;

  constructor() {
    const opts = { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: true };
    this.rt = new THREE.WebGLRenderTarget(4, 4, opts);
    this.lightRt = new THREE.WebGLRenderTarget(4, 4, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        tLight: { value: this.lightRt.texture },
        uView: { value: new THREE.Vector4(0, 0, 1, 1) },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uCool: { value: 0 },
        uGrade: { value: 1 },
        uClouds: { value: 1 },
        uRoom: { value: new THREE.Vector4(0, 0, -1, -1) },
        uRoomK: { value: 0 },
        uLightTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      },
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(q);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.rt.width !== size.x || this.rt.height !== size.y) {
      this.rt.setSize(size.x, size.y);
      this.lightRt.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
      (this.mat.uniforms.uLightTexel.value as THREE.Vector2).set(1 / Math.max(1, size.x >> 1), 1 / Math.max(1, size.y >> 1));
    }
    const u = this.mat.uniforms;
    (u.uView.value as THREE.Vector4).set(camera.left, -camera.top, camera.right - camera.left, camera.top - camera.bottom);
    u.uTime.value = performance.now() / 1000;
    // 1) 장면 (레이어 0)
    camera.layers.set(0);
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    // 2) 광원 (레이어 1), 검정 바탕에 더하기
    const prev = renderer.getClearColor(new THREE.Color());
    const prevA = renderer.getClearAlpha();
    camera.layers.set(1);
    renderer.setRenderTarget(this.lightRt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const bg = scene.background;
    scene.background = null;
    renderer.render(scene, camera);
    scene.background = bg;
    renderer.setClearColor(prev, prevA);
    camera.layers.set(0);
    // 3) 합성
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }

  /** 시간대 (0~1440분)와 어둠 → 차가운 그림자 정도 */
  setTime(minuteOfDay: number, darkness: number): void {
    const u = this.mat.uniforms;
    u.uNight.value = darkness;
    // 17시부터 저녁 톤, 7시까지 새벽 톤
    const m = minuteOfDay;
    const eve = Math.min(1, Math.max(0, (m - 1020) / 180));
    const morn = Math.min(1, Math.max(0, (420 - m) / 120));
    u.uCool.value = Math.max(darkness, eve * 0.8, morn * 0.7);
  }
}
