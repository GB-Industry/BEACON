import { isValidTime, loadSettings, normalizeKeywords, saveSettings } from './config.js';

export async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

export function sendMessage(env, chatId, text, extra = {}) {
  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const BOT_COMMANDS = [
  { command: 'now', description: '지금 브리핑 미리보기 (몇 번이든 가능)' },
  { command: 'settings', description: '설정 화면 열기' },
  { command: 'list', description: '현재 설정 보기' },
  { command: 'add', description: '키워드 추가 (예: /add 엔비디아, 코스피)' },
  { command: 'del', description: '키워드 삭제 (예: /del 환율)' },
  { command: 'time', description: '받는 시간 변경 (예: /time 07:00)' },
  { command: 'pause', description: '브리핑 일시정지' },
  { command: 'resume', description: '브리핑 다시 받기' },
];

export async function handleUpdate(update, env, { origin, sendNow }) {
  const message = update.message;
  if (!message || typeof message.text !== 'string') return;
  const chatId = String(message.chat.id);

  if (!env.OWNER_CHAT_ID) {
    await sendMessage(env, chatId,
      `안녕하세요! 아직 주인이 등록되지 않았어요.\n당신의 chat id는 <code>${chatId}</code> 예요.\n`
      + 'README의 안내대로 OWNER_CHAT_ID 로 등록해 주세요.');
    return;
  }
  if (chatId !== String(env.OWNER_CHAT_ID)) return;

  const { command, arg } = parseCommand(message.text);
  const reply = (text, extra) => sendMessage(env, chatId, text, extra);

  switch (command) {
    case '/start':
    case '/help':
      return reply(helpText(), settingsButton(origin));
    case '/settings':
      return reply('아래 버튼으로 설정 화면을 열어 주세요.', settingsButton(origin));
    case '/list':
      return reply(describeSettings(await loadSettings(env)));
    case '/add':
      return reply(await addKeywords(env, arg));
    case '/del':
      return reply(await removeKeywords(env, arg));
    case '/time':
      return reply(await changeTime(env, arg));
    case '/pause':
      await updateSettings(env, { paused: true });
      return reply('⏸ 브리핑을 멈췄어요. /resume 으로 다시 받을 수 있어요.');
    case '/resume':
      await updateSettings(env, { paused: false });
      return reply('▶️ 브리핑을 다시 보내드릴게요.');
    case '/now':
      await reply('📰 브리핑을 만드는 중이에요… (10~20초)');
      sendNow();
      return undefined;
    default:
      return reply('명령어를 모르겠어요. /help 를 입력해 보세요.');
  }
}

export function parseCommand(text) {
  const trimmed = text.trim();
  const spaceIndex = trimmed.search(/\s/);
  const head = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const arg = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();
  return { command: head.split('@')[0].toLowerCase(), arg };
}

async function updateSettings(env, patch) {
  const current = await loadSettings(env);
  return saveSettings(env, { ...current, ...patch });
}

async function addKeywords(env, arg) {
  const words = splitWords(arg);
  if (words.length === 0) return '추가할 키워드를 적어 주세요. 예: /add 엔비디아, 코스피';
  const current = await loadSettings(env);
  const saved = await saveSettings(env, { ...current, keywords: [...current.keywords, ...words] });
  return `✅ 키워드: ${saved.keywords.map(escapeHtml).join(', ')}`;
}

async function removeKeywords(env, arg) {
  const words = splitWords(arg);
  if (words.length === 0) return '삭제할 키워드를 적어 주세요. 예: /del 환율';
  const current = await loadSettings(env);
  const saved = await saveSettings(env, {
    ...current,
    keywords: current.keywords.filter((k) => !words.includes(k)),
  });
  const list = saved.keywords.length ? saved.keywords.map(escapeHtml).join(', ') : '(없음)';
  return `🗑 키워드: ${list}`;
}

async function changeTime(env, arg) {
  const time = normalizeTime(arg);
  if (!time) return '시간은 24시간 형식으로 적어 주세요. 예: /time 07:00';
  await updateSettings(env, { time });
  return `⏰ 매일 ${time}에 보내드릴게요.`;
}

export function normalizeTime(text) {
  const m = String(text).trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const time = `${m[1].padStart(2, '0')}:${m[2]}`;
  return isValidTime(time) ? time : null;
}

function splitWords(arg) {
  return normalizeKeywords(arg.split(/[,，]/));
}

function settingsButton(origin) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '⚙️ 설정 열기', web_app: { url: `${origin}/app` } }]],
    },
  };
}

function helpText() {
  return [
    '🔆 <b>BEACON</b> — Brief Economic Analysis &amp; Curated Online News',
    '',
    '정해진 시간에 키워드 뉴스를 모아 3줄 요약과 함께 보내드려요.',
    '',
    ...BOT_COMMANDS.map((c) => `/${c.command} — ${escapeHtml(c.description)}`),
  ].join('\n');
}

export function describeSettings(s) {
  return [
    '⚙️ <b>현재 설정</b>',
    `⏰ 시간: ${s.time}${s.weekdaysOnly ? ' (평일만)' : ''}`,
    `🔑 키워드: ${s.keywords.length ? s.keywords.map(escapeHtml).join(', ') : '(없음)'}`,
    `📰 기사 수: 최대 ${s.maxArticles}개 (키워드당 ${s.perKeyword}개)`,
    `🤖 3줄 요약: ${s.summary ? '켜짐' : '꺼짐'}`,
    `상태: ${s.paused ? '⏸ 일시정지' : '▶️ 받는 중'}`,
  ].join('\n');
}

export async function verifyInitData(initData, botToken, maxAgeSeconds = 86400, nowMs = Date.now()) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const encoder = new TextEncoder();
  const secret = await hmac(encoder.encode('WebAppData'), encoder.encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, hexToBytes(hash), encoder.encode(dataCheckString));
  if (!valid) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowMs / 1000 - authDate > maxAgeSeconds) return null;

  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

export async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
