# CLAUDE.md

fingu — Garmin 수영 기록을 intervals.icu에서 받아 Claude로 분석하고, 코칭 피드백을 DB/대시보드에 저장 + Discord/Slack으로 보내는 Express + TypeScript 서비스.

2026-09-30 Strava API가 유료 구독 전용이 되어(앱 Inactive, 전 호출 403) 소스를 intervals.icu로 옮겼다.
Strava 경로(OAuth·웹훅·description 쓰기)는 재구독 대비로 보존 — `STRAVA_*` 셋 다 설정 시에만 라우트가 켜진다.

## 명령어

```bash
npm run dev     # 개발 서버 (ts-node-dev, 자동 재시작)
npm run build   # tsc → dist/
npm start       # node dist/index.js
npm run lint    # eslint src/**/*.ts
```

배포는 `docker compose up -d --build` (포트 3003, `fingu-data` 볼륨에 SQLite 영속).

## 아키텍처

현재 파이프라인은 `src/services/intervalsPoller.ts`:

1. `startIntervalsPolling`이 `INTERVALS_POLL_MINUTES`(15)마다 `syncSwims` 실행 (intervals.icu 웹훅은 OAuth 앱 전용).
2. `INTERVALS_SINCE`(2026-09-30) 이후 `type === 'Swim'` 중 `processed_activities`에 없는 것만.
3. `services/intervals.ts`가 intervals.icu 응답을 **Strava 타입**(`StravaActivity`/`StravaLap`/`StravaStreams`)으로
   변환 → `analyzeSwim`(`claude-sonnet-4-6`)과 `swimContext`/`swimMetrics`는 소스를 모른다.
4. DB 저장(`markActivityProcessed` + `saveAnalysis`) 후 `notifyAnalysis`로 본문 전송. 활동에 쓰지 않는다.

보존된 Strava 경로는 `src/routes/webhook.ts`의 `processActivity` (웹훅 → 7초 대기 → description 업데이트).

레이어: `routes/` → `services/` → `db/models/`. intervals.icu 호출은 전부 `services/intervals.ts`,
Strava 호출은 `services/strava.ts` + `services/token.ts`.

## 반드시 알아야 할 것 (non-obvious)

- **중복 분석 방지**: intervals 경로는 `processed_activities` 테이블 **하나뿐**(활동에 쓰지 않으니 마커가 없다).
  Strava 경로는 이중 장치 — 테이블 + description 내 `ANALYSIS_MARKER`. 둘 다 유지할 것.
- **activity id 대역**: intervals 활동은 `10^12 + intervals 번호`(`toActivityId`/`toIcuId`). Strava id와 같은
  테이블에 섞여 있으니 이 오프셋을 바꾸면 중복 분석이 난다. trisplit과 같은 규칙.
- **7초 대기**(Strava 경로 한정): `processActivity`는 Strava가 업로드 직후 description을 덮어쓰는 경합을
  피하려고 7초 대기 후 activity를 **다시 fetch**한다 (`freshActivity`). 임의로 제거 금지.
- **intervals.icu API**: Basic 인증(username `API_KEY`), 선수 id `0` = 본인. Cloudflare가 일부 기본 UA를
  1010으로 막으므로 `User-Agent`를 명시한다. 에러는 `IntervalsError`로 다시 던진다 — AxiosError의
  request config에 API 키가 들어 있어 로그/알림으로 새기 때문.
- **랩/휴식 판정 의존**: 분석기는 "거리 10m 미만 랩 = 휴식"(Strava 시절 실측)에 기댄다. intervals.icu의
  `icu_intervals`도 그렇게 오는지는 `npm run test:swim`으로 실데이터 확인할 것.
- **인증은 서명 없는 `athlete_id` 쿠키**. 대시보드가 이 쿠키만 신뢰한다. Strava OAuth 대신
  `/login?token=ADMIN_TOKEN`이 소유자(`resolveOwnerAthleteId`) 쿠키를 심는다.
  보안 관련 작업 시 이 점을 반드시 고려 (현재 값 위조 방어 없음).
- **분석 실패는 조용히 삼켜지지 않아야 한다**: 실패 시 `notifyFailure`로
  Discord/Slack 알림. 파이프라인에 새 실패 경로를 추가하면 알림도 연결할 것.
  폴러는 같은 실패를 15분마다 반복 알리지 않도록 활동별 1회 / 폴링 장애는 연속 구간당 1회만 알린다.
- **DB 스키마는 코드로 자동 생성**(`src/db/index.ts`의 `initializeSchema`).
  컬럼 추가는 `CREATE TABLE IF NOT EXISTS` + try/catch `ALTER TABLE` 패턴을 따른다.
- **페이지는 인라인 HTML 문자열**(`src/routes/pages.ts`). 템플릿 엔진 없음.
- **환경변수는 시작 시 검증**(`src/config/env.ts`의 `requireEnv`). 필수 값 누락 시 부팅 실패.
  `INTERVALS_API_KEY`와 `STRAVA_*` 중 하나는 있어야 하고, `STRAVA_*`는 셋 다 있거나 셋 다 없어야 한다.
  Strava 설정은 `stravaConfig()`로 읽는다(미설정이면 throw).

## Claude API

분석 호출은 `src/services/analyzer.ts` 한 곳. 모델은 `claude-sonnet-4-6`.
모델/프롬프트 변경 시 `max_tokens`와 응답 타입 가드(`content.type !== 'text'`)를 확인할 것.
