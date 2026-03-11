import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { getDb } from '../src/db/index';
import { getValidAccessToken } from '../src/services/token';
import { getActivity, getActivityLaps, formatPace, formatDuration } from '../src/services/strava';
import { analyzeSwim } from '../src/services/analyzer';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

async function main() {
  const db = getDb();

  // DB에서 첫 번째 athlete 가져오기
  const athlete = db.prepare('SELECT * FROM athletes LIMIT 1').get() as any;
  if (!athlete) {
    console.error('❌ DB에 인증된 사용자가 없습니다. /auth/strava 로 먼저 인증해 주세요.');
    process.exit(1);
  }
  console.log(`✅ Athlete ID: ${athlete.athlete_id}`);

  // 최근 활동 목록 조회
  const token = await getValidAccessToken(athlete.athlete_id);
  const activitiesRes = await axios.get(`${STRAVA_API_BASE}/athlete/activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { per_page: 20 },
  });

  const activities = activitiesRes.data as any[];

  // 수영 활동만 필터링
  const swims = activities.filter((a: any) => a.sport_type === 'Swim' || a.type === 'Swim');
  if (swims.length === 0) {
    console.error('❌ 최근 활동에서 수영 기록을 찾을 수 없습니다.');
    process.exit(1);
  }

  const latestSwim = swims[0];
  console.log(`\n🏊 최근 수영 활동: "${latestSwim.name}" (ID: ${latestSwim.id})`);
  console.log(`   날짜: ${new Date(latestSwim.start_date_local).toLocaleString('ko-KR')}`);
  console.log(`   거리: ${Math.round(latestSwim.distance)}m`);
  console.log(`   시간: ${formatDuration(latestSwim.moving_time)}`);
  console.log(`   페이스: ${formatPace(latestSwim.average_speed)}/100m`);

  // 상세 데이터 + 랩 조회
  console.log('\n📡 상세 데이터 및 랩 조회 중...');
  const [activity, laps] = await Promise.all([
    getActivity(athlete.athlete_id, latestSwim.id),
    getActivityLaps(athlete.athlete_id, latestSwim.id),
  ]);

  console.log(`   랩 수: ${laps.length}개`);
  if (activity.average_heartrate) {
    console.log(`   심박수: 평균 ${Math.round(activity.average_heartrate)}bpm / 최대 ${Math.round(activity.max_heartrate || 0)}bpm`);
  }

  // AI 분석
  console.log('\n🤖 AI 분석 중...');
  const analysis = await analyzeSwim(activity, laps);

  console.log('\n📝 분석 결과:');
  console.log('─'.repeat(60));
  console.log(analysis);
  console.log('─'.repeat(60));

  // description 업데이트 여부 확인
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\n이 분석 결과를 Strava description에 업데이트할까요? (y/N) ', async (answer) => {
    rl.close();
    if (answer.toLowerCase() === 'y') {
      const { updateActivityDescription } = await import('../src/services/strava');
      const { markActivityProcessed } = await import('../src/db/models/athlete');

      const existingDesc = activity.description || '';
      const separator = existingDesc ? '\n\n---\n' : '';
      const newDescription = `${existingDesc}${separator}🏊 AI 수영 분석\n${analysis}`;

      await updateActivityDescription(athlete.athlete_id, latestSwim.id, newDescription);
      markActivityProcessed(latestSwim.id, athlete.athlete_id);
      console.log('✅ Strava description 업데이트 완료!');
    } else {
      console.log('업데이트 취소.');
    }
  });
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
