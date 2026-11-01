# 🔆 BEACON

**B**rief **E**conomic **A**nalysis & **C**urated **O**nline **N**ews — 나만의 아침 경제 브리핑 봇

매일 정해진 시간에 내가 고른 키워드의 뉴스를 모아, **Claude가 3줄로 요약**해서 **텔레그램**으로 보내주는 개인용 봇이에요.
시간과 키워드는 텔레그램 안에서 열리는 **설정 화면**에서 바꿀 수 있어요.

```
[Cloudflare Cron 5분마다] → 설정한 시각인가? → 키워드별 뉴스 수집 → 중복 제거
        → Claude 3줄 요약 → 텔레그램으로 전송 → 보낸 기사 기록
```

- **서버 비용 0원**: Cloudflare Workers 무료 플랜 (Cron + KV 저장소)
- **뉴스 소스**: Google 뉴스 RSS (키 불필요)
- **AI 요약**: Claude API를 하루 한 번 짧게 호출해서 비용이 아주 적어요.
- **나만 쓰기**: 등록된 내 계정 말고는 봇이 반응하지 않아요.

---

## 미리 준비할 것 (약 10분)

| 항목 | 받는 곳 | 필수 |
|---|---|---|
| 텔레그램 봇 토큰 | 텔레그램에서 **@BotFather** → `/newbot` | ✅ |
| Claude API 키 | https://console.anthropic.com → API Keys | ✅ (없으면 요약 없이 기사 목록만 와요) |
| Cloudflare 계정 | https://dash.cloudflare.com (무료 가입) | ✅ |
| Node.js 22 이상 (LTS 권장) | https://nodejs.org | ✅ |
| ~~네이버 검색 API~~ | 쓰지 않아요 (아래 참고) | ❌ |

> ⚠️ **네이버 검색 API는 건너뛰세요.** 네이버 개발자센터는 2026년 7월 31일부터 검색 API 신규 신청을 받지 않아요(NAVER API HUB로 이관). 게다가 개정 약관에서 검색 결과를 AI 입력·요약에 쓰는 것을 금지해서, Claude 요약을 쓰는 이 봇과는 맞지 않아요. 키를 넣지 않으면 자동으로 Google 뉴스 RSS를 사용해요.

---

## 설치

### 1. 패키지 설치 & Cloudflare 로그인
```bash
cd BEACON
npm install
npx wrangler login
```

### 2. 저장소(KV) 만들기
```bash
npx wrangler kv namespace create KV
```
출력된 `id = "..."` 값을 `wrangler.toml`의 `REPLACE_WITH_YOUR_KV_ID` 자리에 붙여 넣어요.

### 3. 비밀값 등록
각 명령을 실행하면 값을 입력하라고 나와요.
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN   # BotFather가 준 토큰
npx wrangler secret put WEBHOOK_SECRET       # 아무 랜덤 문자열 (영문/숫자/_/- 만, 예: bc_8f3k2Lq9x)
npx wrangler secret put ANTHROPIC_API_KEY    # sk-ant-...
```
(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 은 등록하지 않아요.)

### 4. 배포
```bash
npx wrangler deploy
```
`https://beacon.<내계정>.workers.dev` 같은 주소가 나와요.

### 5. 텔레그램 연결 (한 번만)
브라우저에서 아래 주소를 열어요. `{"ok":true,...}`가 보이면 성공이에요.
```
https://beacon.<내계정>.workers.dev/setup?key=<WEBHOOK_SECRET에 넣은 값>
```

### 6. 내 계정 등록
1. 텔레그램에서 내 봇을 찾아 `/start`를 보내면 **chat id**(숫자)를 알려줘요.
2. 그 숫자를 등록해요. 등록하면 자동으로 다시 배포돼요.
   ```bash
   npx wrangler secret put OWNER_CHAT_ID
   ```
3. 다시 `/start`를 보내고 **⚙️ 설정 열기** 버튼을 눌러 보세요.
4. `/now`로 바로 한 번 받아보면 끝이에요. 🎉

> 💡 텔레그램에서 봇 채팅을 길게 눌러 **"고정"**하거나 홈 화면에 바로가기를 만들면 앱처럼 쓸 수 있어요.

---

## 사용법

### 설정 화면 (채팅창 왼쪽 아래 "설정" 버튼)
- **받는 시간**: 5분 단위로 설정 (한국 시간)
- **평일에만 받기**
- **키워드**: 추가하거나 × 버튼으로 삭제 (최대 10개, 쉼표로 여러 개 한 번에 입력 가능)
- **최대 기사 수 / 키워드당 기사 수**
- **AI 3줄 요약** 켜기/끄기
- **일시정지**
- **지금 한 번 받아보기**

### 채팅 명령어
| 명령어 | 설명 |
|---|---|
| `/now` | 지금 브리핑 받기 (정기 브리핑과 별개) |
| `/settings` | 설정 화면 열기 |
| `/list` | 현재 설정 보기 |
| `/add 엔비디아, 코스피` | 키워드 추가 |
| `/del 환율` | 키워드 삭제 |
| `/time 07:00` | 받는 시간 변경 |
| `/pause` / `/resume` | 일시정지 / 다시 받기 |

### 받는 메시지 예시
```
🔆 BEACON · 11월 2일 (월) 경제 브리핑

📌 3줄 요약
1. 한은이 기준금리를 동결하며 연내 인하 가능성을 시사했다 [1]
2. 원·달러 환율이 1,380원을 넘으며 수입물가 부담이 커졌다 [2]
3. 반도체 수출 회복세가 이어지며 관련주가 강세를 보였다 [3]

#금리
[1] 한은, 기준금리 동결… 인하 시사 · 한국경제
#환율
[2] 원·달러 환율 1,380원 돌파 · 매일경제
...
```

---

## 동작 방식 참고

- Cron이 **5분마다** 깨어나서, 설정 시각부터 **60분 안**이고 **오늘 아직 안 보냈으면** 보내요.
- 한 번 보낸 기사 링크는 기억해 두었다가 다음 브리핑에서 빼요. 제목이 거의 같은 기사도 하나만 보내요.
- 지난 약 30시간 안에 나온 기사만 담아요.
- 오류가 나면 텔레그램으로 오류 알림이 와요. 자세한 로그는 `npm run logs`로 볼 수 있어요.
- 요약 모델은 `wrangler.toml`의 `CLAUDE_MODEL`에서 바꿀 수 있어요. 기본값은 빠르고 저렴한 Haiku예요.

## 프로젝트 구조
```
src/
  index.js     Worker 진입점: 웹훅, 설정 API, /setup, cron
  briefing.js  수집 → 요약 → 메시지 구성 → 전송
  news.js      네이버 API / Google 뉴스 RSS 수집, 중복 제거
  summary.js   Claude API 3줄 요약
  telegram.js  텔레그램 API, 명령어, Mini App 인증
  schedule.js  한국 시간 기준 발송 판단
  config.js    설정/상태 저장 (KV)
  page.js      설정 화면 (Telegram Mini App HTML)
test/          node --test 로 돌리는 테스트 (npm test)
```

## 로컬 테스트
```bash
npm test                      # 단위·통합 테스트 (네트워크 없이 목업으로 실행)
npm run dev                   # 로컬 Worker 실행
# 다른 터미널에서 cron 강제 실행:
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

## 확장 아이디어
- 키워드별로 다른 시간 설정 (아침엔 국내, 저녁엔 미국 증시)
- 관심 종목 주가·환율 숫자를 브리핑 맨 위에 붙이기
- 주간 요약 (금요일 저녁에 한 주 흐름 정리)
- 기사에 👍/👎 버튼을 달아 Claude가 취향을 학습하게 하기
