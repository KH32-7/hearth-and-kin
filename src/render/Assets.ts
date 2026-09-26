/**
 * 이미지 로더 + 텍스처 캐시. 경로는 레포 루트 기준 (artifacts/contracts.md).
 * 개발 서버는 루트를 그대로 제공하고, 빌드는 vite 플러그인(tools/vite-assets.ts)이 참조된 파일을 복사함.
 */
import * as THREE from 'three';
import { pixelTexture } from './SpriteMaterial';

export class Assets {
  private images = new Map<string, Promise<HTMLImageElement>>();
  private textures = new Map<string, THREE.Texture>();
  failed: string[] = [];

  url(path: string): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return base + path.split('/').map(encodeURIComponent).join('/');
  }

  image(path: string): Promise<HTMLImageElement> {
    let p = this.images.get(path);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
          this.failed.push(path);
          reject(new Error(`이미지 로드 실패: ${path}`));
        };
        img.src = this.url(path);
      });
      this.images.set(path, p);
    }
    return p;
  }

  async texture(path: string): Promise<THREE.Texture> {
    const t = this.textures.get(path);
    if (t) return t;
    const img = await this.image(path);
    const tex = pixelTexture(img);
    this.textures.set(path, tex);
    return tex;
  }

  textureSync(path: string): THREE.Texture | undefined {
    return this.textures.get(path);
  }
}
