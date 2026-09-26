/**
 * 직접 조작 (사용자 요청 2026-09-26): WASD 로 조작 인물을 걷게 하고, E 로 가까운 물건과 상호작용.
 * 키를 누르고 있는 동안 그 방향 몇 칸 앞을 목적지로 계속 갱신 (sim 'steer' 의도 → 입력 로그에 남음).
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
/** 방향을 다시 보내는 간격 (ms): 걷는 동안 목적지를 앞으로 밀어 줌 */
const RESEND_MS = 220;

export class DirectControl {
  private held = new Set<string>();
  private sent = '';
  private sentAt = 0;
  private moving = false;

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

  /** 매 프레임 */
  update(now: number): void {
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
    if (dx || dy) {
      if (key !== this.sent || now - this.sentAt >= RESEND_MS) {
        this.host.steer(id, dx, dy);
        this.sent = key;
        this.sentAt = now;
        if (!this.moving) this.host.follow();
        this.moving = true;
      }
    } else if (this.moving) {
      // 키를 떼면 그 자리에 섬
      this.host.steer(id, 0, 0);
      this.moving = false;
      this.sent = '';
    }
  }
}
