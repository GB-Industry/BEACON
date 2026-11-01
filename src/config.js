// 사용자 설정과 실행 상태를 KV에 저장/조회한다.

export const DEFAULT_SETTINGS = {
  keywords: ['금리', '환율', '반도체'],
  time: '07:30',        // 받는 시간 (한국 시간, HH:MM)
  weekdaysOnly: false,  // 평일에만 받기
  maxArticles: 10,      // 브리핑에 담을 최대 기사 수
  perKeyword: 4,        // 키워드당 최대 기사 수
  summary: true,        // Claude 3줄 요약 사용
  paused: false,        // 일시정지
};

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'state';
const MAX_KEYWORDS = 10;
const MAX_KEYWORD_LENGTH = 30;
const MAX_SENT_LINKS = 400;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function loadSettings(env) {
  const saved = await env.KV.get(SETTINGS_KEY, 'json');
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...(saved || {}) });
}

export async function saveSettings(env, input) {
  const clean = sanitizeSettings(input);
  await env.KV.put(SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

export async function loadState(env) {
  const saved = await env.KV.get(STATE_KEY, 'json');
  return { lastSentDate: null, sentLinks: [], ...(saved || {}) };
}

export async function saveState(env, state) {
  const trimmed = { ...state, sentLinks: state.sentLinks.slice(0, MAX_SENT_LINKS) };
  await env.KV.put(STATE_KEY, JSON.stringify(trimmed));
}

export function sanitizeSettings(input) {
  const base = { ...DEFAULT_SETTINGS, ...(input || {}) };
  return {
    keywords: normalizeKeywords(base.keywords),
    time: TIME_PATTERN.test(String(base.time)) ? String(base.time) : DEFAULT_SETTINGS.time,
    weekdaysOnly: Boolean(base.weekdaysOnly),
    maxArticles: clampInt(base.maxArticles, 3, 20, DEFAULT_SETTINGS.maxArticles),
    perKeyword: clampInt(base.perKeyword, 1, 10, DEFAULT_SETTINGS.perKeyword),
    summary: Boolean(base.summary),
    paused: Boolean(base.paused),
  };
}

export function normalizeKeywords(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  for (const raw of list) {
    const word = String(raw).trim().slice(0, MAX_KEYWORD_LENGTH);
    if (word && !result.includes(word)) result.push(word);
    if (result.length >= MAX_KEYWORDS) break;
  }
  return result;
}

export function isValidTime(text) {
  return TIME_PATTERN.test(text);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
