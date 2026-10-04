import dotenv from 'dotenv';
dotenv.config();

import { formatPace, formatDuration } from '../src/services/strava';
import { getActivityStreams, getActivityWithLaps, isSwimType, listActivities, toActivityId } from '../src/services/intervals';
import { buildSwimContext, intervalsSource } from '../src/services/swimContext';
import { analyzeSwim } from '../src/services/analyzer';

// 최근 수영(또는 인자로 준 intervals id, 예: i123456789)을 intervals.icu에서 받아
// 데이터 모양을 점검하고 분석을 돌린다. DB 저장·알림 전송은 하지 않는다.
//   npm run test:swim            # 최근 30일 중 가장 최근 수영
//   npm run test:swim -- i123    # 특정 활동
async function main() {
  const arg = process.argv[2];
  let activityId: number;

  if (arg) {
    activityId = toActivityId(arg);
  } else {
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const now = Date.now();
    const activities = await listActivities(ymd(new Date(now - 30 * 86400000)), ymd(new Date(now + 86400000)));
    const swim = activities.find((a) => isSwimType(a.type));
    if (!swim) {
      console.error('❌ 최근 30일 intervals.icu 활동에서 수영(type=Swim)을 찾지 못했습니다.');
      console.error(`   받은 활동 타입: ${[...new Set(activities.map((a) => a.type))].join(', ') || '없음'}`);
      process.exit(1);
    }
    activityId = swim.id;
  }

  const { activity, laps } = await getActivityWithLaps(activityId);
  console.log(`\n🏊 "${activity.name}" (id ${activityId}, type ${activity.type})`);
  console.log(`   날짜: ${activity.start_date_local}`);
  console.log(`   거리: ${Math.round(activity.distance)}m · 수영 ${formatDuration(activity.moving_time)} · 경과 ${formatDuration(activity.elapsed_time)}`);
  console.log(`   페이스: ${formatPace(activity.average_speed)}/100m`);
  if (activity.average_heartrate) {
    console.log(`   심박수: 평균 ${Math.round(activity.average_heartrate)}bpm / 최대 ${Math.round(activity.max_heartrate || 0)}bpm`);
  }

  // 분석기의 휴식 판정은 "거리 10m 미만 랩 = 휴식"에 기대고 있다(Strava 시절 실측).
  // intervals.icu의 icu_intervals에도 휴식이 0m 랩으로 남는지 여기서 확인한다.
  console.log(`\n🔍 랩(icu_intervals) ${laps.length}개 — 휴식이 0m 랩으로 보이는지 확인`);
  laps.slice(0, 30).forEach((lap, i) => {
    const pause = lap.distance < 10 ? ' ← 휴식 판정' : '';
    console.log(`   랩 ${i + 1}: ${Math.round(lap.distance)}m, ${formatPace(lap.average_speed)}/100m, 수영 ${formatDuration(lap.moving_time)}, 경과 ${formatDuration(lap.elapsed_time)}${pause}`);
  });
  if (laps.length > 30) console.log(`   ... 외 ${laps.length - 30}개`);
  const lapSum = laps.reduce((s, l) => s + l.distance, 0);
  console.log(`   랩 거리 합 ${Math.round(lapSum)}m vs 활동 거리 ${Math.round(activity.distance)}m`);

  const streams = await getActivityStreams(activityId).catch((err) => {
    console.log(`   스트림 조회 실패: ${err.message}`);
    return {};
  });
  const lens = Object.entries(streams).map(([k, v]) => `${k}=${(v as unknown[] | undefined)?.length ?? '없음'}`);
  console.log(`\n📈 스트림: ${lens.join(', ') || '없음'}`);

  console.log('\n🤖 AI 분석 중...');
  const swimContext = await buildSwimContext(activity, intervalsSource);
  console.log(`   스플릿: ${swimContext.splitStats ? `${swimContext.splitStats.count}개 구간` : '없음'} · 최근 수영 ${swimContext.recentSwims.length}건`);
  const analysis = await analyzeSwim(activity, laps, swimContext);

  console.log('\n📝 분석 결과 (저장·전송 안 함):');
  console.log('─'.repeat(60));
  console.log(analysis);
  console.log('─'.repeat(60));
}

main().catch((err) => {
  const detail = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data).slice(0, 300)}` : err.message || err;
  console.error('Error:', detail);
  process.exit(1);
});
