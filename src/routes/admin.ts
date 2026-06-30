import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import {
  getRecentActivities,
  getActivity,
  getActivityLaps,
  updateActivityDescription,
} from '../services/strava';
import { analyzeSwim } from '../services/analyzer';
import { ANALYSIS_MARKER, buildAnalyzedDescription } from './webhook';
import {
  getAllAthletes,
  isActivityProcessed,
  markActivityProcessed,
  saveAnalysis,
} from '../db/models/athlete';

const router = Router();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isSwim(activity: { sport_type?: string; type?: string }): boolean {
  return activity.sport_type === 'Swim' || activity.type === 'Swim';
}

/**
 * Re-analyze swims that were missed (e.g. during the model outage).
 *
 *   POST /admin/backfill?token=XXX&days=30&apply=true&perPage=50
 *
 * Defaults to a dry run (apply=false) that only lists candidates — no Anthropic
 * calls, no writes to Strava. Pass apply=true to actually analyze and update.
 * Already-analyzed activities (processed table or existing marker) are skipped.
 */
router.post('/backfill', async (req: Request, res: Response) => {
  const token = (req.query.token as string) || req.header('x-admin-token') || '';
  if (token !== config.admin.token) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const days = Math.max(1, parseInt((req.query.days as string) || '30', 10));
  const perPage = Math.min(200, Math.max(1, parseInt((req.query.perPage as string) || '50', 10)));
  const apply = req.query.apply === 'true';
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const candidates: Array<{ id: number; name: string; date?: string; distance: number }> = [];
  const analyzed: Array<{ id: number; name: string }> = [];
  const skipped: Array<{ id: number; reason: string }> = [];
  const failed: Array<{ id: number; error: string }> = [];

  try {
    const athletes = getAllAthletes();

    for (const athlete of athletes) {
      const activities = await getRecentActivities(athlete.athlete_id, perPage);

      const swims = activities.filter(
        (a) => isSwim(a) && (!a.start_date_local || new Date(a.start_date_local).getTime() >= cutoff)
      );

      for (const swim of swims) {
        if (isActivityProcessed(swim.id) || swim.description?.includes(ANALYSIS_MARKER)) {
          skipped.push({ id: swim.id, reason: 'already analyzed' });
          continue;
        }

        if (!apply) {
          candidates.push({
            id: swim.id,
            name: swim.name,
            date: swim.start_date_local,
            distance: Math.round(swim.distance),
          });
          continue;
        }

        try {
          const [activity, laps] = await Promise.all([
            getActivity(athlete.athlete_id, swim.id),
            getActivityLaps(athlete.athlete_id, swim.id),
          ]);

          // Re-check against the full (detail) description before writing.
          if (activity.description?.includes(ANALYSIS_MARKER)) {
            skipped.push({ id: swim.id, reason: 'already analyzed' });
            continue;
          }

          const analysis = await analyzeSwim(activity, laps);
          const newDescription = buildAnalyzedDescription(activity.description || '', analysis);

          await updateActivityDescription(athlete.athlete_id, swim.id, newDescription);
          markActivityProcessed(swim.id, athlete.athlete_id);
          saveAnalysis({
            activity_id: swim.id,
            athlete_id: athlete.athlete_id,
            activity_name: activity.name,
            activity_date: activity.start_date_local ?? new Date().toISOString(),
            distance: Math.round(activity.distance),
            analysis,
          });

          analyzed.push({ id: swim.id, name: activity.name });
          await sleep(1000); // be gentle with the Strava API between writes
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Backfill failed for activity ${swim.id}:`, err);
          failed.push({ id: swim.id, error: message });
        }
      }
    }

    res.json(
      apply
        ? { dryRun: false, days, analyzed, skipped, failed }
        : { dryRun: true, days, candidates, skipped, hint: 'add &apply=true to write to Strava' }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Backfill error:', err);
    res.status(500).json({ error: message, analyzed, failed });
  }
});

export default router;
