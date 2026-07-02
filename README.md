# 🏊 fingu

Strava 수영 활동 자동 분석 서비스.

Strava에 수영 기록을 업로드하면 웹훅으로 감지하여 Claude가 코칭 피드백을 작성하고,
그 결과를 해당 활동의 설명(description)에 자동으로 붙여줍니다. 분석 기록은 웹 대시보드에서도 확인할 수 있습니다.

## 동작 흐름

```
Strava OAuth 연동
   └→ 수영 업로드
        └→ Strava 웹훅 수신 (POST /webhook)
             └→ 활동 상세 + 랩 조회
                  └→ Claude 분석 (한국어 코칭 피드백)
                       └→ Strava description 업데이트 + DB 저장
                            └→ 대시보드(/dashboard)에 표시
```

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
| `STRAVA_CLIENT_ID` | ✅ | Strava API 애플리케이션 클라이언트 ID |
| `STRAVA_CLIENT_SECRET` | ✅ | Strava API 클라이언트 시크릿 |
| `STRAVA_VERIFY_TOKEN` | ✅ | 웹훅 구독 검증용 임의 토큰 |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API 키 |
| `BASE_URL` | ✅ | 외부에서 접근 가능한 서버 URL (OAuth 콜백에 사용) |
| `PORT` | | 서버 포트 (기본 3000, 배포는 3003) |
| `DATABASE_URL` | | SQLite 파일 경로 (기본 `./data/swim-analyzer.db`) |
| `NOTIFICATION_WEBHOOK_URL` | | Discord/Slack 웹훅 URL. 설정 시 분석 실패 알림 전송 |
| `ADMIN_TOKEN` | | `/admin/backfill` 보호 토큰. 미설정 시 `STRAVA_VERIFY_TOKEN` 사용 |

### 3. 개발 서버 실행

```bash
npm run dev        # ts-node-dev, 파일 변경 시 자동 재시작
```

### 4. Strava 웹훅 구독 등록

서버가 공개 URL(`BASE_URL`)로 접근 가능해야 합니다. Strava에 웹훅 구독을 등록하면
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
| GET | `/dashboard` | 분석 기록 대시보드 (쿠키 기반) |
| GET | `/auth/strava` | Strava OAuth 시작 |
| GET | `/auth/strava/callback` | OAuth 콜백 |
| POST | `/auth/disconnect` | 연동 해제 (모든 분석 기록 삭제) |
| GET | `/webhook` | 웹훅 구독 검증 |
| POST | `/webhook` | 활동 이벤트 수신 |
| POST | `/admin/backfill` | 놓친 수영 재분석 (아래 참고) |
| GET | `/health` | 헬스체크 |

### 백필 (놓친 수영 재분석)

모델 장애 등으로 자동 분석이 누락된 수영을 다시 분석합니다. 기본은 **dry run**으로
후보만 나열하며, `apply=true`를 붙여야 실제 분석 및 Strava 업데이트가 일어납니다.

```bash
# dry run — 후보만 조회
curl -X POST "$BASE_URL/admin/backfill?token=$ADMIN_TOKEN&days=30"

# 실제 적용
curl -X POST "$BASE_URL/admin/backfill?token=$ADMIN_TOKEN&days=30&apply=true"
```

파라미터: `days`(기본 30), `perPage`(기본 50, 최대 200), `apply`(기본 false).
이미 분석된 활동(`processed_activities` 테이블 또는 description 마커)은 건너뜁니다.

## 데이터베이스

`better-sqlite3` 기반. 스키마는 서버 시작 시 자동 생성됩니다 (`src/db/index.ts`).

- `athletes` — Strava 토큰 및 선수 정보
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
│   ├── auth.ts           # Strava OAuth
│   ├── webhook.ts        # 웹훅 수신 + 분석 파이프라인
│   ├── admin.ts          # 백필 엔드포인트
│   └── pages.ts          # 랜딩/대시보드 HTML
├── services/
│   ├── strava.ts         # Strava API 호출 + 포맷 유틸
│   ├── token.ts          # 액세스 토큰 갱신
│   ├── analyzer.ts       # Claude 프롬프트 + 호출
│   └── notifier.ts       # Discord/Slack 실패 알림
└── types/strava.ts       # 타입 정의
```

## 스크립트

```bash
npm run dev         # 개발 서버 (자동 재시작)
npm run build       # TypeScript 컴파일 → dist/
npm start           # 컴파일된 서버 실행
npm run lint        # ESLint
npm run test:swim   # 단일 활동 분석 테스트 (scripts/test-analyze.ts)
```
