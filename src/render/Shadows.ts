/**
 * 실시간 그림자 (docs/07, README 영상 5 "스프라이트 찌그러뜨리기" 단계): 스프라이트 실루엣을 발 줄에서 뒤집어
 * 해 방향으로 기울이고 눌러 땅에 깖. 해가 돌면(시각) 기울기/길이가 바뀌고, 밤에는 사라짐.
 * 색은 반투명 적갈 (06 팔레트 그림자 #50280e, 검정 아님). 모든 그림자는 바닥 바로 위 한 층 (사람/물건 아래)
 */
import * as THREE from 'three';

/** 전역 해 (게임이 시각마다 갱신) */
export const sun = {
  uShear: { value: 0.6 },
  uSquash: { value: 0.45 },
  uAlpha: { value: 0.3 },
};

const vert = /* glsl */ `
  uniform vec4 uvRect;
  uniform float uShear;
  uniform float uSquash;
  uniform float uLen;       // 그림자 길이 배수 (건물/천막은 짧게)
  uniform float uBase;      // 발 줄 = 그림 아래에서 몇 분의 몇 (그림 아래 여백)
  uniform vec2 uDrop;       // 0 이 아니면 눕히지 않고 실루엣을 그만큼(px) 오른쪽 아래로 밀어 깖 (노점/수레: 차양 밑 그늘)
  varying vec2 vUv;
  varying float vT;
  varying float vTopV;
  void main() {
    vUv = vec2(uvRect.x + uv.x * uvRect.z, uvRect.y + uv.y * uvRect.w);
    vTopV = uvRect.y + uvRect.w; // 그림 윗끝 (위쪽 어디든 불투명하면 그 아래 땅은 그늘)
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float y0 = (modelMatrix * vec4(0.0, -0.5, 0.0, 1.0)).y;
    float h = (modelMatrix * vec4(0.0, 0.5, 0.0, 1.0)).y - y0;
    // 발 줄에서 위로 잰 높이 → 발 줄 아래로 눕힘 (발 아래 여백 픽셀은 그대로 제자리)
    float t = position.y + 0.5 - uBase;
    float feet = y0 + uBase * h;
    if (uDrop.x != 0.0 || uDrop.y != 0.0) {
      // 해 방향 그대로 (물건 그림자와 같은 기울기:길이 비율)
      wp.x += uDrop.x * uShear;
      wp.y -= uDrop.y * uSquash;
      vT = 0.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
      return;
    }
    wp.y = feet - max(t, 0.0) * h * uSquash * uLen + min(t, 0.0) * h;
    wp.x += max(t, 0.0) * h * uShear * uLen;
    vT = max(t, 0.0) / max(0.01, 1.0 - uBase);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const frag = /* glsl */ `
  uniform sampler2D map;
  uniform float uAlpha;
  uniform float uFade;
  uniform float uFill;      // 1 = 발 줄까지 채움 (나무는 0: 줄기와 잎 그림자 따로)
  uniform vec2 uTexel;      // 그림 한 픽셀 (uv)
  varying vec2 vUv;
  varying float vT;
  varying float vTopV;
  void main() {
    // 상자처럼 채움: 같은 세로줄에서 이 높이보다 위 어디든 불투명하면 그림자 (다리 사이 빈 곳 때문에 차양 그림자가 떨어져 뜨지 않게)
    float a = texture2D(map, vUv).a;
    if (uFill > 0.5) for (int k = 1; k < 16; k++) a = max(a, texture2D(map, vec2(vUv.x, mix(vUv.y, vTopV, float(k) / 15.0))).a);
    // 부드러운 가장자리 (레퍼런스: 그림자 끝이 번짐): 둘레 8곳 평균, 밑동 가까이는 선명하게
    vec2 o = uTexel * mix(1.0, 3.5, vT);
    float cov = step(0.5, a) * 0.36;
    cov += (step(0.5, texture2D(map, vUv + vec2(o.x, 0.0)).a) + step(0.5, texture2D(map, vUv - vec2(o.x, 0.0)).a)
          + step(0.5, texture2D(map, vUv + vec2(0.0, o.y)).a) + step(0.5, texture2D(map, vUv - vec2(0.0, o.y)).a)) * 0.1;
    cov += (step(0.5, texture2D(map, vUv + o).a) + step(0.5, texture2D(map, vUv - o).a)
          + step(0.5, texture2D(map, vUv + vec2(o.x, -o.y)).a) + step(0.5, texture2D(map, vUv + vec2(-o.x, o.y)).a)) * 0.06;
    if (cov < 0.02) discard;
    // 곱하기 그림자: 명도를 낮추며 색상은 노랑·주황 쪽, 채도는 오름 (README 가을 섬: 풀 H60 S78 V65 → 그늘 H52 S86 V50)
    // 밑동에서 멀어질수록 옅게 (딱딱한 판처럼 보이지 않게), 4단 픽셀 계단
    // 사용자 선호(이전 판): 길고 고른 그림자. 끝으로 갈수록 아주 조금만 옅게
    float fall = 1.0 - vT * 0.45;
    float k = uAlpha * uFade * fall * cov;
    gl_FragColor = vec4(mix(vec3(1.0), vec3(0.50, 0.50, 0.58), k * 2.0), 1.0);
  }
`;

function texelOf(tex: THREE.Texture, k: 'width' | 'height'): number {
  const im = tex.image as { width?: number; height?: number } | undefined;
  return 1 / Math.max(1, im?.[k] ?? 1024);
}

export function makeShadowMaterial(tex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uShear: sun.uShear,
      uSquash: sun.uSquash,
      uAlpha: sun.uAlpha,
      uFade: { value: 1 },
      uBase: { value: 0 },
      uLen: { value: 1 },
      uDrop: { value: new THREE.Vector2(0, 0) },
      uFill: { value: 0 },
      uTexel: { value: new THREE.Vector2(texelOf(tex, 'width'), texelOf(tex, 'height')) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    depthTest: false,
    depthWrite: false,
    // 아래로 뒤집어 눕히므로 삼각형 방향이 반대 → 양면
    side: THREE.DoubleSide,
  });
}

/** 그림자 판: 세로로 잘게 나눔 (발 줄에서 꺾이는 변환이 꼭짓점 4개 사이 직선 보간으로 뭉개지지 않게) */
export const shadowQuad = new THREE.PlaneGeometry(1, 1, 1, 96);

/** 바닥 위, 모든 스프라이트 아래 */
export const SHADOW_ORDER = -1e6 + 50;

/**
 * 시각(분)과 어둠 → 해: 아침엔 서쪽에서 빛 → 그림자가 오른쪽(동) 길게, 한낮 짧게 오른쪽 아래, 저녁엔 왼쪽 길게.
 * 06 레퍼런스처럼 빛은 대체로 왼쪽 위에서 (한낮 기울기 +0.35)
 */
export function setSun(minuteOfDay: number, darkness: number): void {
  const m = Math.min(1140, Math.max(330, minuteOfDay));
  const k = (m - 735) / 405; // -1 새벽 … 0 정오 … 1 해질녘
  // 아침: 오른쪽 아래로 길게, 한낮: 짧게 조금 오른쪽 아래, 저녁: 왼쪽 아래로 길게 (시간 따라 돌고 늘어남)
  // 레퍼런스처럼 빛은 왼쪽 위: 그림자는 주로 옆으로 눕고(밑동에 붙어 보임) 아래로는 조금만
  sun.uShear.value = 0.35 - k * 0.85;
  sun.uSquash.value = 0.2 + Math.abs(k) * 0.2;
  sun.uAlpha.value = 0.34 * Math.max(0, 1 - darkness * 1.4);
}


/**
 * 접지 그림자 (AO): 건물/물건 밑동을 따라 아래로 옅어지는 띠 (곱하기). 좌우 끝도 옅게.
 * 크기는 mesh.scale (w = 밑동 폭, h = 띠 높이)
 */
const aoFrag = /* glsl */ `
  uniform float uStrength;
  varying vec2 vUv2;
  void main() {
    float y = 1.0 - vUv2.y;          // 0 밑동 → 1 끝
    float x = abs(vUv2.x - 0.5) * 2.0;
    float k = (1.0 - y) * (1.0 - y) * (1.0 - smoothstep(0.75, 1.0, x));
    k = floor(k * 5.0 + 0.5) / 5.0;
    gl_FragColor = vec4(mix(vec3(1.0), vec3(0.52, 0.50, 0.68), k * uStrength), 1.0);
  }
`;
const aoVert = /* glsl */ `
  varying vec2 vUv2;
  void main() { vUv2 = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export function makeAoMaterial(strength = 0.8): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: strength } },
    vertexShader: aoVert,
    fragmentShader: aoFrag,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    depthTest: false,
    depthWrite: false,
  });
}
