import { getDb } from '../index';
import { StravaTokenData } from '../../types/strava';

export interface SwimAnalysis {
  id: number;
  activity_id: number;
  activity_name: string | null;
  activity_date: string | null;
  distance: number | null;
  analysis: string;
  processed_at: string;
}

export function saveAthlete(data: StravaTokenData): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO athletes (athlete_id, access_token, refresh_token, expires_at, athlete_name)
    VALUES (@athlete_id, @access_token, @refresh_token, @expires_at, @athlete_name)
    ON CONFLICT(athlete_id) DO UPDATE SET
      access_token = @access_token,
      refresh_token = @refresh_token,
      expires_at = @expires_at,
      athlete_name = @athlete_name,
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

export function deleteAthlete(athleteId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM athletes WHERE athlete_id = ?').run(athleteId);
  db.prepare('DELETE FROM processed_activities WHERE athlete_id = ?').run(athleteId);
  db.prepare('DELETE FROM swim_analyses WHERE athlete_id = ?').run(athleteId);
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

export function saveAnalysis(data: {
  activity_id: number;
  athlete_id: number;
  activity_name: string;
  activity_date: string;
  distance: number;
  analysis: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO swim_analyses (activity_id, athlete_id, activity_name, activity_date, distance, analysis)
    VALUES (@activity_id, @athlete_id, @activity_name, @activity_date, @distance, @analysis)
  `).run(data);
}

export function getAthleteAnalyses(athleteId: number): SwimAnalysis[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM swim_analyses WHERE athlete_id = ? ORDER BY processed_at DESC
  `).all(athleteId) as SwimAnalysis[];
}
