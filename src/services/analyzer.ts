import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env';
import { StravaActivity, StravaLap } from '../types/strava';
import { formatPace, formatDuration } from './strava';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Show at most this many per-lap lines in the prompt. Pool swims can record a
// lap per length (dozens of laps); beyond this we rely on the overall summary.
const MAX_LAP_LINES = 20;

interface LapSummary {
  /** One formatted line per lap: distance / pace / swim time / rest. */
  lapLines: string;
  /** Total rest across all laps, in seconds (elapsed − moving). */
  totalLapRest: number;
}

/**
 * Builds the per-lap breakdown fed to the model. The key signal is each lap's
 * REST time (`elapsed_time − moving_time`): during lessons the swimmer stops to
 * hear corrections, which shows up as long rests — not as slow swimming. Pace
 * is reported from `moving_time` so those pauses aren't mistaken for slowdowns.
 */
function summarizeLaps(laps: StravaLap[]): LapSummary {
  if (!laps || laps.length === 0) {
    return { lapLines: '없음', totalLapRest: 0 };
  }

  const totalLapRest = laps.reduce(
    (sum, lap) => sum + Math.max(0, lap.elapsed_time - lap.moving_time),
    0
  );

  const lines = laps.slice(0, MAX_LAP_LINES).map((lap, i) => {
    const rest = Math.max(0, lap.elapsed_time - lap.moving_time);
    const restText = rest > 0 ? formatDuration(rest) : '없음';
    return `  랩 ${i + 1}: ${Math.round(lap.distance)}m, ${formatPace(lap.average_speed)}/100m, 수영 ${formatDuration(lap.moving_time)}, 휴식 ${restText}`;
  });

  if (laps.length > MAX_LAP_LINES) {
    lines.push(`  ... 외 ${laps.length - MAX_LAP_LINES}개 랩 생략`);
  }

  return { lapLines: `\n${lines.join('\n')}`, totalLapRest };
}

export async function analyzeSwim(activity: StravaActivity, laps: StravaLap[]): Promise<string> {
  const pace = formatPace(activity.average_speed);
  const movingDuration = formatDuration(activity.moving_time);
  const elapsedDuration = formatDuration(activity.elapsed_time);
  const distanceM = Math.round(activity.distance);

  // Overall rest: gap between wall-clock elapsed time and actual swimming time.
  const totalRest = Math.max(0, activity.elapsed_time - activity.moving_time);
  const restDuration = totalRest > 0 ? formatDuration(totalRest) : '거의 없음';

  const { lapLines } = summarizeLaps(laps);

  let heartRateInfo = '없음';
  if (activity.average_heartrate) {
    heartRateInfo = `평균 ${Math.round(activity.average_heartrate)}bpm / 최대 ${Math.round(activity.max_heartrate || 0)}bpm`;
  }

  const prompt = `당신은 숙련된 수영 코치입니다. 아래 한 번의 수영 세션 데이터를 보고, 먼저 세션 유형을 스스로 판단한 뒤 그 유형에 맞는 피드백을 한국어 한 문단(3-5문장)으로 작성해 주세요.

[세션 유형 판단 기준]
- 강습/레슨: 랩 사이 휴식이 길고 불규칙함(코치의 교정·설명 시간). 거리나 페이스가 구간마다 다양하게 섞임.
- 자유수영: 휴식이 거의 없거나 짧고, 랩이 비교적 균일하게 이어짐.
- 인터벌 훈련: 일정한 휴식과 반복되는 세트 구조.

[작성 규칙]
- 페이스 평가는 반드시 '실제 수영 시간(휴식 제외)' 기준으로만 하세요. 랩 사이의 긴 휴식을 느려진 것으로 오해하지 마세요.
- 강습으로 판단되면, 교정 후 페이스 회복이나 집중을 격려하고 랩 간 편차 자체를 '문제'로 지적하지 마세요.
- 세션 유형을 한두 단어로 자연스럽게 언급하되(예: "오늘 강습에서는~", "꾸준한 자유수영이었네요~"), 수치를 나열하지 말고 코치처럼 대화하듯 쓰세요.
- 격려와 함께 구체적인 개선 포인트를 1가지 포함해 주세요.

[수영 데이터]
- 총 거리: ${distanceM}m
- 실제 수영 시간: ${movingDuration} / 총 경과 시간: ${elapsedDuration} (휴식 합계: ${restDuration})
- 평균 페이스: ${pace}/100m
- 심박수: ${heartRateInfo}
- 랩별 데이터 (거리 / 페이스 / 수영시간 / 휴식): ${lapLines}`;

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
