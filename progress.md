# fingu 진행 상황

마지막 갱신: 2026-10-15

## 배경

2026-09-30 Strava가 Standard API를 유료 구독 전용으로 바꾸면서 API 앱이 Inactive가 됐다.
그 뒤로 모든 호출이 `403 Application Status Inactive`로 실패해서 fingu가 통째로 멈췄다.
형제 프로젝트 trisplit(`../trisplit`, 커밋 906c8dc)이 먼저 Garmin → intervals.icu로 소스를 옮겼고,
fingu도 같은 경로로 전환했다.

## 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 데이터 소스 | intervals.icu (개인 API 키) | 기록 원천이 Garmin이고, intervals.icu는 공식 연동에 개인 키가 무료 |
| 트리거 | 15분 폴링 | intervals.icu 웹훅은 OAuth 앱 전용 |
| 결과 전달 | DB/대시보드 + Discord/Slack 메시지 | 활동 description에는 쓰지 않음 (사용자 선택) |
| 사용자 | 단일 사용자 (`INTERVALS_OWNER_ATHLETE_ID`) | 서버 DB에 선수가 2명이라 명시 필요 |
| Strava 코드 | 보존, `STRAVA_*` 미설정 시 비활성 | 재구독 대비 |
| 컷오버 | `INTERVALS_SINCE=2026-09-30` | 그 전 수영은 Strava로 처리됨 (id 체계가 달라 id로는 중복을 못 거름) |
| activity id | `10^12 + intervals 번호` | Strava id와 같은 테이블에 섞여도 충돌 없음 (trisplit과 같은 규칙) |

## 완료한 작업

| 커밋 | 내용 |
|---|---|
| 3710c17 | Strava → intervals.icu 전환. 폴러, intervals 클라이언트(Strava 타입으로 변환), 분석 결과 알림(`notifyAnalysis`), `/login?token=` 로그인, 백필의 intervals 경로, `test:swim` 재작성. 에러에서 API 키가 새지 않게 `IntervalsError`로 감쌈 |
| 2af185a | `OpenWaterSwim`도 수영으로 처리. companion app이 Apple Watch 풀 수영을 이 타입으로 올림 (`pool_length`·`lengths` 없음, GPS 없음) |
| f3e3928 | `probe:streams` 진단 스크립트 추가 (거리 스트림 모양, 정지 구간 분포) |
| b0ad5ec | 랩이 1개 이하인 기록은 스트림으로 랩을 재구성. 거리 정지 ≥10초를 휴식으로 보고, 수영 시간·페이스는 휴식 제외로 다시 계산 |
| 42e778c | 재구성한 랩에서 벽 직전 몇 cm를 수영 랩에 포함 (24m → 25m, 랩 합계 = 활동 거리) |

### 실데이터 검증 결과

- **Garmin 강습** (i192444656, 10/2)
  - 휴식이 `icu_intervals`에 0m 랩으로 들어옴
  - 랩 거리 합 = 활동 거리
  - 강습으로 판정됨
  - 스트림 기반 휴식 판정을 실제 휴식 랩과 대조: 16개 중 15개가 ±1초 안에서 일치 (놓친 1개는 5초짜리)
- **Apple Watch 강습** (i194063325, 10/6)
  - 원본은 통짜 랩 1개였고, 재구성 후 휴식 23~24개
  - 수영 15분 20초, 1:48/100m로 강습 판정
  - 수정 전에는 "쉬지 않은 5:26/100m 자유수영"으로 오진했음
- 42e778c(랩 거리 보정)는 합성 데이터로만 확인함. 실데이터 재확인은 아직 안 함

## 운영 상태 (확인 필요)

- [ ] 서버(`/home/data/fingu`)에 42e778c까지 반영해 `docker compose up -d --build` 했는지
- [ ] 10/6 Apple Watch 수영 분석 알림이 실제로 왔는지, 랩 거리가 25m 단위로 나오는지
- [x] 서버 `.env`: `INTERVALS_API_KEY`, `ADMIN_TOKEN`, `INTERVALS_OWNER_ATHLETE_ID` 설정, `STRAVA_*` 제거
- [x] Apple Watch → intervals.icu companion app 연동

## 남은 계획

### 우선

1. **폴링 요약 로그**
   - 지금은 새 수영이 없으면 로그가 한 줄도 안 남는다
   - 그래서 "폴링은 정상인데 수영이 없음"과 "폴링이 멈춤"을 로그로 구분할 수 없다
   - 10/6에 타입 문제로 조용히 빠졌을 때도 로그가 비어 있었다
   - 폴링마다 `활동 N건, 새 수영 M건, 건너뛴 타입: …`을 남긴다
2. **비정상 랩 거르기**
   - Apple Watch 재구성 랩에 25m를 15초(1:00/100m)에 수영한 것처럼 나오는 랩이 있다. 레인 수를 잘못 센 것으로 보인다
   - 분석문이 이런 랩을 근거로 칭찬하면, 평소 페이스보다 터무니없이 빠른 랩을 표시하거나 제외한다

### 필요할 때

3. **두 기기 동시 기록 중복 처리**
   - Garmin과 Apple Watch를 함께 차면 같은 수영이 두 번 분석된다
   - 시작 시각이 겹치면 하나만 처리한다. 실제로 그렇게 쓰는지 먼저 확인할 것
4. **companion app 타입 문제 제보**
   - 풀 수영이 `OpenWaterSwim`, `pool_length=None`으로 올라온다
   - intervals.icu 포럼에 제보한다. fingu는 이미 대응했지만 intervals.icu 쪽 통계가 부정확하다
5. **Strava 재구독 시 복귀**
   - `STRAVA_*` 셋을 다시 설정하면 웹훅·OAuth가 켜진다
   - 이때 intervals 폴러와 같은 수영을 두 번 분석하지 않도록 한쪽을 꺼야 한다

### 기술 부채 (기존)

- **인증**: `athlete_id` 쿠키에 서명이 없어서 값을 위조할 수 있다. `/login`도 같은 쿠키를 심는다
- **git에 올라간 파일**
  - `node_modules/`, `data/*.db`, `.DS_Store`가 커밋돼 있다
  - `.gitignore`에는 `.env`만 있다
  - 서버에서 `npm ci`를 직접 하면 git 변경이 생기므로, 점검은 컨테이너 안 복사본에서 돌린다
- **서버에서 스크립트 실행**
  - 운영 이미지에는 `dist/`만 들어 있다
  - 그래서 `test:swim`/`probe:streams`는 일회용 `node:20` 컨테이너로 실행한다 (README 4절)

## 점검 명령 (서버)

```bash
cd /home/data/fingu
docker run --rm -it --env-file .env -v "$PWD":/src:ro node:20 \
  bash -c "cp -r /src /app && cd /app && rm -rf node_modules && npm ci --no-audit --no-fund && npm run test:swim -- i<id>"
# 스트림 모양: npm run probe:streams -- i<id> [i<id> ...]
# 놓친 수영 dry run: curl -s -X POST "localhost:3003/admin/backfill?token=$ADMIN_TOKEN&days=7"
```
