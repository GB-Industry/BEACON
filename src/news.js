// 키워드별 뉴스 수집: Google 뉴스 RSS를 먼저 시도하고, 실패하거나 결과가 없으면 Bing 뉴스 RSS로 대체.

const RECENT_HOURS = 30;

export async function collectArticles(settings, env, sentLinks, now = Date.now()) {
  const results = await Promise.all(
    settings.keywords.map((keyword) => fetchForKeyword(keyword, settings.perKeyword * 3, env)
      .then((items) => ({ keyword, items, ok: true }))
      .catch((err) => {
        console.error(`뉴스 수집 실패 [${keyword}]`, err);
        return { keyword, items: [], ok: false, reason: String(err.message || err).slice(0, 80) };
      })),
  );

  const seenLinks = new Set(sentLinks);
  const seenTitles = new Set();
  const buckets = results.map(({ keyword, items }) => items
    .filter((a) => isRecent(a.pubDate, now))
    .filter((a) => markIfNew(a, seenLinks, seenTitles))
    .slice(0, settings.perKeyword)
    .map((a) => ({ ...a, keyword })));

  return {
    articles: roundRobin(buckets, settings.maxArticles),
    failedKeywords: results.filter((r) => !r.ok).map((r) => `${r.keyword} (${r.reason})`),
  };
}

const NEWS_SOURCES = [
  { name: 'Google', fetchNews: (keyword, limit) => fetchGoogleNews(keyword, limit) },
  { name: 'Bing', fetchNews: (keyword, limit) => fetchBingNews(keyword, limit) },
];

export async function fetchForKeyword(keyword, limit, env, sources = NEWS_SOURCES) {
  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
    return fetchNaverNews(keyword, limit, env);
  }
  const errors = [];
  let gotEmpty = false;
  for (const source of sources) {
    try {
      const items = await source.fetchNews(keyword, limit);
      if (items.length > 0) return items;
      gotEmpty = true;
    } catch (err) {
      console.warn(`[${keyword}] ${source.name} 실패, 다음 출처로`, err);
      errors.push(`${source.name}: ${String(err.message || err).slice(0, 40)}`);
    }
  }
  if (gotEmpty) return []; // 한 곳이라도 정상 응답했으면 "기사가 없었던 것"
  throw new Error(errors.join(', '));
}

export async function fetchNaverNews(keyword, limit, env) {
  const url = 'https://openapi.naver.com/v1/search/news.json'
    + `?query=${encodeURIComponent(keyword)}&display=${Math.min(limit, 100)}&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) throw new Error(`Naver API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.items || []).map((item) => {
    const link = item.originallink || item.link;
    return {
      title: cleanText(item.title),
      link,
      description: cleanText(item.description),
      source: hostLabel(link),
      pubDate: item.pubDate,
    };
  });
}

export async function fetchGoogleNews(keyword, limit) {
  const url = 'https://news.google.com/rss/search'
    + `?q=${encodeURIComponent(`${keyword} when:1d`)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (BEACON personal bot)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text()).slice(0, limit);
}

export async function fetchBingNews(keyword, limit) {
  const url = 'https://www.bing.com/news/search'
    + `?q=${encodeURIComponent(keyword)}&format=rss&setlang=ko-KR&cc=KR&qft=sortbydate%3d%221%22`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (BEACON personal bot)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text()).slice(0, limit);
}

export function parseRss(xml) {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let match = itemPattern.exec(xml);
  while (match) {
    items.push(parseRssItem(match[1]));
    match = itemPattern.exec(xml);
  }
  return items;
}

function parseRssItem(block) {
  const link = unwrapLink(cleanText(pickTag(block, 'link')));
  const source = cleanText(pickTag(block, 'source')) || cleanText(pickTag(block, 'News:Source')) || hostLabel(link);
  let title = cleanText(pickTag(block, 'title'));
  const suffix = ` - ${source}`;
  if (source && title.endsWith(suffix)) title = title.slice(0, -suffix.length);

  let description = cleanText(pickTag(block, 'description'));
  // Google 뉴스 RSS의 description은 보통 "제목 + 언론사"뿐이라 정보가 없으면 비운다.
  if (description.startsWith(title)) description = '';

  return {
    title,
    link,
    description,
    source,
    pubDate: cleanText(pickTag(block, 'pubDate')),
  };
}

// Bing RSS 링크는 bing.com/news/apiclick.aspx?...&url=<원문> 형태라 원문 주소를 꺼낸다.
export function unwrapLink(link) {
  try {
    const u = new URL(link);
    if (u.hostname.endsWith('bing.com') && u.searchParams.get('url')) return u.searchParams.get('url');
  } catch {
    // URL이 아니면 그대로 둔다.
  }
  return link;
}

function pickTag(block, name) {
  const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`);
  const m = block.match(pattern);
  return m ? m[1] : '';
}

export function cleanText(raw) {
  if (!raw) return '';
  const noCdata = String(raw).replace(/<!\[CDATA\[|\]\]>/g, '');
  const decoded = decodeEntities(noCdata);
  return decodeEntities(decoded.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, code) => {
    const lower = code.toLowerCase();
    if (named[lower] !== undefined) return named[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return whole;
  });
}

export function isRecent(pubDate, now = Date.now()) {
  const time = Date.parse(pubDate);
  if (Number.isNaN(time)) return true; // 날짜를 못 읽으면 일단 포함
  return now - time <= RECENT_HOURS * 60 * 60 * 1000;
}

function markIfNew(article, seenLinks, seenTitles) {
  if (!article.link || !article.title) return false;
  const titleKey = article.title.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (seenLinks.has(article.link) || seenTitles.has(titleKey)) return false;
  seenLinks.add(article.link);
  seenTitles.add(titleKey);
  return true;
}

// 키워드마다 돌아가며 하나씩 뽑아 특정 키워드에 쏠리지 않게 한다.
export function roundRobin(buckets, limit) {
  const result = [];
  const longest = Math.max(0, ...buckets.map((b) => b.length));
  for (let i = 0; i < longest && result.length < limit; i += 1) {
    for (const bucket of buckets) {
      if (i < bucket.length && result.length < limit) result.push(bucket[i]);
    }
  }
  return result;
}

function hostLabel(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}