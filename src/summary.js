// Claude API로 "오늘의 경제 브리핑 3줄 요약"을 만든다.

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-5-5';

export async function summarize(articles, env) {
  if (!env.ANTHROPIC_API_KEY || articles.length === 0) return null;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || DEFAULT_MODEL,
      max_tokens: 700,
      messages: [{ role: 'user', content: buildPrompt(articles) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return parseSummary(text);
}

export function buildPrompt(articles) {
  const list = articles.map((a, i) => {
    const desc = a.description ? `\n   ${a.description.slice(0, 300)}` : '';
    return `[${i + 1}] (#${a.keyword}) ${a.title} — ${a.source}${desc}`;
  }).join('\n');

  return `다음은 오늘 아침 수집한 경제 뉴스 목록이야.

${list}

이 기사들만 근거로, 바쁜 대학생이 출근길에 30초 만에 읽을 "오늘의 경제 브리핑 3줄 요약"을 만들어 줘.
- 정확히 3줄, 각 줄은 한국어 한 문장, 80자 이내
- 가장 중요한 흐름 순서로, 숫자(금리·환율·지수 등)가 있으면 살려서
- 기사 번호나 [1] 같은 표시는 붙이지 말 것
- 기사에 없는 내용은 추측하지 말 것

다른 말 없이 아래 JSON만 출력해:
{"lines": ["첫째 줄", "둘째 줄", "셋째 줄"]}`;
}

export function parseSummary(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed.lines)) {
        const lines = parsed.lines.map((l) => String(l).trim()).filter(Boolean);
        if (lines.length > 0) return lines.slice(0, 3);
      }
    } catch {
      // JSON이 아니면 아래 줄 단위 파싱으로 넘어간다.
    }
  }
  const lines = text.split('\n')
    .map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 3) : null;
}