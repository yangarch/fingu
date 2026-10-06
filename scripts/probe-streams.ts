import dotenv from 'dotenv';
dotenv.config();

import { getActivityStreams, getActivityWithLaps, toActivityId } from '../src/services/intervals';

// 스트림 모양 점검 — 랩이 없는 기록(Apple Watch: 통짜 랩 1개)에서 휴식을 스트림으로
// 찾을 수 있는지 보기 위한 진단. 거리가 연속으로 늘어나는지, 25m 계단으로 뛰는지,
// 멈춘 구간(정지 후보)이 어떻게 분포하는지 출력한다. 저장·전송 없음, Anthropic 호출 없음.
//   npm run probe:streams -- i194063325 i192444656
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function probe(icuId: string) {
  const id = toActivityId(icuId);
  const [{ activity, laps }, st] = await Promise.all([getActivityWithLaps(id), getActivityStreams(id)]);
  const time = st.time ?? [];
  const dist = st.distance ?? [];
  const vel = st.velocity_smooth ?? [];
  const hr = st.heartrate ?? [];
  console.log(`\n=== ${icuId} "${activity.name}" ${activity.type} · ${Math.round(activity.distance)}m · 랩 ${laps.length}개 · 점 ${time.length}개`);
  if (time.length < 2) return;

  const dts = time.slice(1).map((t, i) => t - time[i]);
  const dtHist = new Map<number, number>();
  dts.forEach((d) => dtHist.set(d, (dtHist.get(d) ?? 0) + 1));
  console.log(`  샘플 간격(초): ${[...dtHist].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${d}s×${n}`).join(', ')}`);

  // 거리 증가 크기 분포 — 연속(작은 값 다수)인지, 계단(25 근처)인지
  const incs = dist.slice(1).map((d, i) => d - dist[i]).filter((x) => x > 0.01);
  const incHist = new Map<string, number>();
  incs.forEach((x) => {
    const b = x < 1 ? '<1' : x < 3 ? '1-3' : x < 10 ? '3-10' : x < 20 ? '10-20' : x < 30 ? '20-30' : '30+';
    incHist.set(b, (incHist.get(b) ?? 0) + 1);
  });
  console.log(`  거리 증가 ${incs.length}회, 크기 분포: ${[...incHist].map(([b, n]) => `${b}m×${n}`).join(', ')}`);
  const slowPts = vel.filter((v) => v < 0.3).length;
  console.log(`  속도<0.3m/s 점 비율: ${((slowPts / Math.max(1, vel.length)) * 100).toFixed(0)}%`);

  // 거리가 멈춘 구간(≥10초) 목록
  const plateaus: Array<{ start: number; dur: number; d: number; hr: number }> = [];
  let i = 0;
  while (i < dist.length - 1) {
    let j = i;
    while (j + 1 < dist.length && dist[j + 1] - dist[i] < 0.5) j++;
    const dur = time[j] - time[i];
    if (dur >= 10) {
      const hs = hr.slice(i, j + 1).filter((h) => typeof h === 'number');
      plateaus.push({ start: time[i], dur, d: dist[i], hr: hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0 });
    }
    i = j + 1;
  }
  const total = plateaus.reduce((s, p) => s + p.dur, 0);
  console.log(`  거리 정지 구간(≥10초) ${plateaus.length}개, 합계 ${mmss(total)} / 전체 ${mmss(time[time.length - 1] - time[0])}`);
  const durHist = new Map<string, number>();
  plateaus.forEach((p) => {
    const b = p.dur < 20 ? '10-19s' : p.dur < 40 ? '20-39s' : p.dur < 60 ? '40-59s' : p.dur < 120 ? '1-2m' : '2m+';
    durHist.set(b, (durHist.get(b) ?? 0) + 1);
  });
  console.log(`  길이 분포: ${[...durHist].map(([b, n]) => `${b}×${n}`).join(', ')}`);
  plateaus.slice(0, 40).forEach((p) => console.log(`    @${mmss(p.start)} ${mmss(p.dur)} 정지, 거리 ${Math.round(p.d)}m, 심박 ${p.hr || '-'}`));
  if (plateaus.length > 40) console.log(`    ... 외 ${plateaus.length - 40}개`);
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('사용법: npm run probe:streams -- i194063325 [i192444656 ...]');
    process.exit(1);
  }
  for (const id of ids) await probe(id);
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
