import { loadSettings, loadState, saveState } from './config.js';
import { collectArticles } from './news.js';
import { summarize } from './summary.js';
import { formatDateLabel, nowInZone, shouldSend } from './schedule.js';
import { escapeHtml, sendMessage } from './telegram.js';

const TELEGRAM_LIMIT = 3900;

export async function runScheduled(env, date = new Date()) {
  if (!env.OWNER_CHAT_ID) return { sent: false, reason: 'no-owner' };
  const settings = await loadSettings(env);
  const state = await loadState(env);
  const now = nowInZone(zoneOffset(env), date);
  if (!shouldSend(settings, state, now)) return { sent: false, reason: 'not-time' };
  await sendBriefing(env, { settings, state, now, markDaily: true });
  return { sent: true };
}

export async function sendBriefing(env, options = {}) {
  const settings = options.settings || await loadSettings(env);
  const state = options.state || await loadState(env);
  const now = options.now || nowInZone(zoneOffset(env));
  const chatId = env.OWNER_CHAT_ID;

  if (settings.keywords.length === 0) {
    await sendMessage(env, chatId, '설정된 키워드가 없어요. /add 키워드 로 추가해 주세요.');
    return;
  }

  const preview = Boolean(options.preview);
  const excludeLinks = preview ? [] : state.sentLinks;
  const { articles, failedKeywords } = await collectArticles(settings, env, excludeLinks);
  const summaryLines = settings.summary ? await safeSummarize(articles, env) : null;
  const text = formatBriefing({
    now, articles, summaryLines, failedKeywords, wantedSummary: settings.summary, preview,
  });

  for (const part of splitMessage(text, TELEGRAM_LIMIT)) {
    await sendMessage(env, chatId, part);
  }

  if (preview) return;
  await saveState(env, {
    ...state,
    lastSentDate: options.markDaily ? now.dateStr : state.lastSentDate,
    sentLinks: [...articles.map((a) => a.link), ...state.sentLinks],
  });
}

async function safeSummarize(articles, env) {
  try {
    return await summarize(articles, env);
  } catch (err) {
    console.error('요약 실패', err);
    return null;
  }
}

export function formatBriefing({
  now, articles, summaryLines, failedKeywords = [], wantedSummary = true, preview = false,
}) {
  const title = `${formatDateLabel(now.dateStr, now.weekday)} 경제 브리핑${preview ? ' (미리보기)' : ''}`;
  const lines = [`<b>${title}</b>`, ''];

  if (articles.length === 0) {
    lines.push(preview
      ? '최근 30시간 동안 키워드에 맞는 기사가 없었어요. 키워드를 바꿔 보세요.'
      : '이미 보내드린 기사를 빼면 새 기사가 없어요.');
  } else {
    appendSummary(lines, summaryLines, wantedSummary);
    appendArticles(lines, articles);
  }

  if (failedKeywords.length > 0) {
    lines.push('', `⚠️ 수집 실패: ${failedKeywords.map(escapeHtml).join(', ')}`);
  }
  return lines.join('\n').trim();
}

function appendSummary(lines, summaryLines, wantedSummary) {
  if (summaryLines && summaryLines.length > 0) {
    lines.push('📌 <b>3줄 요약</b>');
    summaryLines.forEach((line, i) => lines.push(`${i + 1}. ${escapeHtml(line)}`));
    lines.push('');
  } else if (wantedSummary) {
    lines.push('<i>(요약을 만들지 못해 기사 목록만 보내요)</i>', '');
  }
}

function appendArticles(lines, articles) {
  const groups = new Map();
  for (const article of articles) {
    if (!groups.has(article.keyword)) groups.set(article.keyword, []);
    groups.get(article.keyword).push(article);
  }

  for (const [keyword, items] of groups) {
    lines.push(`<b>#${escapeHtml(keyword)}</b>`);
    for (const article of items) {
      lines.push(formatArticleLine(article));
    }
    lines.push('');
  }
}

export function formatArticleLine(article) {
  const source = article.source ? `[${escapeHtml(article.source)}] ` : '';
  return `${source}<a href="${escapeHtml(article.link)}">${escapeHtml(article.title)}</a>`;
}

export function splitMessage(text, limit) {
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      parts.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function zoneOffset(env) {
  const n = Number.parseInt(env.TZ_OFFSET_MINUTES, 10);
  return Number.isNaN(n) ? 540 : n;
}
