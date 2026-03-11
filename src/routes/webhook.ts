import { Router, Request, Response } from 'express';
import { config } from '../config/env';
import { StravaWebhookPayload } from '../types/strava';
import { getActivity, getActivityLaps, updateActivityDescription } from '../services/strava';
import { analyzeSwim } from '../services/analyzer';
import { getAthlete, isActivityProcessed, markActivityProcessed } from '../db/models/athlete';

const router = Router();

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

  const analysisMarker = '🏊 AI 수영 분석';
  if (freshActivity.description?.includes(analysisMarker)) {
    console.log(`Activity ${activityId} already has analysis`);
    return;
  }

  const analysis = await analyzeSwim(freshActivity, laps);

  const existingDesc = freshActivity.description || '';
  const separator = existingDesc ? '\n\n---\n' : '';
  const newDescription = `${existingDesc}${separator}${analysisMarker}\n${analysis}`;

  await updateActivityDescription(athleteId, activityId, newDescription);
  markActivityProcessed(activityId, athleteId);

  console.log(`Successfully analyzed and updated activity ${activityId}`);
}

export default router;
