/**
 * 직접 조작 (사용자 요청 2026-09-26): WASD 로 조작 인물을 일반 2D 게임처럼 바로 움직이고, E 로 가까운 물건과 상호작용.
 * 누른 방향이 바뀔 때만 sim 'steer' 의도를 보냄 (대기열에 "여기로 가기"를 쌓지 않음). 실제 이동은 워커가 실제 시간으로.
 * 카메라 이동은 방향키, 실내 보기 전환은 V.
 */
export interface DirectHost {
  /** 조작 인물 (없으면 null) */
  selectedId(): number | null;
  /** 입력을 받으면 안 되는 상태 (건축 모드, 수첩/대사창/원형 메뉴가 열림) */
  blocked(): boolean;
  steer(personId: number, dx: number, dy: number): void;
  /** 가까운 물건(없으면 사람) 원형 메뉴 */
  interactNearest(): void;
  /** 카메라가 조작 인물을 따라가게 */
  follow(): void;
}

const DIRS: Record<string, [number, number]> = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };

export class DirectControl {
  private held = new Set<string>();
  private sent = '0,0';

  constructor(private host: DirectHost) {}

  /** 키 눌림. 처리했으면 true */
  keyDown(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (k in DIRS) {
      if (this.host.blocked()) return false;
      this.held.add(k);
      return true;
    }
    if (k === 'e') {
      if (this.host.blocked() || e.repeat) return false;
      this.host.interactNearest();
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.held.delete(e.key.toLowerCase());
  }

  /** 창이 포커스를 잃으면 눌린 키를 모두 뗀 것으로 */
  reset(): void {
    this.held.clear();
  }

  /** 매 프레임: 누른 방향이 바뀌었으면 한 번 보냄 */
  update(_now: number): void {
    const id = this.host.selectedId();
    let dx = 0;
    let dy = 0;
    for (const k of this.held) {
      dx += DIRS[k][0];
      dy += DIRS[k][1];
    }
    dx = Math.sign(dx);
    dy = Math.sign(dy);
    if (id === null) return;
    const key = `${dx},${dy}`;
    if (key === this.sent) return;
    if (this.sent === '0,0') this.host.follow();
    this.host.steer(id, dx, dy);
    this.sent = key;
  }
}
