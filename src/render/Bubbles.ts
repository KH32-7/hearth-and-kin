/**
 * 머리 위 연출 (글자 대신 그림으로 보여 주기):
 * - 새 행동 시작: 행동 아이콘 말풍선이 톡 튀어나왔다가 사라짐
 * - 수다/연주 등 교류·재미 행동 중: 말풍선 아이콘이 번갈아 깜박임
 * - 잠: Z 아이콘이 천천히 떠오르며 사라짐
 * - 욕구 위급: 붉게 깜박이는 생각 풍선 (그 욕구 아이콘)
 * - 쓰러짐: 기력 아이콘이 머리 위에서 흔들림
 * - 대화 (M3): 말하는 사람과 듣는 사람이 번갈아 주제 아이콘 (14-3 주제 말풍선). 먹거나 쉬며 나누는 잡담은 작은 풍선
 * - 대화가 끝나면 결과가 떠오름: 성공은 금 하트(로맨스는 붉은 하트), 실패/짓궂음은 💢
 * 풍선 바탕은 Cute Fantasy 색 말풍선 (색 = 종류, GDD 27-12): 베이지 새 행동, 파랑 대화 주제·맞장구, 분홍 로맨스,
 * 빨강 위급 욕구, 초록 좋은 결과, 노랑 감정. 아틀라스에 없으면 예전처럼 slot.cream + 찍은 꼬리.
 * 감정 효과 (Elthen 32px 8프레임): 말풍선 없이 머리 바로 위에서 움직임. 그림 영역 아랫변을 머리 꼭대기 2px 위에 맞춤.
 * 모두 정수 픽셀 위치.
 */
import { emoteFrame } from '../ui/skin';
import * as THREE from 'three';
import type { PersonSnap } from '../sim/protocol';
import type { Assets } from './Assets';
import { placeRect, staticGroup } from './GameRenderer';
import { makeSpriteMaterial, pixelTexture, setUvRect } from './SpriteMaterial';

interface AtlasSprite {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleRules {
  /** 계속 말풍선을 띄우는 행동 (id → 번갈아 보일 아이콘들) */
  talk: Record<string, string[]>;
  /** 위급으로 보는 욕구 값 */
  critical: number;
  /** 새 행동 말풍선 표시 시간(ms) */
  popMs: number;
  /** Z 하나가 떠오르는 시간(ms)과 간격 */
  zzzLifeMs: number;
  zzzEveryMs: number;
  /** 욕구 → 그 욕구를 채우는 행동 아이콘들 (위급 풍선을 띄울지 판단) */
  solves: Record<string, string[]>;
}

interface Quad {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

type BubbleColor = 'beige' | 'grey' | 'green' | 'blue' | 'yellow' | 'red' | 'pink';

/** 감정 효과 (Elthen 줄 이름): 한 번 재생 또는 상태 동안 반복 */
interface EmoteFx {
  q: Quad;
  name: string;
  born: number;
  loop: boolean;
}

interface PersonFx {
  emote: EmoteFx | null;
  bubble: Quad;
  icon: Quad;
  lastAction: string;
  popStart: number;
  popIcon: string;
  lastEmotion: string;
  zzz: { q: Quad; born: number }[];
  lastZ: number;
  puffs: { q: Quad; born: number }[];
  lastSocial: string;
  /** M4 사건 연출 (퇴근 동전, 수확물, 솜씨 오름, 좋은 물건) 마지막 키 */
  lastEvt: Record<string, string>;
  seen: number;
}

/** 사회 상호작용 표시 정보 (social.json 에서) */
export interface SocialInfo {
  icon: string;
  category: string;
}

const quad = new THREE.PlaneGeometry(1, 1);
const ORDER = 2e7;
const TAIL = 4;
const PUFF_MS = 1500;
/** 한 번짜리 감정 효과 길이 (8프레임 두 바퀴) */
const EMOTE_MS = 2000;
/** 감정이 바뀔 때 머리 위 효과 (GDD 27-12). 없으면 예전 감정 아이콘 풍선 */
const EMO_EMOTE: Record<string, string> = {
  happy: 'sparkle', energized: 'sparkle', inspired: 'sparkle', excited: 'hearts', pious: 'heal',
  sad: 'sweat', angry: 'shock', tense: 'question', ashamed: 'sweat', focused: 'talk',
};

export class Bubbles {
  readonly group = staticGroup();
  private tex: THREE.Texture | null = null;
  private bubbleTex: THREE.Texture | null = null;
  private bubbleW = 26;
  private bubbleH = 26 + TAIL;
  /** Cute 색 말풍선을 아틀라스에서 씀 (몸통 24x26 + 꼬리 5) */
  private cute = false;
  private bodyH = 26;
  private texW = 1;
  private texH = 1;
  private fx = new Map<number, PersonFx>();

  constructor(
    private atlas: { image: string; sprites: Record<string, AtlasSprite> } | null,
    private rules: BubbleRules,
    private iconOf: (interactionId: string) => string,
    private socialInfo: (interactionId: string) => SocialInfo | null = () => null,
  ) {}

  private frame = 0;

  async load(assets: Assets): Promise<void> {
    if (!this.atlas) return;
    const img = await assets.image(this.atlas.image);
    this.texW = img.width;
    this.texH = img.height;
    this.tex = pixelTexture(img);
    if (this.atlas.sprites['bubble.beige']) {
      this.cute = true;
      this.bubbleTex = this.tex;
      this.bubbleW = 24;
      this.bubbleH = 31;
      this.bodyH = 26;
      return;
    }
    // 풍선 바탕: 칸 그림 + 아래 가운데 꼬리 (칸 테두리/안쪽 색을 그대로 뽑아 씀)
    const s = this.atlas.sprites['slot.cream'];
    if (s) {
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h + TAIL;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
      const px = (x: number, y: number) => {
        const d = g.getImageData(x, y, 1, 1).data;
        return `rgba(${d[0]},${d[1]},${d[2]},${d[3] / 255})`;
      };
      const edge = px(Math.floor(s.w / 2), s.h - 1);
      const fill = px(Math.floor(s.w / 2), Math.floor(s.h / 2));
      const cx = Math.floor(s.w / 2);
      for (let i = 0; i < TAIL; i++) {
        const half = TAIL - i;
        g.fillStyle = edge;
        g.fillRect(cx - half - 1, s.h - 2 + i, half * 2 + 2, 1);
        g.fillStyle = fill;
        if (half > 1) g.fillRect(cx - half, s.h - 2 + i, half * 2, 1);
      }
      g.fillStyle = edge;
      g.fillRect(cx - 1, s.h - 2 + TAIL, 2, 1);
      this.bubbleTex = pixelTexture(c);
      this.bubbleW = c.width;
      this.bubbleH = c.height;
    }
  }

  private makeQuad(tex: THREE.Texture): Quad {
    const mat = makeSpriteMaterial(tex);
    // 머리 위 연출은 시간대 색 보정을 받지 않음 (밤에도 읽힘)
    mat.uniforms.uEmissive.value = 1;
    const mesh = new THREE.Mesh(quad, mat);
    mesh.renderOrder = ORDER;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, mat };
  }

  private setIcon(q: Quad, key: string): boolean {
    const s = this.atlas?.sprites[key];
    if (!s) return false;
    setUvRect(q.mat, this.texW, this.texH, s.x, s.y, s.w, s.h);
    return true;
  }

  private fxFor(id: number): PersonFx | null {
    if (!this.tex || !this.bubbleTex) return null;
    let f = this.fx.get(id);
    if (!f) {
      f = {
        emote: null,
        bubble: this.makeQuad(this.bubbleTex),
        icon: this.makeQuad(this.tex),
        lastAction: '',
        popStart: -1e9,
        popIcon: '',
        lastEmotion: 'neutral',
        zzz: [],
        lastZ: 0,
        puffs: [],
        lastSocial: '',
        lastEvt: {},
        seen: 0,
      };
      this.fx.set(id, f);
    }
    return f;
  }

  /**
   * @param head 사람별 머리 위 기준점(세계 px, 정수) — 없으면 숨김
   */
  update(persons: PersonSnap[], head: (id: number) => { x: number; y: number } | null, now: number): void {
    const r = this.rules;
    const frame = ++this.frame;
    const byId = new Map<number, PersonSnap>();
    for (const p of persons) byId.set(p.id, p);
    for (const p of persons) {
      const f = this.fxFor(p.id);
      if (!f) return;
      f.seen = frame;
      const h = head(p.id);
      // 대화 결과가 새로 나오면 양쪽 머리 위에서 떠오름
      const ls = p.lastSocial;
      const lsKey = ls ? `${ls.minute}:${ls.ia}:${ls.target}` : '';
      if (lsKey && lsKey !== f.lastSocial) {
        if (f.lastSocial || now > 1500) this.socialPuff(p, byId.get(ls!.target) ?? null, ls!.ok, ls!.ia, now);
        f.lastSocial = lsKey;
      }
      // M4: 퇴근해 돌아오면 동전, 수확하면 그 작물, 솜씨가 오르면 그 스킬 아이콘, 좋은 물건(품질 3+)이면 금 하트
      this.evtPuff(p, f, 'work', p.lastWork ? `${p.lastWork.minute}` : '', p.lastWork && p.lastWork.wage > 0 ? 'ui.coin' : '', now);
      this.evtPuff(p, f, 'harvest', p.lastHarvest ? `${p.lastHarvest.minute}` : '', p.lastHarvest ? this.itemIcon(p.lastHarvest.item) : '', now);
      this.evtPuff(p, f, 'skill', p.lastSkillUp ? `${p.lastSkillUp.minute}:${p.lastSkillUp.skill}` : '', p.lastSkillUp ? this.skillIcon(p.lastSkillUp.skill) : '', now);
      this.evtPuff(p, f, 'craft', p.lastCraft ? `${p.lastCraft.minute}` : '', p.lastCraft && p.lastCraft.quality >= 3 ? 'fx.social_ok' : '', now);
      const actionId = p.action?.interactionId ?? '';
      if (actionId && actionId !== f.lastAction && !p.sleeping) {
        f.popStart = now;
        f.popIcon = this.iconOf(actionId);
      }
      f.lastAction = actionId;
      // 감정이 바뀌면 그 감정 아이콘이 톡 (기본 단계 이상)
      const emo = p.inner && p.inner.stage >= 1 ? p.inner.emotion : 'neutral';
      if (emo !== f.lastEmotion) {
        if (emo !== 'neutral' && !p.sleeping) {
          const em = EMO_EMOTE[emo];
          if (em && this.hasEmotes()) this.emote(f, em, now, false);
          else {
            f.popStart = now;
            f.popIcon = `emo.${emo}`;
          }
        }
        f.lastEmotion = emo;
      }

      // 무엇을 띄울지 (우선순위: 쓰러짐 > 위급 욕구 > 대화 > 새 행동)
      let icon = '';
      let color: BubbleColor = 'beige';
      let tint: [number, number, number] = [1, 1, 1];
      let scale = 1;
      let bob = 0;
      const t = now / 1000;
      if (h && !p.hidden && !p.sleeping) {
        const critNeed = Object.entries(p.needs).filter(([, v]) => v < r.critical).sort((a, b) => a[1] - b[1])[0];
        const conv = this.conversation(p, byId, t);
        if (p.collapsed && this.hasEmotes()) {
          this.emote(f, 'stun', now, true);
        } else if (p.collapsed) {
          icon = 'need.energy';
          bob = Math.round(Math.sin(t * 3) * 1.5);
        } else if (critNeed && !(p.action && this.iconOf(p.action.interactionId) && this.solves(p, critNeed[0]))) {
          icon = `need.${critNeed[0]}`;
          color = 'red';
          // 깜박임 (0.5초 간격, 계단식)
          const on = Math.floor(t * 2) % 2 === 0;
          tint = this.cute ? [1, 1, 1] : on ? [1, 0.55, 0.5] : [1, 1, 1];
          bob = on ? -1 : 0;
        } else if (conv) {
          // 말 주고받기: 자기 차례에만 풍선이 뜨고, 뜰 때 한 번 톡 튀어 오름
          if (conv.icon) {
            icon = conv.icon;
            color = icon === 'topic.love' ? 'pink' : 'blue';
            scale = conv.small ? 0.75 : conv.k < 0.1 ? 0.75 : 1;
            bob = conv.k < 0.1 ? 2 : Math.floor(t * 3) % 2 === 0 ? 0 : -1;
          }
        } else if (now - f.popStart < r.popMs) {
          icon = f.popIcon;
          color = icon.startsWith('emo.') ? 'yellow' : 'beige';
          // 톡: 0→1.25→1 로 커졌다가 마지막 20% 동안 줄어듦 (정수 배율 대신 2단계 크기)
          const k = (now - f.popStart) / r.popMs;
          scale = k < 0.12 ? 0.75 : k > 0.85 ? 0.75 : 1;
          bob = k < 0.12 ? 2 : 0;
        }
      }
      if (icon && h && this.setIcon(f.icon, icon)) {
        const bw = Math.round(this.bubbleW * scale);
        const bh = Math.round(this.bubbleH * scale);
        // Cute 말풍선: 꼬리 끝(x=14.5)을 머리 가운데에, 꼬리 끝이 머리 꼭대기 4px 위
        const left = this.cute ? Math.round(h.x - 14.5 * scale) : Math.round(h.x - bw / 2);
        const bottom = Math.round(h.y + bob - (this.cute ? 4 : 0));
        if (this.cute) {
          const sp = this.atlas!.sprites[`bubble.${color}`] ?? this.atlas!.sprites['bubble.beige'];
          setUvRect(f.bubble.mat, this.texW, this.texH, sp.x, sp.y, sp.w, sp.h);
        }
        placeRect(f.bubble.mesh, left, bottom - bh, bw, bh);
        const iw = Math.round(16 * scale);
        const iconTop = this.cute ? bottom - bh + Math.round(((this.bodyH - 16) / 2 - 1) * scale) : Math.round(bottom - bh + (this.bubbleH - TAIL - 16) / 2 * scale);
        placeRect(f.icon.mesh, this.cute ? left + Math.round(4 * scale) : Math.round(h.x - iw / 2), iconTop, iw, iw);
        f.icon.mat.uniforms.uTint.value.setRGB(...tint);
        f.bubble.mesh.visible = true;
        f.icon.mesh.visible = true;
      } else {
        f.bubble.mesh.visible = false;
        f.icon.mesh.visible = false;
      }

      // 상태 감정 효과: 잠(Z), 추움(입김). Elthen 이 없으면 예전 Zzz
      if (h && !p.hidden && !p.collapsed && this.hasEmotes()) {
        if (p.sleeping) this.emote(f, 'sleep', now, true);
        else if ((p.needs.warmth ?? 100) < 20) this.emote(f, 'breath', now, true);
        else if (f.emote?.loop) f.emote.loop = false;
      }
      this.updateEmote(f, h, now, f.bubble.mesh.visible ? f.bubble.mesh : null, p.hidden);
      // Zzz: 잘 때 일정 간격으로 하나씩 떠오름
      if (!this.hasEmotes() && p.sleeping && h && !p.hidden && now - f.lastZ > r.zzzEveryMs) {
        f.lastZ = now;
        const q = f.zzz.find((z) => now - z.born > r.zzzLifeMs)?.q ?? this.makeQuad(this.tex!);
        f.zzz = f.zzz.filter((z) => z.q !== q);
        this.setIcon(q, 'sleep');
        f.zzz.push({ q, born: now });
      }
      this.updatePuffs(f, h, now);
      for (const z of f.zzz) {
        const age = (now - z.born) / r.zzzLifeMs;
        if (age >= 1 || !h || !p.sleeping) {
          z.q.mesh.visible = false;
          continue;
        }
        const rise = Math.round(age * 22);
        const sway = Math.round(Math.sin(age * Math.PI * 2) * 3);
        const size = age < 0.3 ? 8 : 16;
        placeRect(z.q.mesh, Math.round(h.x + 6 + sway), Math.round(h.y - 4 - rise - size), size, size);
        z.q.mat.uniforms.uOpacity.value = age > 0.7 ? Math.round((1 - age) / 0.3 * 4) / 4 : 1;
        z.q.mesh.visible = true;
      }
    }
    this.prune();
  }

  /**
   * 대화 차례: 말 거는 사람(A)과 붙잡힌 사람(B)이 1.4초씩 번갈아 말함. 자기 차례 1.1초 동안만 풍선.
   * A 는 주제 아이콘 → 상호작용 아이콘 순서로, B 는 같은 주제(맞장구) 또는 교류 아이콘.
   * 멀티태스킹 잡담(먹거나 쉬며)은 3초 주기, 작은 풍선
   */
  private conversation(p: PersonSnap, byId: Map<number, PersonSnap>, t: number): { icon: string; k: number; small: boolean } | null {
    const r = this.rules;
    const aid = p.action?.interactionId ?? '';
    const speaking = aid && p.action?.phase === 'perform' ? this.socialInfo(aid) : null;
    let speaker: PersonSnap | null = null;
    if (speaking) speaker = p;
    else if (p.talkingWith) {
      const q = byId.get(p.talkingWith);
      if (q?.action && q.action.phase === 'perform' && this.socialInfo(q.action.interactionId)) speaker = q;
    }
    if (speaker) {
      const turn = 1.4;
      const slot = Math.floor(t / turn) % 2;
      const k = (t % turn) / turn;
      const mine = (speaker === p) === (slot === 0);
      if (!mine || k > 0.8) return { icon: '', k, small: false };
      const said = Math.floor(t / (turn * 2));
      const topic = speaker.topic ? `topic.${speaker.topic}` : '';
      const topicKey = topic === 'topic.food' ? 'stew' : topic === 'topic.gossip' ? 'eye' : topic;
      if (speaker === p) {
        const sid = speaker.action!.interactionId;
        const list = [...(topicKey ? [topicKey] : []), ...(r.talk[sid] ?? [this.socialInfo(sid)!.icon, 'social'])];
        return { icon: list[said % list.length], k, small: false };
      }
      const listen = topicKey && said % 2 === 0 ? topicKey : (r.talk.__listen?.[0] ?? 'social');
      return { icon: listen, k, small: false };
    }
    if (p.chatWith) {
      const q = byId.get(p.chatWith);
      if (!q) return null;
      const turn = 3;
      const slot = Math.floor(t / turn) % 2;
      const k = (t % turn) / turn;
      const mine = (p.id < q.id) === (slot === 0);
      if (!mine || k > 0.4) return { icon: '', k: 1, small: true };
      const list = r.talk.__chat ?? ['social', 'need.fun'];
      return { icon: list[Math.floor(t / (turn * 2)) % list.length], k: k / 0.4, small: true };
    }
    return null;
  }

  /** 아이콘 키 찾기 (HearthGame 이 품목/스킬 정의로 채움) */
  itemIcon: (id: string) => string = (id) => `item.${id}`;
  skillIcon: (id: string) => string = () => 'emo.inspired';

  private evtPuff(p: PersonSnap, f: PersonFx, kind: string, key: string, icon: string, now: number): void {
    if (!key || key === f.lastEvt[kind]) return;
    const first = f.lastEvt[kind] === undefined;
    f.lastEvt[kind] = key;
    if (first && now < 1500) return;
    if (!icon) return;
    const q = f.puffs.find((z) => now - z.born > PUFF_MS)?.q ?? this.makeQuad(this.tex!);
    f.puffs = f.puffs.filter((z) => z.q !== q);
    if (!this.setIcon(q, icon)) return;
    f.puffs.push({ q, born: now });
    void p;
  }

  /** 대화 결과 연출: 성공 = 금 하트(로맨스는 붉은 하트)가 양쪽에서, 짓궂은 성공은 상대에게 💢, 실패는 건 사람에게 💢 */
  private socialPuff(p: PersonSnap, target: PersonSnap | null, ok: boolean, ia: string, now: number): void {
    const cat = this.socialInfo(ia)?.category ?? 'friendly';
    const add = (who: PersonSnap | null, icon: string) => {
      if (!who) return;
      const f = this.fxFor(who.id);
      if (!f) return;
      const q = f.puffs.find((z) => now - z.born > PUFF_MS)?.q ?? this.makeQuad(this.tex!);
      f.puffs = f.puffs.filter((z) => z.q !== q);
      if (!this.setIcon(q, icon)) return;
      f.puffs.push({ q, born: now });
    };
    if (this.hasEmotes()) {
      const fx = (who: PersonSnap | null, name: string) => {
        const f = who && this.fxFor(who.id);
        if (f) this.emote(f, name, now, false);
      };
      if (!ok) fx(p, 'shock');
      else if (cat === 'mean') fx(target, 'shock');
      else {
        const h = cat === 'romance' ? 'hearts' : 'heart';
        fx(p, h);
        fx(target, h);
      }
      return;
    }
    if (!ok) {
      add(p, 'emo.angry');
      return;
    }
    if (cat === 'mean') {
      add(target, 'emo.angry');
      return;
    }
    const heart = cat === 'romance' ? 'topic.love' : 'fx.social_ok';
    add(p, heart);
    add(target, heart);
  }

  private updatePuffs(f: PersonFx, h: { x: number; y: number } | null, now: number): void {
    for (const z of f.puffs) {
      const age = (now - z.born) / PUFF_MS;
      if (age >= 1 || !h) {
        z.q.mesh.visible = false;
        continue;
      }
      // 톡 커졌다가 위로 떠오르며 사라짐 (계단식 크기/투명도: 픽셀이 뭉개지지 않게)
      const size = age < 0.08 ? 8 : age < 0.16 ? 24 : 16;
      const rise = Math.round(age * 26);
      placeRect(z.q.mesh, Math.round(h.x - size / 2 + 12), Math.round(h.y - 8 - rise - size), size, size);
      z.q.mat.uniforms.uOpacity.value = age > 0.7 ? Math.round(((1 - age) / 0.3) * 4) / 4 : 1;
      z.q.mesh.visible = true;
    }
  }

  /** 이 사람 머리 위 풍선의 윗변(세계 px). 풍선이 없으면 null */
  topOf(id: number): number | null {
    const f = this.fx.get(id);
    if (!f || !f.bubble.mesh.visible) return null;
    return Math.round(-f.bubble.mesh.position.y - f.bubble.mesh.scale.y / 2);
  }

  /** 스냅샷에서 사라진 사람(돌아간 손님)의 연출 숨기기 */
  prune(): void {
    for (const [id, f] of this.fx) {
      if (f.seen === this.frame) continue;
      for (const q of [f.bubble, f.icon, ...f.zzz.map((z) => z.q), ...f.puffs.map((z) => z.q), ...(f.emote ? [f.emote.q] : [])]) {
        this.group.remove(q.mesh);
        q.mat.dispose();
      }
      this.fx.delete(id);
    }
  }

  private emotesOk: boolean | null = null;
  private hasEmotes(): boolean {
    if (this.emotesOk === null) this.emotesOk = !!this.atlas?.sprites['emote.sheet'] && !!emoteFrame('heart', 0);
    return this.emotesOk;
  }

  /** 감정 효과 시작 (같은 효과가 돌고 있으면 그대로) */
  private emote(f: PersonFx, name: string, now: number, loop: boolean): void {
    if (!this.tex || !this.hasEmotes()) return;
    if (f.emote && f.emote.name === name && (loop || now - f.emote.born < EMOTE_MS)) {
      f.emote.loop = loop;
      return;
    }
    const q = f.emote?.q ?? this.makeQuad(this.tex);
    f.emote = { q, name, born: now, loop };
  }

  /** 8프레임 (8fps). 한 번짜리는 EMOTE_MS 뒤 사라짐. 말풍선이 떠 있으면 그 오른쪽 위 */
  private updateEmote(f: PersonFx, h: { x: number; y: number } | null, now: number, bubble: THREE.Mesh | null, hidden: boolean): void {
    const e = f.emote;
    if (!e) return;
    const age = now - e.born;
    if (!h || hidden || (!e.loop && age > EMOTE_MS)) {
      e.q.mesh.visible = false;
      if (!e.loop && age > EMOTE_MS) f.emote = null;
      return;
    }
    const fr = emoteFrame(e.name, Math.floor(age / 125));
    if (!fr) return;
    setUvRect(e.q.mat, this.texW, this.texH, fr.sx, fr.sy, 32, 32);
    const [x0, , x1, y1] = fr.box;
    let ax = h.x;
    let ay = h.y - 2;
    if (bubble) {
      ax = Math.round(bubble.position.x + bubble.scale.x / 2 + 6);
      ay = Math.round(-bubble.position.y - bubble.scale.y / 2 + 8);
    }
    placeRect(e.q.mesh, Math.round(ax - (x0 + x1) / 2), Math.round(ay - y1), 32, 32);
    e.q.mesh.visible = true;
  }

  /** 지금 하는 행동이 그 욕구를 채우는지 (행동 아이콘 키로 판단, src/data/fx.json) */
  private solves(p: PersonSnap, need: string): boolean {
    const icon = p.action ? this.iconOf(p.action.interactionId) : '';
    return (this.rules.solves[need] ?? []).includes(icon);
  }
}
