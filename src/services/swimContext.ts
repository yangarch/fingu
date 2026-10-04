import { StravaActivity, StravaStreams } from '../types/strava';
import { getActivityStreams, getRecentActivities, formatPace } from './strava';
import * as intervals from './intervals';
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

/** Where the extra context comes from — Strava (preserved) or intervals.icu. */
export interface SwimDataSource {
  getStreams(activityId: number): Promise<StravaStreams>;
  /** Recent activities (any type), newest first. */
  getRecent(activity: StravaActivity): Promise<StravaActivity[]>;
}

export function stravaSource(athleteId: number): SwimDataSource {
  return {
    getStreams: (id) => getActivityStreams(athleteId, id),
    getRecent: () => getRecentActivities(athleteId, 30),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const intervalsSource: SwimDataSource = {
  getStreams: (id) => intervals.getActivityStreams(id),
  getRecent: (activity) => {
    // The 90 days up to the swim (inclusive) — plenty for the 8 swims we show.
    const end = activity.start_date_local ? new Date(activity.start_date_local) : new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    return intervals.listActivities(ymd(new Date(end.getTime() - 90 * DAY_MS)), ymd(end));
  },
};

/**
 * Gathers the extra data the analyzer uses beyond laps: stream-based splits and
 * recent-swim history. Each fetch is best-effort — failures degrade to empty so
 * analysis never breaks just because streams or history are missing.
 */
export async function buildSwimContext(activity: StravaActivity, source: SwimDataSource): Promise<SwimContext> {
  const [streams, recent] = await Promise.all([
    source.getStreams(activity.id).catch(() => ({})),
    source.getRecent(activity).catch(() => []),
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
