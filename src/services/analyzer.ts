import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env';
import { StravaActivity, StravaLap } from '../types/strava';
import { formatPace, formatDuration } from './strava';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export async function analyzeSwim(activity: StravaActivity, laps: StravaLap[]): Promise<string> {
  const pace = formatPace(activity.average_speed);
  const duration = formatDuration(activity.moving_time);
  const distanceM = Math.round(activity.distance);

  let lapsInfo = '없음';
  if (laps && laps.length > 0) {
    const lapLines = laps
      .slice(0, 10)
      .map((lap, i) => `  랩 ${i + 1}: ${Math.round(lap.distance)}m, ${formatPace(lap.average_speed)}/100m, ${formatDuration(lap.moving_time)}`)
      .join('\n');
    lapsInfo = `\n${lapLines}`;
  }

  let heartRateInfo = '없음';
  if (activity.average_heartrate) {
    heartRateInfo = `평균 ${Math.round(activity.average_heartrate)}bpm / 최대 ${Math.round(activity.max_heartrate || 0)}bpm`;
  }

  const prompt = `당신은 수영 코치입니다. 아래 수영 데이터를 분석하여 한국어로 한 문단(3-5문장)의 간결한 피드백을 작성해 주세요. 격려와 구체적인 개선 포인트를 포함해 주세요.

[수영 데이터]
- 총 거리: ${distanceM}m
- 운동 시간: ${duration}
- 평균 페이스: ${pace}/100m
- 랩 데이터: ${lapsInfo}
- 심박수: ${heartRateInfo}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude API');
  }
  return content.text;
}
