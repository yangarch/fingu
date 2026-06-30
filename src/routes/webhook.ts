import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { StravaWebhookPayload } from '../types/strava';
import { getActivity, getActivityLaps, updateActivityDescription } from '../services/strava';
import { analyzeSwim } from '../services/analyzer';
import { notifyFailure } from '../services/notifier';
import { getAthlete, isActivityProcessed, markActivityProcessed, saveAnalysis } from '../db/models/athlete';

const router = Router();

// Marker prepended to a Strava activity description once analyzed. Used to
// detect (and skip) already-analyzed activities here and in the backfill.
export const ANALYSIS_MARKER = '🏊 AI 수영 분석';

export function buildAnalyzedDescription(existingDesc: string, analysis: string): string {
  const separator = existingDesc ? '\n\n---\n' : '';
  return `${existingDesc}${separator}${ANALYSIS_MARKER}\n${analysis}`;
}

// Webhook subscription verification
router.get('/', (req: Request, res: Response) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

  if (mode === 'subscribe' && verifyToken === config.strava.verifyToken) {
    console.log('Webhook verified successfully');
    res.json({ 'hub.challenge': challenge });
    return;
  }

  res.status(403).send('Verification failed');
});

// Receive activity events
router.post('/', (req: Request, res: Response) => {
  const payload = req.body as StravaWebhookPayload;

  // Always respond 200 immediately
  res.sendStatus(200);

  if (payload.object_type !== 'activity' || payload.aspect_type !== 'create') {
    return;
  }

  const { object_id: activityId, owner_id: athleteId } = payload;

  // Check if athlete exists
  const athlete = getAthlete(athleteId);
  if (!athlete) {
    console.log(`Unknown athlete ${athleteId}, skipping`);
    return;
  }

  // Process asynchronously
  processActivity(activityId, athleteId).catch((err) => {
    console.error(`Failed to process activity ${activityId}:`, err);
    notifyFailure(`activity ${activityId} (athlete ${athleteId})`, err);
  });
});

async function processActivity(activityId: number, athleteId: number): Promise<void> {
  if (isActivityProcessed(activityId)) {
    console.log(`Activity ${activityId} already processed`);
    return;
  }

  const activity = await getActivity(athleteId, activityId);

  if (activity.sport_type !== 'Swim' && activity.type !== 'Swim') {
    console.log(`Activity ${activityId} is not a swim (${activity.sport_type}), skipping`);
    return;
  }

  console.log(`Processing swim activity ${activityId} for athlete ${athleteId}`);

  // Wait a bit to avoid description conflicts
  await new Promise((resolve) => setTimeout(resolve, 7000));

  const laps = await getActivityLaps(athleteId, activityId);

  const freshActivity = await getActivity(athleteId, activityId);

  if (freshActivity.description?.includes(ANALYSIS_MARKER)) {
    console.log(`Activity ${activityId} already has analysis`);
    return;
  }

  const analysis = await analyzeSwim(freshActivity, laps);

  const newDescription = buildAnalyzedDescription(freshActivity.description || '', analysis);

  await updateActivityDescription(athleteId, activityId, newDescription);
  markActivityProcessed(activityId, athleteId);
  saveAnalysis({
    activity_id: activityId,
    athlete_id: athleteId,
    activity_name: freshActivity.name,
    activity_date: freshActivity.start_date_local ?? new Date().toISOString(),
    distance: Math.round(freshActivity.distance),
    analysis,
  });

  console.log(`Successfully analyzed and updated activity ${activityId}`);
}

export default router;
