import { loadSettings, saveSettings } from './config.js';
import { runScheduled, sendBriefing } from './briefing.js';
import { SETTINGS_PAGE } from './page.js';
import { BOT_COMMANDS, handleUpdate, tg, verifyInitData } from './telegram.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      return await route(request, env, ctx, url);
    } catch (err) {
      console.error(err);
      return json({ error: err.message || 'internal error' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env).catch((err) => reportError(env, err)));
  },
};

async function route(request, env, ctx, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/webhook' && method === 'POST') return handleWebhook(request, env, ctx, url.origin);
  if (pathname === '/app' && method === 'GET') {
    return new Response(SETTINGS_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (pathname === '/api/settings') return handleSettingsApi(request, env);
  if (pathname === '/api/send-now' && method === 'POST') return handleSendNowApi(request, env, ctx);
  if (pathname === '/setup' && method === 'GET') return handleSetup(env, url);
  if (pathname === '/') return new Response('BEACON bot is running 🔆');
  return new Response('Not found', { status: 404 });
}

async function handleWebhook(request, env, ctx, origin) {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });

  const update = await request.json();
  const sendNow = () => ctx.waitUntil(sendBriefing(env, { preview: true }).catch((err) => reportError(env, err)));
  try {
    await handleUpdate(update, env, { origin, sendNow });
  } catch (err) {
    console.error('웹훅 처리 실패', err);
  }
  return new Response('ok');
}

async function handleSettingsApi(request, env) {
  if (!(await authorize(request, env))) return json({ error: 'unauthorized' }, 401);
  if (request.method === 'GET') return json({ settings: await loadSettings(env) });
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'invalid body' }, 400);
    return json({ settings: await saveSettings(env, body) });
  }
  return json({ error: 'method not allowed' }, 405);
}

async function handleSendNowApi(request, env, ctx) {
  if (!(await authorize(request, env))) return json({ error: 'unauthorized' }, 401);
  ctx.waitUntil(sendBriefing(env, { preview: true }).catch((err) => reportError(env, err)));
  return json({ ok: true });
}

async function authorize(request, env) {
  const user = await verifyInitData(request.headers.get('X-Telegram-Init-Data'), env.TELEGRAM_BOT_TOKEN);
  return Boolean(user && env.OWNER_CHAT_ID && String(user.id) === String(env.OWNER_CHAT_ID));
}

async function handleSetup(env, url) {
  if (!env.WEBHOOK_SECRET || url.searchParams.get('key') !== env.WEBHOOK_SECRET) {
    return json({ error: 'key가 WEBHOOK_SECRET과 다릅니다' }, 403);
  }
  const results = {};
  results.webhook = await tg(env, 'setWebhook', {
    url: `${url.origin}/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  results.commands = await tg(env, 'setMyCommands', { commands: BOT_COMMANDS });
  results.menuButton = await tg(env, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: '설정', web_app: { url: `${url.origin}/app` } },
  });
  return json({ ok: true, results, next: '텔레그램에서 봇에게 /start 를 보내 보세요.' });
}

async function reportError(env, err) {
  console.error('브리핑 실패', err);
  if (!env.OWNER_CHAT_ID) return;
  try {
    await tg(env, 'sendMessage', { chat_id: env.OWNER_CHAT_ID, text: `⚠️ 브리핑 중 오류가 났어요: ${String(err.message || err).slice(0, 300)}` });
  } catch (sendErr) {
    console.error('오류 알림도 실패', sendErr);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
