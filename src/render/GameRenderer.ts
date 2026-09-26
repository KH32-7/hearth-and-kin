/**
 * 2D 렌더러: 직교 카메라, 정수 배율 줌, 픽셀 반올림, 장치 픽셀 비율 보정 (BRIEF 1장, GDD 28-1).
 * 세계 좌표 = 세계 픽셀 (칸 × tilePx). three의 y는 위쪽이라 세계 y를 뒤집어 씀.
 */
import * as THREE from 'three';

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  /** 화면 배율 (CSS 픽셀 기준 정수) */
  zoom = 2;
  minZoom = 1;
  maxZoom = 4;
  /** 카메라 중심 (세계 픽셀) */
  camX = 0;
  camY = 0;
  worldW = 0;
  worldH = 0;
  /** 카메라가 보여 줄 수 있는 세계 범위 (부지 + 주변 땅) */
  bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** 세계 1px 이 장치 몇 px 인지 (정수) */
  deviceZoom = 2;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x1b1612, 1);
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -1000, 1000);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.applyCamera();
  }

  setWorldSize(w: number, h: number, bounds?: { x0: number; y0: number; x1: number; y1: number }): void {
    this.worldW = w;
    this.worldH = h;
    this.bounds = bounds ?? { x0: 0, y0: 0, x1: w, y1: h };
    this.clampCamera();
    this.applyCamera();
  }

  setZoom(z: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(z)));
    this.clampCamera();
    this.applyCamera();
  }

  pan(dxCss: number, dyCss: number): void {
    this.camX -= dxCss / this.zoom;
    this.camY -= dyCss / this.zoom;
    this.clampCamera();
    this.applyCamera();
  }

  centerOn(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
    this.clampCamera();
    this.applyCamera();
  }

  /** 세계가 화면보다 크면 경계 안에서만, 작으면 가운데 (지도 밖 빈 곳을 보여 주지 않음) */
  private clampCamera(): void {
    const cw = (this.canvas.clientWidth || window.innerWidth) / this.zoom;
    const ch = (this.canvas.clientHeight || window.innerHeight) / this.zoom;
    const { x0, y0, x1, y1 } = this.bounds;
    if (x1 - x0 <= cw) this.camX = (x0 + x1) / 2;
    else this.camX = Math.max(x0 + cw / 2, Math.min(x1 - cw / 2, this.camX));
    if (y1 - y0 <= ch) this.camY = (y0 + y1) / 2;
    else this.camY = Math.max(y0 + ch / 2, Math.min(y1 - ch / 2, this.camY));
  }

  /**
   * 장치 픽셀 기준 정수 배율로 맞춤: dpr이 1.25여도 세계 1픽셀 = 장치 정수 픽셀이 되게.
   * 카메라 위치도 장치 픽셀 격자에 맞춰 반올림 → 흐림 0
   */
  private applyCamera(): void {
    const dpr = this.renderer.getPixelRatio();
    const bufW = Math.round((this.canvas.clientWidth || window.innerWidth) * dpr);
    const bufH = Math.round((this.canvas.clientHeight || window.innerHeight) * dpr);
    this.deviceZoom = Math.max(1, Math.round(this.zoom * dpr));
    const halfW = bufW / 2 / this.deviceZoom;
    const halfH = bufH / 2 / this.deviceZoom;
    const snap = 1 / this.deviceZoom;
    // 버퍼 크기가 홀수면 반 픽셀 어긋나므로 중심을 보정
    const cx = Math.round(this.camX / snap) * snap + (bufW % 2 ? 0.5 / this.deviceZoom : 0);
    const cy = Math.round(this.camY / snap) * snap + (bufH % 2 ? 0.5 / this.deviceZoom : 0);
    this.camera.left = cx - halfW;
    this.camera.right = cx + halfW;
    this.camera.top = -cy + halfH;
    this.camera.bottom = -cy - halfH;
    this.camera.updateProjectionMatrix();
  }

  /** 지금 화면이 덮는 세계 범위 (px) */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    return { x0: this.camera.left, y0: -this.camera.top, x1: this.camera.right, y1: -this.camera.bottom };
  }

  /** CSS 좌표 → 세계 픽셀 */
  screenToWorld(cssX: number, cssY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.renderer.getPixelRatio();
    const bx = (cssX - rect.left) * dpr;
    const by = (cssY - rect.top) * dpr;
    const bufW = this.renderer.domElement.width;
    const bufH = this.renderer.domElement.height;
    const x = this.camera.left + (bx / bufW) * (this.camera.right - this.camera.left);
    const yUp = this.camera.top - (by / bufH) * (this.camera.top - this.camera.bottom);
    return { x, y: -yUp };
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const bufW = this.renderer.domElement.width;
    const bufH = this.renderer.domElement.height;
    const dpr = this.renderer.getPixelRatio();
    const bx = ((x - this.camera.left) / (this.camera.right - this.camera.left)) * bufW;
    const by = ((this.camera.top + y) / (this.camera.top - this.camera.bottom)) * bufH;
    return { x: rect.left + bx / dpr, y: rect.top + by / dpr };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

/** 세계 픽셀 → three 좌표에 스프라이트 사각형 배치 (왼쪽 위 기준) */
export function placeRect(mesh: THREE.Object3D, left: number, top: number, w: number, h: number): void {
  mesh.position.set(left + w / 2, -(top + h / 2), 0);
  mesh.scale.set(w, h, 1);
}
