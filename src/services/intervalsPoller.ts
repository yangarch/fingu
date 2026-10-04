import { config } from '../config/env';
import { getAllAthletes, isActivityProcessed, markActivityProcessed, saveAnalysis } from '../db/models/athlete';
import { analyzeSwim } from './analyzer';
import { getActivityWithLaps, isSwimType, listActivities } from './intervals';
import { notifyAnalysis, notifyFailure } from './notifier';
import { buildSwimContext, intervalsSource } from './swimContext';

/**
 * intervals.icu pipeline — replaces the Strava webhook since 2026-09-30.
 *
 *   poll (every INTERVALS_POLL_MINUTES) → new swims → analyze → DB + notification
 *
 * Nothing is written back to the activity, so duplicate protection is the
 * processed_activities table alone (the description marker only applies to the
 * preserved Strava path). The Strava path's 7-second wait isn't needed either:
 * it guarded a race on writing the Strava description.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 14;

export interface SyncResult {
  dryRun: boolean;
  window: { oldest: string; newest: string };
  candidates: Array<{ id: number; name: string; date?: string; distance: number }>;
  analyzed: Array<{ id: number; name: string }>;
  failed: Array<{ id: number; error: string }>;
}

export class SyncBusyError extends Error {}

let running = false;

/** DB athlete the analyses belong to — what the dashboard shows. */
export function resolveOwnerAthleteId(): number {
  const configured = config.intervals?.ownerAthleteId;
  if (configured) return configured;
  const athletes = getAllAthletes();
  if (athletes.length === 1) return athletes[0].athlete_id;
  throw new Error(
    `Cannot pick dashboard owner: ${athletes.length} athletes in DB — set INTERVALS_OWNER_ATHLETE_ID`
  );
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Finds swims in the last `days` (never before INTERVALS_SINCE) that haven't been
 * analyzed. With apply=false only lists them; with apply=true analyzes each one.
 * Per-activity failures are collected, not thrown, so one bad swim doesn't block
 * the rest. Only one sync runs at a time (poller vs. admin backfill).
 */
export async function syncSwims(opts: { days?: number; apply: boolean }): Promise<SyncResult> {
  const since = config.intervals?.since ?? '';
  if (running) throw new SyncBusyError('A sync is already running');
  running = true;
  try {
    const days = opts.days ?? DEFAULT_LOOKBACK_DAYS;
    const lookback = ymd(new Date(Date.now() - days * DAY_MS));
    const oldest = lookback > since ? lookback : since;
    // +1 day: the server clock (UTC in Docker) can be behind the swim's local date.
    const newest = ymd(new Date(Date.now() + DAY_MS));

    const result: SyncResult = { dryRun: !opts.apply, window: { oldest, newest }, candidates: [], analyzed: [], failed: [] };

    const activities = await listActivities(oldest, newest);
    const swims = activities.filter(
      (a) => isSwimType(a.type) && (a.start_date_local ?? '').slice(0, 10) >= since && !isActivityProcessed(a.id)
    );
    if (swims.length === 0) return result;

    if (!opts.apply) {
      result.candidates = swims.map((s) => ({
        id: s.id,
        name: s.name,
        date: s.start_date_local,
        distance: Math.round(s.distance),
      }));
      return result;
    }

    const ownerId = resolveOwnerAthleteId();
    // Oldest first, so trend context and notifications arrive in order.
    for (const swim of [...swims].reverse()) {
      try {
        await analyzeAndSave(swim.id, ownerId);
        result.analyzed.push({ id: swim.id, name: swim.name });
      } catch (err) {
        console.error(`intervals: failed to analyze activity ${swim.id}:`, err);
        result.failed.push({ id: swim.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return result;
  } finally {
    running = false;
  }
}

async function analyzeAndSave(activityId: number, ownerId: number): Promise<void> {
  const { activity, laps } = await getActivityWithLaps(activityId);
  const swimContext = await buildSwimContext(activity, intervalsSource);
  const analysis = await analyzeSwim(activity, laps, swimContext);

  markActivityProcessed(activityId, ownerId);
  saveAnalysis({
    activity_id: activityId,
    athlete_id: ownerId,
    activity_name: activity.name,
    activity_date: activity.start_date_local ?? new Date().toISOString(),
    distance: Math.round(activity.distance),
    analysis,
  });

  const date = activity.start_date_local?.slice(0, 10) ?? '';
  await notifyAnalysis(`${activity.name} · ${date} · ${Math.round(activity.distance)}m`, analysis);
  console.log(`intervals: analyzed activity ${activityId} (${activity.name})`);
}

// Alert state, so a persistent failure pages once instead of every poll.
// A failed swim stays unprocessed and is retried on the next poll.
const alertedActivities = new Set<number>();
let pollFailing = false;

async function pollOnce(): Promise<void> {
  try {
    const result = await syncSwims({ apply: true });
    if (pollFailing) console.log('intervals: polling recovered');
    pollFailing = false;

    result.analyzed.forEach((a) => alertedActivities.delete(a.id));
    for (const f of result.failed) {
      if (alertedActivities.has(f.id)) continue;
      alertedActivities.add(f.id);
      await notifyFailure(`intervals.icu activity ${f.id} (재시도는 다음 폴링에서 계속)`, f.error);
    }
  } catch (err) {
    if (err instanceof SyncBusyError) return; // admin backfill in progress
    console.error('intervals: poll failed:', err);
    if (!pollFailing) {
      pollFailing = true;
      await notifyFailure('intervals.icu 폴링 실패 (복구될 때까지 추가 알림 없음)', err);
    }
  }
}

export function startIntervalsPolling(): void {
  if (!config.intervals) return;
  const minutes = config.intervals.pollMinutes;
  console.log(`intervals: polling every ${minutes} min (swims since ${config.intervals.since})`);
  void pollOnce();
  setInterval(() => void pollOnce(), minutes * 60 * 1000);
}
