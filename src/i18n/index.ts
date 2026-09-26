/**
 * 한국어 문자열: src/i18n/ko/*.json 을 모두 합침 (ui, inner, thoughts, traits …).
 * 키가 없으면 키 자체를 보여 주고 missing 에 기록 (E2E 가 0 인지 검사)
 */
const files = import.meta.glob<{ default: Record<string, string> }>('./ko/*.json', { eager: true });
const table: Record<string, string> = {};
for (const f of Object.values(files)) Object.assign(table, f.default);
export const missing = new Set<string>();

export function t(key: string, args?: Record<string, string | number>): string {
  let s = table[key];
  if (s === undefined) {
    missing.add(key);
    s = key;
  }
  if (args) {
    for (const [k, v] of Object.entries(args)) {
      const val = typeof v === 'string' && table[`item.${v}`] ? table[`item.${v}`] : typeof v === 'string' && table[v] ? table[v] : String(v);
      s = s.split(`{${k}}`).join(val);
    }
  }
  return josa(s);
}

/** 한국어 조사: "베르타이(가)" → "베르타가", "에드릭이(가)" → "에드릭이" (앞 글자 받침으로) */
const JOSA: Record<string, [string, string]> = {
  '이(가)': ['이', '가'], '을(를)': ['을', '를'], '은(는)': ['은', '는'], '과(와)': ['과', '와'], '아(야)': ['아', '야'], '으로(로)': ['으로', '로'], '이나(나)': ['이나', '나'],
  // 받침 없는 쪽이 앞에 오는 표기도 (news.json 등)
  '가(이)': ['이', '가'], '를(을)': ['을', '를'], '는(은)': ['은', '는'], '와(과)': ['과', '와'], '야(아)': ['아', '야'], '로(으로)': ['으로', '로'], '나(이나)': ['이나', '나'],
};
const JOSA_RE = new RegExp(`([가-힣A-Za-z0-9])(${Object.keys(JOSA).map((k) => k.replace(/[()]/g, '\\$&')).join('|')})`, 'g');
export function josa(s: string): string {
  if (!s.includes('(')) return s;
  return s.replace(JOSA_RE, (_m, ch: string, j: string) => {
    const code = ch.charCodeAt(0);
    const hangul = code >= 0xac00 && code <= 0xd7a3;
    const fin = hangul ? (code - 0xac00) % 28 : /[0-9]/.test(ch) ? ('013678'.includes(ch) ? 1 : 0) : 0;
    const [withF, noF] = JOSA[j];
    // 받침 ㄹ(8) 뒤 '으로' 는 '로'
    if ((j === '으로(로)' || j === '로(으로)') && fin === 8) return ch + noF;
    return ch + (fin ? withF : noF);
  });
}

export function has(key: string): boolean {
  return key in table;
}
