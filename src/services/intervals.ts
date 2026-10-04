import axios from 'axios';
import { config } from '../config/env';
import { IntervalsActivity, IntervalsInterval, IntervalsStream } from '../types/intervals';
import { StravaActivity, StravaLap, StravaStreams } from '../types/strava';

/**
 * intervals.icu client (Garmin → intervals.icu → fingu). Responses are mapped to
 * the existing Strava types so the analyzer and metrics code stay source-agnostic.
 *
 * Auth: personal API key as Basic auth (username "API_KEY"), athlete id "0" = self.
 * Webhooks are OAuth-app only, so new activities are found by polling.
 */
const API = 'https://intervals.icu/api/v1';
// intervals.icu sits behind Cloudflare, which blocks some default client UAs
// (error 1010) — always send an explicit one.
const USER_AGENT = 'fingu/1.0 (personal swim coach)';

// Numeric activity id = 10^12 + intervals number ("i192065295" → 1000192065295).
// Keeps intervals ids in their own range, clear of Strava ids (~1e10) already
// stored in processed_activities / swim_analyses. Same scheme as trisplit.
const ID_OFFSET = 1_000_000_000_000;

export function toActivityId(icuId: string): number {
  return ID_OFFSET + parseInt(icuId.replace(/^i/, ''), 10);
}

export function toIcuId(activityId: number): string {
  return `i${activityId - ID_OFFSET}`;
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const apiKey = config.intervals?.apiKey;
  if (!apiKey) throw new Error('intervals.icu is not configured (INTERVALS_API_KEY unset)');
  try {
    const response = await axios.get<T>(`${API}${path}`, {
      params,
      auth: { username: 'API_KEY', password: apiKey },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 30000,
    });
    return response.data;
  } catch (err) {
    // Re-throw without the AxiosError's request config — it carries the API key,
    // and these errors get logged and sent to the notification webhook.
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response ? JSON.stringify(err.response.data).slice(0, 300) : err.code;
      throw new IntervalsError(`intervals.icu ${status ?? 'request'} failed for ${path}: ${body}`, status);
    }
    throw err;
  }
}

export class IntervalsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'IntervalsError';
  }
}

export function isSwimType(type?: string): boolean {
  return type === 'Swim';
}

function toStravaActivity(a: IntervalsActivity): StravaActivity {
  const distance = a.distance ?? 0;
  const movingTime = a.moving_time ?? 0;
  return {
    id: toActivityId(a.id),
    name: a.name ?? '수영',
    distance,
    moving_time: movingTime,
    elapsed_time: a.elapsed_time ?? movingTime,
    sport_type: a.type ?? '',
    type: a.type ?? '',
    average_speed: a.average_speed ?? (movingTime > 0 ? distance / movingTime : 0),
    max_speed: a.max_speed ?? 0,
    average_heartrate: a.average_heartrate,
    max_heartrate: a.max_heartrate,
    description: a.description ?? undefined,
    // Strava marks local time with a trailing Z; match it so stored dates and
    // string comparisons in swimContext behave the same for both sources.
    start_date_local: a.start_date_local ? `${a.start_date_local}Z` : undefined,
  };
}

function toLap(iv: IntervalsInterval, index: number): StravaLap {
  const distance = iv.distance ?? 0;
  const movingTime = iv.moving_time ?? iv.elapsed_time ?? 0;
  return {
    id: index,
    name: `Lap ${index + 1}`,
    distance,
    elapsed_time: iv.elapsed_time ?? movingTime,
    moving_time: movingTime,
    average_speed: iv.average_speed ?? (movingTime > 0 ? distance / movingTime : 0),
    max_speed: iv.max_speed ?? 0,
    average_heartrate: iv.average_heartrate,
    lap_index: index + 1,
  };
}

/** Activities whose local start date is within [oldest, newest] (YYYY-MM-DD), newest first. */
export async function listActivities(oldest: string, newest: string): Promise<StravaActivity[]> {
  const list = await get<IntervalsActivity[]>('/athlete/0/activities', { oldest, newest });
  return list
    .map(toStravaActivity)
    .sort((a, b) => (b.start_date_local ?? '').localeCompare(a.start_date_local ?? ''));
}

/**
 * Activity detail plus its intervals, mapped to Strava activity + laps. The
 * analyzer's rest detection relies on rest showing up as near-zero-distance
 * laps (see PAUSE_MAX_DISTANCE_M) — verify with `npm run test:swim` that
 * intervals.icu keeps those for pool swims.
 */
export async function getActivityWithLaps(activityId: number): Promise<{ activity: StravaActivity; laps: StravaLap[] }> {
  const a = await get<IntervalsActivity>(`/activity/${toIcuId(activityId)}`, { intervals: 'true' });
  return { activity: toStravaActivity(a), laps: (a.icu_intervals ?? []).map(toLap) };
}

export async function getActivityStreams(activityId: number): Promise<StravaStreams> {
  const streams = await get<IntervalsStream[]>(`/activity/${toIcuId(activityId)}/streams.json`, {
    types: 'time,distance,velocity_smooth,heartrate',
  });
  const byType = new Map(streams.map((s) => [s.type, s.data]));
  // computeSwimSplits indexes these arrays in lockstep; nulls (sensor gaps) are
  // filled from the previous point rather than dropped, to keep them aligned.
  const filled = (type: string): number[] | undefined => {
    const data = byType.get(type);
    if (!data) return undefined;
    let last = 0;
    return data.map((v) => (typeof v === 'number' ? (last = v) : last));
  };
  return {
    time: filled('time'),
    distance: filled('distance'),
    velocity_smooth: filled('velocity_smooth'),
    // HR gaps stay null: computeSwimSplits skips non-numbers, while filling
    // would pull segment averages toward the fill value.
    heartrate: byType.get('heartrate') as number[] | undefined,
  };
}
