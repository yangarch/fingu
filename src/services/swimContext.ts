import { StravaActivity } from '../types/strava';
import { getActivityStreams, getRecentActivities, formatPace } from './strava';
import { computeSwimSplits, SplitStats } from './swimMetrics';

export interface RecentSwim {
  date?: string;
  distance: number;
  pace: string;
}

export interface SwimContext {
  /** Per-100m split analysis for continuous swims, or null when unavailable. */
  splitStats: SplitStats | null;
  /** Recent swims (excluding the current one) for trend context. */
  recentSwims: RecentSwim[];
}

const isSwim = (a: { sport_type?: string; type?: string }): boolean =>
  a.sport_type === 'Swim' || a.type === 'Swim';

/**
 * Gathers the extra data the analyzer uses beyond laps: stream-based splits and
 * recent-swim history. Each fetch is best-effort — failures degrade to empty so
 * analysis never breaks just because streams or history are missing.
 */
export async function buildSwimContext(athleteId: number, activity: StravaActivity): Promise<SwimContext> {
  const [streams, recent] = await Promise.all([
    getActivityStreams(athleteId, activity.id).catch(() => ({})),
    getRecentActivities(athleteId, 30).catch(() => []),
  ]);

  const splitStats = computeSwimSplits(streams);

  // Only swims strictly before this one, so trend context never references
  // activities that happened after the swim being analyzed (matters for backfill
  // of older activities; a no-op for the normal just-uploaded webhook case).
  const before = activity.start_date_local;
  const recentSwims: RecentSwim[] = recent
    .filter((a) => isSwim(a) && a.id !== activity.id)
    .filter((a) => !before || !a.start_date_local || a.start_date_local < before)
    .slice(0, 8)
    .map((a) => ({
      date: a.start_date_local?.slice(0, 10),
      distance: Math.round(a.distance),
      pace: formatPace(a.average_speed),
    }));

  return { splitStats, recentSwims };
}
