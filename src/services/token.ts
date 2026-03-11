import axios from 'axios';
import { config } from '../config/env';
import { getAthlete, updateTokens } from '../db/models/athlete';
import { StravaTokenData } from '../types/strava';

export async function getValidAccessToken(athleteId: number): Promise<string> {
  const athlete = getAthlete(athleteId);
  if (!athlete) {
    throw new Error(`Athlete ${athleteId} not found in database`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (athlete.expires_at > now + 300) {
    return athlete.access_token;
  }

  return refreshAccessToken(athlete);
}

async function refreshAccessToken(athlete: StravaTokenData): Promise<string> {
  const response = await axios.post('https://www.strava.com/oauth/token', {
    client_id: config.strava.clientId,
    client_secret: config.strava.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: athlete.refresh_token,
  });

  const { access_token, refresh_token, expires_at } = response.data;
  updateTokens(athlete.athlete_id, access_token, refresh_token, expires_at);
  return access_token;
}
