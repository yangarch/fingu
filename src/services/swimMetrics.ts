import { StravaStreams } from '../types/strava';

// Below this speed (m/s) the swimmer is treated as resting/paused, so that time
// is excluded from pace. Pool-swim streams sit near 0 during wall rests/drills
// and around 1 m/s while swimming.
const MOVING_VELOCITY_MS = 0.3;

export interface SplitStats {
  /** Segment length in metres (e.g. 100). */
  segMeters: number;
  /** Number of completed segments. */
  count: number;
  /** Fastest / slowest segment pace, seconds per 100m. */
  fastestPace: number;
  slowestPace: number;
  /** Average pace of the first vs. second half of the swim (sec / 100m). */
  firstHalfPace: number;
  secondHalfPace: number;
  /** Positive = faded (got slower) in the back half, as a percentage. */
  fadePercent: number;
  /** Coefficient of variation of split paces, as a percentage (lower = steadier). */
  cvPercent: number;
  /** Average HR over the first vs. last third of segments, if HR is present. */
  hrStart?: number;
  hrEnd?: number;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Computes per-segment (default 100 m) swim splits from time/distance streams,
 * excluding rest time so the pace reflects actual swimming. Returns null when
 * there isn't enough continuous data to say anything meaningful (needs at least
 * two full segments). This is what lets us judge whether a continuous swim held
 * an even pace or faded — the laps API alone only gives one averaged number.
 */
export function computeSwimSplits(streams: StravaStreams, segMeters = 100): SplitStats | null {
  const dist = streams.distance;
  const time = streams.time;
  if (!dist || !time || dist.length < 3 || dist.length !== time.length) return null;

  const total = dist[dist.length - 1];
  if (total < segMeters * 2) return null;

  const vel = streams.velocity_smooth;
  const hr = streams.heartrate;

  const paces: number[] = [];
  const hrs: number[] = [];

  let activeTime = 0; // cumulative swimming time (rest excluded)
  let prevBoundaryTime = 0;
  let nextTarget = segMeters;
  let hrSum = 0;
  let hrCount = 0;

  for (let i = 1; i < dist.length; i++) {
    const dt = time[i] - time[i - 1];
    const moving = vel ? vel[i] > MOVING_VELOCITY_MS : true;
    if (moving) activeTime += dt;
    if (hr && typeof hr[i] === 'number') {
      hrSum += hr[i];
      hrCount++;
    }

    // A single stream step can cross one or more segment boundaries.
    while (dist[i] >= nextTarget) {
      const d0 = dist[i - 1];
      const d1 = dist[i];
      const frac = d1 > d0 ? (nextTarget - d0) / (d1 - d0) : 1;
      const stepActive = moving ? dt : 0;
      const boundaryTime = activeTime - stepActive * (1 - frac);
      const segTime = boundaryTime - prevBoundaryTime;

      if (segTime > 0) {
        paces.push((segTime * 100) / segMeters); // normalise to seconds per 100m
        hrs.push(hrCount > 0 ? hrSum / hrCount : NaN);
      }

      prevBoundaryTime = boundaryTime;
      nextTarget += segMeters;
      hrSum = 0;
      hrCount = 0;
    }
  }

  if (paces.length < 2) return null;

  const half = Math.floor(paces.length / 2);
  const firstHalfPace = mean(paces.slice(0, half));
  const secondHalfPace = mean(paces.slice(half));
  const avg = mean(paces);
  const variance = mean(paces.map((p) => (p - avg) ** 2));
  const stdev = Math.sqrt(variance);

  const validHrs = hrs.filter((h) => !Number.isNaN(h));
  const third = Math.max(1, Math.floor(validHrs.length / 3));
  const hrStart = validHrs.length ? Math.round(mean(validHrs.slice(0, third))) : undefined;
  const hrEnd = validHrs.length ? Math.round(mean(validHrs.slice(-third))) : undefined;

  return {
    segMeters,
    count: paces.length,
    fastestPace: Math.min(...paces),
    slowestPace: Math.max(...paces),
    firstHalfPace,
    secondHalfPace,
    fadePercent: ((secondHalfPace - firstHalfPace) / firstHalfPace) * 100,
    cvPercent: (stdev / avg) * 100,
    hrStart,
    hrEnd,
  };
}
