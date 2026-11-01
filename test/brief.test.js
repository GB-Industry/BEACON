import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { sanitizeSettings } from '../src/config.js';
import { nowInZone, shouldSend } from '../src/schedule.js';
import { cleanText, parseRss, roundRobin } from '../src/news.js';
import { parseSummary } from '../src/summary.js';
import { splitMessage } from '../src/briefing.js';
import { hmac, normalizeTime, parseCommand, verifyInitData } from '../src/telegram.js';
import { SETTINGS_PAGE } from '../src/page.js';

const BOT_TOKEN = '123456:TEST_TOKEN';
const OWNER = '777';

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
  };
}

function rssFixture(now) {
  const recent = new Date(now - 2 * 3600 * 1000).toUTCString();
  const old = new Date(now - 72 * 3600 * 1000).toUTCString();
  const item = (title, link, date, source) => `<item><title>${title} - ${source}</title><link>${link}</link>
    <pubDate>${date}</pubDate><description>&lt;a href="${link}"&gt;${title}&lt;/a&gt;&amp;nbsp;&lt;font&gt;${source}&lt;/font&gt;</description>
    <source url="https://x.com">${source}</source></item>`;
  return `<?xml version="1.0"?><rss><channel>
    ${item('한은, 기준금리 동결 &amp; 인하 시사', 'https://news.example/a1', recent, '한국경제')}
    ${item('원·달러 환율 1,380원 돌파', 'https://news.example/a2', recent, '매일경제')}
    ${item('오래된 기사', 'https://news.example/old', old, '연합뉴스')}
  </channel></rss>`;
}

function installFetchMock(now) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body ? JSON.parse(init.body) : null });
    if (u.startsWith('https://news.google.com/')) {
      return new Response(rssFixture(now));
    }
    if (u.startsWith('https://api.anthropic.com/')) {
      return Response.json({ content: [{ type: 'text', text: '{"lines":["한은이 금리를 동결했다 [1]","환율이 1,380원을 넘었다 [2]","시장은 인하 시점을 주목한다 [1]"]}' }] });
    }
    if (u.startsWith('https://api.telegram.org/')) {
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

async function signInitData(user, authDate) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'Q1', user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const secret = await hmac(enc.encode('WebAppData'), enc.encode(BOT_TOKEN));
  const sig = await hmac(secret, enc.encode(check));
  params.set('hash', Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join(''));
  return params.toString();
}

function makeEnv(kv = makeKV()) {
  return {
    KV: kv, TELEGRAM_BOT_TOKEN: BOT_TOKEN, WEBHOOK_SECRET: 'sec_123', OWNER_CHAT_ID: OWNER,
    ANTHROPIC_API_KEY: 'sk-test', CLAUDE_MODEL: 'claude-haiku-5-5', TZ_OFFSET_MINUTES: '540',
  };
}

function makeCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, async flush() { while (pending.length) await pending.shift(); } };
}

test('설정 정리: 잘못된 값은 기본값/범위로', () => {
  const s = sanitizeSettings({ keywords: [' 금리 ', '금리', '', 'x'.repeat(50)], time: '25:00', maxArticles: 99 });
  assert.deepEqual(s.keywords, ['금리', 'x'.repeat(30)]);
  assert.equal(s.time, '07:30');
  assert.equal(s.maxArticles, 20);
});

test('스케줄 판단: 한국 시간 기준, 하루 한 번, 60분 창', () => {
  const settings = sanitizeSettings({ time: '07:30' });
  // 2026-11-02(월) 07:35 KST = 2026-11-01 22:35 UTC
  const now = nowInZone(540, new Date('2026-11-01T22:35:00Z'));
  assert.equal(now.dateStr, '2026-11-02');
  assert.equal(shouldSend(settings, { lastSentDate: null }, now), true);
  assert.equal(shouldSend(settings, { lastSentDate: '2026-11-02' }, now), false);
  const early = nowInZone(540, new Date('2026-11-01T22:00:00Z'));
  assert.equal(shouldSend(settings, { lastSentDate: null }, early), false);
  const late = nowInZone(540, new Date('2026-11-01T23:45:00Z'));
  assert.equal(shouldSend(settings, { lastSentDate: null }, late), false);
  const saturday = nowInZone(540, new Date('2026-10-30T22:35:00Z'));
  assert.equal(shouldSend({ ...settings, weekdaysOnly: true }, { lastSentDate: null }, saturday), false);
  assert.equal(shouldSend({ ...settings, paused: true }, { lastSentDate: null }, now), false);
});

test('RSS 파싱과 텍스트 정리', () => {
  const items = parseRss(rssFixture(Date.now()));
  assert.equal(items.length, 3);
  assert.equal(items[0].title, '한은, 기준금리 동결 & 인하 시사');
  assert.equal(items[0].source, '한국경제');
  assert.equal(items[0].description, '');
  assert.equal(cleanText('<b>금리</b> &quot;인하&quot; &#39;전망&#39;'), '금리 "인하" \'전망\'');
});

test('라운드로빈, 요약 파싱, 메시지 분할, 명령어 파싱', () => {
  assert.deepEqual(roundRobin([[1, 2, 3], ['a'], ['x', 'y']], 5), [1, 'a', 'x', 2, 'y']);
  assert.deepEqual(parseSummary('결과:\n{"lines":["a","b","c","d"]}'), ['a', 'b', 'c']);
  assert.deepEqual(parseSummary('1. 하나\n2. 둘\n3. 셋'), ['하나', '둘', '셋']);
  const parts = splitMessage(Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n'), 500);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 500));
  assert.deepEqual(parseCommand('/add@MyBot 엔비디아, 코스피'), { command: '/add', arg: '엔비디아, 코스피' });
  assert.equal(normalizeTime('7:05'), '07:05');
  assert.equal(normalizeTime('0730'), '07:30');
  assert.equal(normalizeTime('24:00'), null);
});

test('Mini App initData 검증', async () => {
  const now = Date.now();
  const good = await signInitData({ id: 777, first_name: '규빈' }, Math.floor(now / 1000));
  assert.equal((await verifyInitData(good, BOT_TOKEN)).id, 777);
  assert.equal(await verifyInitData(good, '999:OTHER'), null);
  assert.equal(await verifyInitData(good.replace('777', '778'), BOT_TOKEN), null);
  const old = await signInitData({ id: 777 }, Math.floor(now / 1000) - 3 * 86400);
  assert.equal(await verifyInitData(old, BOT_TOKEN), null);
});

test('정기 실행: 수집 → 요약 → 전송 → 중복 방지', async () => {
  const fixedNow = Date.parse('2026-11-01T22:35:00Z'); // 월요일 07:35 KST
  const realNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const calls = installFetchMock(fixedNow);
    const env = makeEnv();
    const ctx = makeCtx();

    // scheduled는 실제 시계를 쓰므로 runScheduled를 직접 시간 지정해서 호출
    const { runScheduled } = await import('../src/briefing.js');
    const r1 = await runScheduled(env, new Date(fixedNow));
    assert.equal(r1.sent, true);

    const tgCalls = calls.filter((c) => c.url.includes('/sendMessage'));
    assert.equal(tgCalls.length, 1);
    const text = tgCalls[0].body.text;
    assert.match(text, /11월 2일 \(월\) 경제 브리핑/);
    assert.match(text, /3줄 요약/);
    assert.match(text, /한은이 금리를 동결했다/);
    assert.match(text, /#금리/);
    assert.match(text, /기준금리 동결 &amp; 인하 시사/);
    assert.doesNotMatch(text, /오래된 기사/);
    assert.equal(tgCalls[0].body.chat_id, OWNER);
    assert.equal(tgCalls[0].body.parse_mode, 'HTML');

    // 같은 기사가 키워드 3개에서 다 나와도 한 번씩만
    assert.equal((text.match(/news\.example\/a1/g) || []).length, 1);

    const claudeCall = calls.find((c) => c.url.includes('anthropic'));
    assert.equal(claudeCall.body.model, 'claude-haiku-5-5');

    // 같은 날 두 번째 실행은 보내지 않음
    const r2 = await runScheduled(env, new Date(fixedNow + 5 * 60000));
    assert.equal(r2.sent, false);

    // /now 수동 요청: 이미 보낸 기사는 제외 → 새 기사 없음 메시지
    const before = calls.length;
    const res = await worker.fetch(new Request('https://bot.example/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec_123' },
      body: JSON.stringify({ message: { chat: { id: 777 }, text: '/now' } }),
    }), env, ctx);
    assert.equal(res.status, 200);
    await ctx.flush();
    const newMsgs = calls.slice(before).filter((c) => c.url.includes('/sendMessage')).map((c) => c.body.text);
    assert.equal(newMsgs.length, 2);
    assert.match(newMsgs[1], /새 기사가 없었어요/);
  } finally {
    Date.now = realNow;
  }
});

test('웹훅 보안과 명령어로 설정 변경', async () => {
  const calls = installFetchMock(Date.now());
  const env = makeEnv();
  const ctx = makeCtx();
  const send = (text, chatId = 777, secret = 'sec_123') => worker.fetch(new Request('https://bot.example/webhook', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { chat: { id: chatId }, text } }),
  }), env, ctx);

  assert.equal((await send('/list', 777, 'wrong')).status, 403);

  await send('/add 엔비디아, 코스피');
  await send('/del 환율');
  await send('/time 6:50');
  const saved = JSON.parse(env.KV.store.get('settings'));
  assert.deepEqual(saved.keywords, ['금리', '반도체', '엔비디아', '코스피']);
  assert.equal(saved.time, '06:50');

  const before = calls.length;
  await send('/list', 12345); // 다른 사람
  assert.equal(calls.length, before);
});

test('설정 API: initData 인증 + 저장', async () => {
  installFetchMock(Date.now());
  const env = makeEnv();
  const ctx = makeCtx();
  const initData = await signInitData({ id: 777 }, Math.floor(Date.now() / 1000));

  const unauth = await worker.fetch(new Request('https://bot.example/api/settings'), env, ctx);
  assert.equal(unauth.status, 401);

  const stranger = await signInitData({ id: 1 }, Math.floor(Date.now() / 1000));
  const strangerRes = await worker.fetch(new Request('https://bot.example/api/settings', { headers: { 'X-Telegram-Init-Data': stranger } }), env, ctx);
  assert.equal(strangerRes.status, 401);

  const post = await worker.fetch(new Request('https://bot.example/api/settings', {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': initData, 'content-type': 'application/json' },
    body: JSON.stringify({ keywords: ['테슬라'], time: '08:15', weekdaysOnly: true, maxArticles: 6, perKeyword: 3, summary: false, paused: false }),
  }), env, ctx);
  const data = await post.json();
  assert.equal(post.status, 200);
  assert.deepEqual(data.settings.keywords, ['테슬라']);
  assert.equal(data.settings.time, '08:15');

  const get = await worker.fetch(new Request('https://bot.example/api/settings', { headers: { 'X-Telegram-Init-Data': initData } }), env, ctx);
  assert.equal((await get.json()).settings.time, '08:15');
});

test('설정 페이지 HTML', () => {
  assert.match(SETTINGS_PAGE, /telegram-web-app\.js/);
  assert.match(SETTINGS_PAGE, /id="kwInput"/);
  assert.doesNotMatch(SETTINGS_PAGE, /\$\{/);
});
