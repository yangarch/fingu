import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env';
import { StravaActivity, StravaLap } from '../types/strava';
import { formatPace, formatDuration } from './strava';
import { SwimContext } from './swimContext';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Formats a pace given in seconds-per-100m as "m:ss". */
function paceStr(secPer100: number): string {
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Show at most this many per-lap lines in the prompt. Pool swims can record a
// lap per length (dozens of laps); beyond this we rely on the overall summary.
const MAX_LAP_LINES = 24;

// Laps shorter than this are treated as rest/instruction pauses rather than
// swimming. Real recordings encode a stop-and-listen break during a lesson as a
// near-zero-distance lap (the clock keeps running, so elapsed == moving and the
// "rest" never shows up as an elapsed−moving gap). This is the actual rest
// signal for pool swims — not elapsed−moving.
const PAUSE_MAX_DISTANCE_M = 10;

interface LapSummary {
  /** Number of laps that are actual swimming (distance ≥ threshold). */
  swimLapCount: number;
  /** Number of near-zero-distance laps treated as rest/instruction pauses. */
  pauseCount: number;
  /** Total time spent in those pauses, in seconds. */
  totalPauseSec: number;
  /** Fastest/slowest swim-lap pace, e.g. "1:24 ~ 2:25". Empty if none. */
  paceRange: string;
  /** Distances swum, e.g. "25m×28, 50m×1". Empty if none. */
  distanceBreakdown: string;
  /** HR spread across swim laps, e.g. "132~172bpm". Empty if no HR. */
  hrRange: string;
  /** One formatted line per lap, pauses marked as [정지/휴식]. */
  lapLines: string;
}

/**
 * Splits laps into real swim laps vs. rest/instruction pauses so the model gets
 * an honest picture of the session's structure. See PAUSE_MAX_DISTANCE_M for why
 * pauses are detected by distance, not by an elapsed−moving gap.
 */
function summarizeLaps(laps: StravaLap[]): LapSummary {
  const empty: LapSummary = {
    swimLapCount: 0,
    pauseCount: 0,
    totalPauseSec: 0,
    paceRange: '',
    distanceBreakdown: '',
    hrRange: '',
    lapLines: '없음',
  };
  if (!laps || laps.length === 0) return empty;

  const swimLaps = laps.filter((lap) => lap.distance >= PAUSE_MAX_DISTANCE_M);
  const pauses = laps.filter((lap) => lap.distance < PAUSE_MAX_DISTANCE_M);
  const totalPauseSec = pauses.reduce((sum, lap) => sum + lap.moving_time, 0);

  // Pace range from swim laps only (ignore pauses and zero-speed laps).
  const paces = swimLaps
    .filter((lap) => lap.average_speed > 0)
    .map((lap) => 100 / lap.average_speed) // seconds per 100m
    .sort((a, b) => a - b);
  const paceRange =
    paces.length > 0
      ? `${formatPace(100 / paces[0])} ~ ${formatPace(100 / paces[paces.length - 1])}`
      : '';

  // Distance histogram, e.g. "25m×28, 50m×1" — reveals lesson set structure.
  const distCounts = new Map<number, number>();
  swimLaps.forEach((lap) => {
    const d = Math.round(lap.distance);
    distCounts.set(d, (distCounts.get(d) ?? 0) + 1);
  });
  const distanceBreakdown = [...distCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => `${d}m×${n}`)
    .join(', ');

  // HR spread across swim laps.
  const hrs = swimLaps.map((lap) => lap.average_heartrate).filter((h): h is number => typeof h === 'number');
  const hrRange = hrs.length ? `${Math.round(Math.min(...hrs))}~${Math.round(Math.max(...hrs))}bpm` : '';

  const lines = laps.slice(0, MAX_LAP_LINES).map((lap, i) => {
    const dist = Math.round(lap.distance);
    if (lap.distance < PAUSE_MAX_DISTANCE_M) {
      return `  랩 ${i + 1}: [정지/휴식] ${formatDuration(lap.moving_time)}`;
    }
    return `  랩 ${i + 1}: ${dist}m, ${formatPace(lap.average_speed)}/100m, ${formatDuration(lap.moving_time)}`;
  });
  if (laps.length > MAX_LAP_LINES) {
    lines.push(`  ... 외 ${laps.length - MAX_LAP_LINES}개 랩 생략`);
  }

  return {
    swimLapCount: swimLaps.length,
    pauseCount: pauses.length,
    totalPauseSec,
    paceRange,
    distanceBreakdown,
    hrRange,
    lapLines: `\n${lines.join('\n')}`,
  };
}

export async function analyzeSwim(
  activity: StravaActivity,
  laps: StravaLap[],
  context: SwimContext = { splitStats: null, recentSwims: [] }
): Promise<string> {
  const pace = formatPace(activity.average_speed);
  const duration = formatDuration(activity.moving_time);
  const distanceM = Math.round(activity.distance);

  const { swimLapCount, pauseCount, totalPauseSec, paceRange, distanceBreakdown, hrRange, lapLines } =
    summarizeLaps(laps);

  const restInfo =
    pauseCount > 0
      ? `${pauseCount}회, 총 ${formatDuration(totalPauseSec)}`
      : '거의 없음 (쉬지 않고 이어서 수영)';
  const paceRangeInfo = paceRange ? `${paceRange}/100m` : '데이터 부족';
  const breakdownInfo = distanceBreakdown || '데이터 부족';

  let heartRateInfo = '없음';
  if (activity.average_heartrate) {
    heartRateInfo = `평균 ${Math.round(activity.average_heartrate)}bpm / 최대 ${Math.round(activity.max_heartrate || 0)}bpm`;
  }

  // Per-100m split analysis (rest excluded). Only meaningful for continuous
  // swims — in lessons/intervals the drills vary so wildly that splits are noise,
  // so skip the block when there are several pauses and rely on lap structure.
  const { splitStats, recentSwims } = context;
  let splitBlock = '';
  if (splitStats && pauseCount <= 2) {
    const fade = splitStats.fadePercent;
    const fadeText =
      fade > 3 ? `후반 ${fade.toFixed(0)}% 감속` : fade < -3 ? `후반 ${Math.abs(fade).toFixed(0)}% 가속` : '전후반 거의 동일';
    const hrDrift =
      splitStats.hrStart && splitStats.hrEnd
        ? ` / 심박 ${splitStats.hrStart}→${splitStats.hrEnd}bpm`
        : '';
    splitBlock = `
- 구간 분석 (100m 스플릿, 휴식 제외): 초반 ${paceStr(splitStats.firstHalfPace)} → 후반 ${paceStr(splitStats.secondHalfPace)} (${fadeText}), 가장 빠른 ${paceStr(splitStats.fastestPace)} / 가장 느린 ${paceStr(splitStats.slowestPace)}, 변동성(CV) ${splitStats.cvPercent.toFixed(0)}%${hrDrift}`;
  }

  let recentBlock = '';
  if (recentSwims.length > 0) {
    const lines = recentSwims.map((s) => `  ${s.date ?? '?'} ${s.distance}m ${s.pace}/100m`).join('\n');
    recentBlock = `\n\n[최근 수영 기록 (참고용)]\n${lines}`;
  }

  const prompt = `당신은 숙련된 수영 코치입니다. 아래 한 번의 수영 세션 데이터를 보고, 먼저 세션 유형을 스스로 판단한 뒤 그 유형에 맞는 피드백을 한국어 한 문단(3-5문장)으로 작성해 주세요.

[세션 유형 판단 기준]
- 강습/레슨: 중간에 멈춰서 설명을 듣는 '정지/휴식' 구간이 여러 번 있고, 랩 거리나 페이스가 구간마다 다양하게 섞임.
- 자유수영: 정지/휴식이 거의 없이 랩이 비교적 균일하게 이어짐.
- 인터벌 훈련: 일정한 휴식과 반복되는 세트 구조.

[작성 규칙]
- '정지/휴식' 구간은 코치의 교정·설명이나 세트 사이 휴식입니다. 이 시간을 '느려졌다'거나 페이스 문제로 절대 오해하지 마세요.
- 페이스 평가는 실제 수영 랩만 기준으로 하세요. 강습으로 판단되면 랩 간 편차 자체를 '문제'로 지적하지 말고, 교정 후 집중이나 특정 드릴 수행을 격려하세요.
- '구간 분석'이 있으면 페이스 일관성/후반 처짐/심박 드리프트 중 실제로 두드러진 점을 구체적으로 짚어 주세요 (예: 후반에 처졌다면 페이스 배분을, 일정했다면 그 점을 칭찬).
- '최근 수영 기록'이 있으면 거리·빈도·페이스 흐름 중 눈에 띄는 추이를 한 가지만 자연스럽게 언급하세요. 단, 강습과 자유수영이 섞여 있어 페이스를 1:1로 단정 비교하지는 마세요.
- 세션 유형을 한두 단어로 자연스럽게 언급하되(예: "오늘 강습에서는~", "꾸준한 자유수영이었네요~"), 수치를 그대로 나열하지 말고 코치처럼 대화하듯 쓰세요.
- 격려와 함께 구체적인 개선 포인트를 1가지 포함해 주세요.
- 결과는 Strava 활동 설명에 그대로 붙습니다. 제목, 마크다운 서식(##, **, ---, 목록 등) 없이 순수한 한 문단 텍스트로만 작성하세요. 다른 말이나 머리말 없이 피드백 문단만 출력하세요.

[수영 데이터]
- 총 거리: ${distanceM}m
- 실제 수영 시간: ${duration}
- 평균 페이스: ${pace}/100m
- 실제 수영 랩: ${swimLapCount}개 (거리 구성 ${breakdownInfo}, 페이스 범위 ${paceRangeInfo}${hrRange ? `, 심박 ${hrRange}` : ''})
- 정지/휴식 구간: ${restInfo}
- 심박수: ${heartRateInfo}${splitBlock}
- 랩별 데이터: ${lapLines}${recentBlock}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API');
  }
  return content.text;
}
