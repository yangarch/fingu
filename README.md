# 🏊 fingu

수영 활동 자동 분석 서비스.

Garmin 수영 기록을 intervals.icu에서 받아 Claude가 코칭 피드백을 작성하고,
결과를 웹 대시보드에 저장하고 Discord/Slack으로 보내줍니다.

## 동작 흐름

```
Garmin → intervals.icu (공식 자동 동기화)
   └→ 15분 폴링 (개인 API 키)
        └→ 새 수영 발견 (processed_activities에 없는 것)
             └→ 활동 상세 + 랩(icu_intervals) + 스트림 조회
                  └→ Claude 분석 (한국어 코칭 피드백)
                       └→ DB 저장 + Discord/Slack 전송
                            └→ 대시보드(/dashboard)에 표시
```

### Strava에서 intervals.icu로 바뀐 이유

2026-09-30, Strava가 API를 유료 구독 전용으로 바꾸면서 API 앱이 Inactive가 됐다 — 모든 호출이
`403 Application Status Inactive`. 기록의 원천은 Garmin이라 trisplit과 같은 경로(Garmin → intervals.icu)로 옮겼다.

- **결과를 활동에 쓰지 않는다.** 예전엔 Strava description에 붙였지만, 이제 DB/대시보드 + 메신저 알림이 출력이다.
  따라서 중복 방지는 `processed_activities` 하나로 한다(description 마커는 Strava 경로 전용).
- **웹훅 → 폴링.** intervals.icu 웹훅은 OAuth 앱 전용이라 개인 키로는 폴링한다.
- **id**: `10¹² + intervals 번호` (`i123` → `1000000000123`). 기존 Strava id와 겹치지 않는다.
- **컷오버**: `INTERVALS_SINCE`(기본 2026-09-30) 이전 수영은 Strava로 처리됐으므로 받지 않는다.
- Strava 코드(OAuth·웹훅)는 재구독 대비로 남겨 두었고, `STRAVA_*`를 모두 설정할 때만 라우트가 켜진다.

## 기술 스택

- Node.js 20 + TypeScript + Express
- better-sqlite3 (로컬 SQLite)
- @anthropic-ai/sdk (`claude-sonnet-4-6`)
- Docker / docker-compose

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env.example`을 복사해서 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `INTERVALS_API_KEY` | ✅ | intervals.icu 개인 API 키 (Settings → Developer Settings) |
| `INTERVALS_SINCE` | | 이 날짜(현지) 이후 수영만 분석 (기본 `2026-09-30`) |
| `INTERVALS_POLL_MINUTES` | | 폴링 간격 분 (기본 15) |
| `INTERVALS_OWNER_ATHLETE_ID` | | 분석을 저장할 DB 선수 id. 미설정 시 DB에 한 명뿐이면 그 사람 |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API 키 |
| `BASE_URL` | ✅ | 외부에서 접근 가능한 서버 URL (Strava OAuth 콜백에 사용) |
| `PORT` | | 서버 포트 (기본 3000, 배포는 3003) |
| `DATABASE_URL` | | SQLite 파일 경로 (기본 `./data/swim-analyzer.db`) |
| `NOTIFICATION_WEBHOOK_URL` | | Discord/Slack 웹훅 URL. 분석 결과와 실패 알림 전송 |
| `ADMIN_TOKEN` | | `/admin/backfill`·`/login` 보호 토큰. 미설정 시 `STRAVA_VERIFY_TOKEN`, 둘 다 없으면 비활성 |
| `STRAVA_CLIENT_ID` · `STRAVA_CLIENT_SECRET` · `STRAVA_VERIFY_TOKEN` | | 비활성. Strava 재구독 시에만 셋 다 설정 |

`INTERVALS_API_KEY`와 `STRAVA_*` 중 하나는 있어야 부팅된다.

### 3. 개발 서버 실행

```bash
npm run dev        # ts-node-dev, 파일 변경 시 자동 재시작
```

### 4. 데이터 점검

```bash
npm run test:swim             # 최근 수영 하나를 받아 랩·스트림 모양 확인 + 분석 (저장·전송 없음)
npm run test:swim -- i123456  # 특정 intervals.icu 활동
```

### (비활성) Strava 웹훅 구독 등록

Strava 재구독 시에만 해당. 서버가 공개 URL(`BASE_URL`)로 접근 가능해야 합니다. Strava에 웹훅 구독을 등록하면
`GET /webhook`으로 검증 요청이 오고, 이후 활동 이벤트가 `POST /webhook`으로 전달됩니다.

```bash
# 구독 등록 (Strava가 GET /webhook으로 hub.challenge 검증)
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=$STRAVA_CLIENT_ID \
  -F client_secret=$STRAVA_CLIENT_SECRET \
  -F callback_url=$BASE_URL/webhook \
  -F verify_token=$STRAVA_VERIFY_TOKEN
```

## 배포 (Docker)

```bash
docker compose up -d --build
```

- 포트 `3003` 노출
- SQLite 데이터는 `fingu-data` 볼륨(`/app/data`)에 영속
- `.env` 파일을 그대로 읽어들임 (`env_file`)

## 주요 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 랜딩 페이지 (로그인 시 대시보드로 리다이렉트) |
| GET | `/login?token=…` | `ADMIN_TOKEN`으로 대시보드 로그인 (Strava OAuth 대체) |
| GET | `/dashboard` | 분석 기록 대시보드 (쿠키 기반) |
| GET | `/auth/strava` | (Strava 설정 시) OAuth 시작 |
| GET | `/auth/strava/callback` | (Strava 설정 시) OAuth 콜백 |
| POST | `/auth/disconnect` | (Strava 설정 시) 연동 해제 (모든 분석 기록 삭제) |
| GET | `/webhook` | (Strava 설정 시) 웹훅 구독 검증 |
| POST | `/webhook` | (Strava 설정 시) 활동 이벤트 수신 |
| POST | `/admin/backfill` | 놓친 수영 재분석 (아래 참고) |
| GET | `/health` | 헬스체크 |

### 백필 (놓친 수영 재분석)

모델 장애 등으로 자동 분석이 누락된 수영을 다시 분석합니다. 기본은 **dry run**으로
후보만 나열하며, `apply=true`를 붙여야 실제 분석이 일어납니다. intervals.icu 설정 시에는
intervals.icu에서 찾아 DB 저장 + 알림(폴링과 같은 경로, `INTERVALS_SINCE` 이전은 제외),
아니면 Strava에서 찾아 description을 업데이트합니다.

```bash
# dry run — 후보만 조회
curl -X POST "$BASE_URL/admin/backfill?token=$ADMIN_TOKEN&days=30"

# 실제 적용
curl -X POST "$BASE_URL/admin/backfill?token=$ADMIN_TOKEN&days=30&apply=true"
```

파라미터: `days`(기본 30), `perPage`(Strava 전용, 기본 50, 최대 200), `apply`(기본 false).
이미 분석된 활동(`processed_activities` 테이블, Strava는 description 마커도)은 건너뜁니다.
폴링과 동시에 돌면 409를 돌려줍니다.

## 데이터베이스

`better-sqlite3` 기반. 스키마는 서버 시작 시 자동 생성됩니다 (`src/db/index.ts`).

- `athletes` — 선수 정보 (Strava 토큰 포함; intervals.icu 분석은 기존 선수 행 아래로 저장)
- `processed_activities` — 처리 완료된 활동 ID (중복 분석 방지)
- `swim_analyses` — 분석 결과 저장

## 프로젝트 구조

```
src/
├── index.ts              # Express 앱 부트스트랩
├── config/env.ts         # 환경변수 로딩/검증
├── db/
│   ├── index.ts          # SQLite 연결 + 스키마
│   └── models/athlete.ts # DB 액세스 함수
├── routes/
│   ├── auth.ts           # Strava OAuth (비활성)
│   ├── webhook.ts        # Strava 웹훅 + 분석 파이프라인 (비활성)
│   ├── admin.ts          # 백필 엔드포인트
│   └── pages.ts          # 랜딩/로그인/대시보드 HTML
├── services/
│   ├── intervals.ts      # intervals.icu API → Strava 타입으로 변환
│   ├── intervalsPoller.ts# 폴링 + 분석 파이프라인 (현재 경로)
│   ├── strava.ts         # Strava API 호출 + 포맷 유틸
│   ├── token.ts          # Strava 액세스 토큰 갱신
│   ├── swimContext.ts    # 스플릿·최근 기록 (소스 무관)
│   ├── swimMetrics.ts    # 100m 스플릿 계산
│   ├── analyzer.ts       # Claude 프롬프트 + 호출
│   └── notifier.ts       # Discord/Slack 분석 결과·실패 알림
└── types/                # strava.ts, intervals.ts
```

## 스크립트

```bash
npm run dev         # 개발 서버 (자동 재시작)
npm run build       # TypeScript 컴파일 → dist/
npm start           # 컴파일된 서버 실행
npm run lint        # ESLint
npm run test:swim   # intervals.icu 최근 수영 점검 + 분석 (scripts/test-analyze.ts, 저장 안 함)
```
