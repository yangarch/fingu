import { getDb } from '../index';
import { StravaTokenData } from '../../types/strava';

export function saveAthlete(data: StravaTokenData): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO athletes (athlete_id, access_token, refresh_token, expires_at)
    VALUES (@athlete_id, @access_token, @refresh_token, @expires_at)
    ON CONFLICT(athlete_id) DO UPDATE SET
      access_token = @access_token,
      refresh_token = @refresh_token,
      expires_at = @expires_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(data);
}

export function getAthlete(athleteId: number): StravaTokenData | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM athletes WHERE athlete_id = ?').get(athleteId) as StravaTokenData | undefined;
}

export function updateTokens(athleteId: number, accessToken: string, refreshToken: string, expiresAt: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE athletes
    SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE athlete_id = ?
  `).run(accessToken, refreshToken, expiresAt, athleteId);
}

export function markActivityProcessed(activityId: number, athleteId: number): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO processed_activities (activity_id, athlete_id)
    VALUES (?, ?)
  `).run(activityId, athleteId);
}

export function isActivityProcessed(activityId: number): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM processed_activities WHERE activity_id = ?').get(activityId);
  return !!row;
}
