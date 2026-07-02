# CLAUDE.md

fingu — Strava 수영 활동을 Claude로 자동 분석해서 활동 description에 코칭 피드백을 붙이는 Express + TypeScript 서비스.

## 명령어

```bash
npm run dev     # 개발 서버 (ts-node-dev, 자동 재시작)
npm run build   # tsc → dist/
npm start       # node dist/index.js
npm run lint    # eslint src/**/*.ts
```

배포는 `docker compose up -d --build` (포트 3003, `fingu-data` 볼륨에 SQLite 영속).

## 아키텍처

핵심 파이프라인은 `src/routes/webhook.ts`의 `processActivity`:

1. Strava 웹훅(`POST /webhook`)은 **항상 즉시 200 응답** 후 백그라운드 처리.
2. `activity`/`sport_type`이 `Swim`인 것만 처리.
3. `analyzeSwim`(`src/services/analyzer.ts`)이 `claude-sonnet-4-6`로 한국어 피드백 생성.
4. Strava description 앞에 마커(`ANALYSIS_MARKER`)를 붙여 업데이트 + DB 저장.

레이어: `routes/` → `services/` → `db/models/`. Strava API 호출은 전부 `services/strava.ts`,
토큰 갱신은 `services/token.ts`(만료 5분 전 자동 refresh)를 거친다.

## 반드시 알아야 할 것 (non-obvious)

- **중복 분석 방지 이중 장치**: (1) `processed_activities` 테이블, (2) description 내
  `ANALYSIS_MARKER` 문자열. 분석 파이프라인을 건드릴 때 둘 다 유지할 것.
- **7초 대기**: `processActivity`는 Strava가 업로드 직후 description을 덮어쓰는 경합을
  피하려고 7초 대기 후 activity를 **다시 fetch**한다 (`freshActivity`). 임의로 제거 금지.
- **인증은 서명 없는 `athlete_id` 쿠키**. 대시보드/연동해제가 이 쿠키만 신뢰한다.
  보안 관련 작업 시 이 점을 반드시 고려 (현재 값 위조 방어 없음).
- **분석 실패는 조용히 삼켜지지 않아야 한다**: 실패 시 `notifyFailure`로
  Discord/Slack 알림. 파이프라인에 새 실패 경로를 추가하면 알림도 연결할 것.
- **DB 스키마는 코드로 자동 생성**(`src/db/index.ts`의 `initializeSchema`).
  컬럼 추가는 `CREATE TABLE IF NOT EXISTS` + try/catch `ALTER TABLE` 패턴을 따른다.
- **페이지는 인라인 HTML 문자열**(`src/routes/pages.ts`). 템플릿 엔진 없음.
- **환경변수는 시작 시 검증**(`src/config/env.ts`의 `requireEnv`). 필수 값 누락 시 부팅 실패.

## Claude API

분석 호출은 `src/services/analyzer.ts` 한 곳. 모델은 `claude-sonnet-4-6`.
모델/프롬프트 변경 시 `max_tokens`와 응답 타입 가드(`content.type !== 'text'`)를 확인할 것.
