# BEACON

**B**rief **E**conomic **A**nalysis & **C**urated **O**nline **N**ews

매일 정해진 시간에 관심 키워드의 경제 뉴스를 모아 텔레그램으로 보내주는 개인용 브리핑 봇입니다.

```
2026년 11월 02일 (월) 경제 브리핑

#금리
[한국경제] 한은, 기준금리 동결… 인하 시사
#환율
[매일경제] 원·달러 환율 1,380원 돌파
```

## 주요 기능

- 원하는 시간(KST)에 매일 자동 발송, 평일만 받기 지원
- 키워드별 뉴스 수집과 중복 기사 제거
- 텔레그램 안에서 여는 설정 화면 (시간, 키워드, 기사 수)
- Claude API를 이용한 3줄 요약 (추가 예정)
- 등록된 계정만 사용 가능

## 기술 스택

- 런타임: Cloudflare Workers
- 스케줄링: Cloudflare Cron Triggers
- 저장소: Cloudflare KV
- 메시징 및 UI: Telegram Bot API, Telegram Mini App
- 뉴스 수집: Google 뉴스 RSS, Bing 뉴스 RSS
- 요약: Claude API
- 언어 및 도구: JavaScript, Wrangler, Node.js

## 동작 방식

1. Cron이 5분마다 Worker를 실행하고, 설정한 발송 시간인지 확인합니다.
2. 키워드별로 최근 뉴스를 수집하고 이미 보낸 기사를 제외합니다.
3. 요약 기능이 켜져 있으면 Claude API로 3줄 요약을 만듭니다.
4. 텔레그램으로 브리핑을 보내고, 보낸 기사를 KV에 기록합니다.

※ 설정 변경과 명령어는 텔레그램 Webhook을 통해 처리합니다.

## 프로젝트 구조

```
src/
  index.js      진입점 (웹훅, 설정 API, Cron)
  briefing.js   브리핑 생성 및 전송
  news.js       RSS 수집, 파싱, 중복 제거
  summary.js    Claude 요약
  telegram.js   Bot API, 명령어, Mini App 인증
  schedule.js   발송 시간 판단
  config.js     설정 저장 (KV)
  page.js       설정 화면 (Mini App)
```

## 실행 방법

```
npm install
npx wrangler kv namespace create KV
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put OWNER_CHAT_ID
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

- KV를 만든 뒤 출력된 id를 `wrangler.toml`에 입력합니다.
- `ANTHROPIC_API_KEY`는 요약 기능을 쓸 때만 필요합니다.
- 배포 후 `https://<worker 주소>/setup?key=<WEBHOOK_SECRET>`에 한 번 접속하면 텔레그램과 연결됩니다.

## 명령어

- `/now` : 브리핑 미리보기
- `/settings` : 설정 화면 열기
- `/add`, `/del` : 키워드 추가, 삭제
- `/time` : 발송 시간 변경
- `/pause`, `/resume` : 발송 일시정지, 재개