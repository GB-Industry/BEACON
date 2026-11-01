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
      return Response.json({ content: [{ type: 'text', text: '{"lines":["한은이 금리를 동결했다","환율이 1,380원을 넘었다","시장은 인하 시점을 주목한다"]}' }] });
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
  const fixedNow = Date.parse('2026-11-01T22:35:00Z');
  const realNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const calls = installFetchMock(fixedNow);
    const env = makeEnv();
    const ctx = makeCtx();

    const { runScheduled } = await import('../src/briefing.js');
    const r1 = await runScheduled(env, new Date(fixedNow));
    assert.equal(r1.sent, true);

    const tgCalls = calls.filter((c) => c.url.includes('/sendMessage'));
    assert.equal(tgCalls.length, 1);
    const text = tgCalls[0].body.text;
    assert.ok(text.startsWith('<b>2026년 11월 02일 (월) 경제 브리핑</b>'));
    assert.match(text, /^\[매일경제\] <a href="https:\/\/news\.example\/a2">원·달러 환율 1,380원 돌파<\/a>$/m);
    assert.doesNotMatch(text, /^\[\d+\]/m);
    assert.doesNotMatch(text, /BEACON/);
    assert.match(text, /3줄 요약/);
    assert.match(text, /한은이 금리를 동결했다/);
    assert.match(text, /#금리/);
    assert.match(text, /기준금리 동결 &amp; 인하 시사/);
    assert.doesNotMatch(text, /오래된 기사/);
    assert.equal(tgCalls[0].body.chat_id, OWNER);
    assert.equal(tgCalls[0].body.parse_mode, 'HTML');

    assert.equal((text.match(/news\.example\/a1/g) || []).length, 1);

    const claudeCall = calls.find((c) => c.url.includes('anthropic'));
    assert.equal(claudeCall.body.model, 'claude-haiku-5-5');

    const r2 = await runScheduled(env, new Date(fixedNow + 5 * 60000));
    assert.equal(r2.sent, false);

    const stateBefore = env.KV.store.get('state');
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
    assert.match(newMsgs[1], /경제 브리핑 \(미리보기\)/);
    assert.match(newMsgs[1], /news\.example\/a1/);
    assert.equal(env.KV.store.get('state'), stateBefore);

    const { sendBriefing } = await import('../src/briefing.js');
    const before2 = calls.length;
    await sendBriefing(env);
    const last = calls.slice(before2).filter((c) => c.url.includes('/sendMessage')).map((c) => c.body.text);
    assert.match(last[0], /이미 보내드린 기사를 빼면 새 기사가 없어요/);
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
  await send('/list', 12345);
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

test('Google 실패 시 Bing으로 대체, 둘 다 실패하면 이유 표시', async () => {
  const { collectArticles, fetchForKeyword, parseRss: parse } = await import('../src/news.js');
  const now = Date.now();
  const recent = new Date(now - 3600 * 1000).toUTCString();
  const bingXml = `<rss xmlns:News="https://www.bing.com/news/search?q=x&amp;format=rss"><channel>
    <item><title>코스피 2,600 회복</title>
    <link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=abc&amp;url=https%3a%2f%2fwww.hankyung.com%2farticle%2f123&amp;c=1&amp;mkt=ko-kr</link>
    <description>외국인 순매수에 코스피가 반등했다.</description><pubDate>${recent}</pubDate>
    <News:Source>한국경제</News:Source></item></channel></rss>`;

  const items = parse(bingXml);
  assert.equal(items[0].link, 'https://www.hankyung.com/article/123');
  assert.equal(items[0].source, '한국경제');
  assert.equal(items[0].description, '외국인 순매수에 코스피가 반등했다.');

  const googleDown = { name: 'Google', fetchNews: async () => { throw new Error('HTTP 503'); } };
  const bingUp = { name: 'Bing', fetchNews: async () => parse(bingXml) };
  const bingDown = { name: 'Bing', fetchNews: async () => { throw new Error('HTTP 403'); } };
  const bingEmpty = { name: 'Bing', fetchNews: async () => [] };

  assert.equal((await fetchForKeyword('코스피', 5, {}, [googleDown, bingUp])).length, 1);
  assert.deepEqual(await fetchForKeyword('코스피', 5, {}, [googleDown, bingEmpty]), []);
  await assert.rejects(fetchForKeyword('코스피', 5, {}, [googleDown, bingDown]), /Google: HTTP 503, Bing: HTTP 403/);

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://news.google.com/')) return new Response('blocked', { status: 503 });
    if (u.startsWith('https://www.bing.com/news/search')) return new Response(bingXml);
    throw new Error(`unexpected ${u}`);
  };
  const settings = { keywords: ['코스피'], perKeyword: 3, maxArticles: 10 };
  const result = await collectArticles(settings, {}, [], now);
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.failedKeywords, []);

  globalThis.fetch = async () => new Response('no', { status: 403 });
  const failed = await collectArticles(settings, {}, [], now);
  assert.deepEqual(failed.failedKeywords, ['코스피 (Google: HTTP 403, Bing: HTTP 403)']);
});
