import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config/env';
import { saveAthlete, deleteAthlete, getAthlete } from '../db/models/athlete';
import { StravaTokenResponse } from '../types/strava';

const router = Router();

router.get('/strava', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: config.strava.clientId,
    redirect_uri: `${config.server.baseUrl}/auth/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all,activity:write',
  });
  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

router.get('/strava/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error || !code) {
    res.status(400).send(`인증 실패: ${error || '코드 없음'}`);
    return;
  }

  try {
    const response = await axios.post<StravaTokenResponse>('https://www.strava.com/oauth/token', {
      client_id: config.strava.clientId,
      client_secret: config.strava.clientSecret,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_at, athlete } = response.data;

    if (!athlete) {
      res.status(500).send('선수 정보를 가져올 수 없습니다.');
      return;
    }

    saveAthlete({
      athlete_id: athlete.id,
      access_token,
      refresh_token,
      expires_at,
      athlete_name: `${athlete.firstname} ${athlete.lastname}`,
    });

    res.cookie('athlete_id', String(athlete.id), { httpOnly: true, sameSite: 'lax' });
    res.redirect('/dashboard');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('토큰 교환 중 오류가 발생했습니다.');
  }
});

router.post('/disconnect', (req: Request, res: Response) => {
  const athleteIdStr = req.cookies?.athlete_id;
  if (athleteIdStr) {
    const athleteId = parseInt(athleteIdStr, 10);
    if (!isNaN(athleteId) && getAthlete(athleteId)) {
      deleteAthlete(athleteId);
    }
  }
  res.clearCookie('athlete_id');
  res.redirect('/');
});

export default router;
