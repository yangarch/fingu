import axios from 'axios';
import { getValidAccessToken } from './token';
import { StravaActivity, StravaLap } from '../types/strava';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export async function getActivity(athleteId: number, activityId: number): Promise<StravaActivity> {
  const token = await getValidAccessToken(athleteId);
  const response = await axios.get(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

export async function getActivityLaps(athleteId: number, activityId: number): Promise<StravaLap[]> {
  const token = await getValidAccessToken(athleteId);
  const response = await axios.get(`${STRAVA_API_BASE}/activities/${activityId}/laps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

export async function updateActivityDescription(
  athleteId: number,
  activityId: number,
  description: string
): Promise<void> {
  const token = await getValidAccessToken(athleteId);
  await axios.put(
    `${STRAVA_API_BASE}/activities/${activityId}`,
    { description },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

export function formatPace(speedMs: number): string {
  if (speedMs <= 0) return 'N/A';
  const secondsPer100m = 100 / speedMs;
  const minutes = Math.floor(secondsPer100m / 60);
  const seconds = Math.round(secondsPer100m % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}
