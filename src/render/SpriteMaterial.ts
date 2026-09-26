/**
 * 스프라이트 재질: 한 장의 텍스처에서 사각 영역(uvRect)만 그림.
 * 모든 스프라이트가 전역 시간대 색(uAmbient)을 공유하고, 빛나는 것(불)은 emissive로 색 보정을 덜 받음.
 */
import * as THREE from 'three';

export const globalLight = {
  uAmbient: { value: new THREE.Color(1, 1, 1) },
};

const vertex = /* glsl */ `
  uniform vec4 uvRect;
  varying vec2 vUv;
  void main() {
    vUv = vec2(uvRect.x + uv.x * uvRect.z, uvRect.y + uv.y * uvRect.w);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uAmbient;
  uniform float uEmissive;
  uniform float uOpacity;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(map, vUv);
    if (c.a < 0.01) discard;
    vec3 lit = mix(c.rgb * uAmbient, c.rgb, uEmissive) * uTint;
    gl_FragColor = vec4(lit, c.a * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function makeSpriteMaterial(tex: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uAmbient: globalLight.uAmbient,
      uEmissive: { value: 0 },
      uOpacity: { value: 1 },
      uTint: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/** 픽셀 사각형 → uvRect (텍스처 y는 아래에서 위) */
export function setUvRect(mat: THREE.ShaderMaterial, texW: number, texH: number, x: number, y: number, w: number, h: number): void {
  const v = mat.uniforms.uvRect.value as THREE.Vector4;
  v.set(x / texW, 1 - (y + h) / texH, w / texW, h / texH);
}

export function pixelTexture(img: CanvasImageSource & { width: number; height: number }): THREE.Texture {
  const tex = img instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas)
    ? new THREE.CanvasTexture(img as HTMLCanvasElement)
    : new THREE.Texture(img as HTMLImageElement);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // 픽셀 값을 그대로 보존 (렌더러 outputColorSpace = Linear와 짝). 팔레트 검사가 바이트 단위로 맞음
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const outlineFragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec4 inner;
  uniform vec2 texel;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  float alphaAt(vec2 p) {
    if (p.x < inner.x || p.y < inner.y || p.x > inner.z || p.y > inner.w) return 0.0;
    return texture2D(map, p).a;
  }
  void main() {
    if (alphaAt(vUv) > 0.5) discard;
    float n = max(max(alphaAt(vUv + vec2(texel.x, 0.0)), alphaAt(vUv - vec2(texel.x, 0.0))),
                  max(alphaAt(vUv + vec2(0.0, texel.y)), alphaAt(vUv - vec2(0.0, texel.y))));
    if (n < 0.5) discard;
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }
`;

/**
 * 물건 외곽선 (마우스를 올린 상호작용 물건): 스프라이트 사각형보다 1px 큰 판에 불투명 픽셀 바로 바깥 한 줄만 칠함.
 * rect = 원래 스프라이트 픽셀 사각형 (텍스처 좌표, 위에서 아래)
 */
export function makeOutlineMaterial(tex: THREE.Texture, texW: number, texH: number, rect: { x: number; y: number; w: number; h: number }, color: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      inner: { value: new THREE.Vector4(rect.x / texW, 1 - (rect.y + rect.h) / texH, (rect.x + rect.w) / texW, 1 - rect.y / texH) },
      texel: { value: new THREE.Vector2(1 / texW, 1 / texH) },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: outlineFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  setUvRect(mat, texW, texH, rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
  return mat;
}
