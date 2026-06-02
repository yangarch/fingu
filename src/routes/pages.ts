import { Router, Request, Response } from 'express';
import { getAthlete, getAthleteAnalyses } from '../db/models/athlete';
import { formatDuration } from '../services/strava';

const router = Router();

const BASE_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #1a202c; }
  a { text-decoration: none; }
`;

router.get('/', (req: Request, res: Response) => {
  const athleteIdStr = req.cookies?.athlete_id;
  if (athleteIdStr) {
    const athleteId = parseInt(athleteIdStr, 10);
    if (!isNaN(athleteId) && getAthlete(athleteId)) {
      res.redirect('/dashboard');
      return;
    }
  }

  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fingu - 수영 AI 분석</title>
  <style>
    ${BASE_STYLE}
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card {
      background: white; border-radius: 20px; padding: 48px 40px;
      text-align: center; max-width: 420px; width: 90%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .emoji { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 32px; font-weight: 800; color: #2b6cb0; margin-bottom: 8px; }
    .subtitle { font-size: 16px; color: #718096; margin-bottom: 12px; }
    .desc { font-size: 14px; color: #a0aec0; line-height: 1.6; margin-bottom: 36px; }
    .btn {
      display: inline-block; background: #fc4c02; color: white;
      font-size: 15px; font-weight: 600; padding: 14px 32px;
      border-radius: 50px; transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">🏊</div>
    <h1>fingu</h1>
    <p class="subtitle">수영 AI 코치</p>
    <p class="desc">Strava 수영 기록을 자동으로 분석하여<br>AI 코치의 맞춤 피드백을 제공합니다.</p>
    <a href="/auth/strava" class="btn">Strava로 시작하기</a>
  </div>
</body>
</html>`);
});

router.get('/dashboard', (req: Request, res: Response) => {
  const athleteIdStr = req.cookies?.athlete_id;
  if (!athleteIdStr) {
    res.redirect('/');
    return;
  }

  const athleteId = parseInt(athleteIdStr, 10);
  if (isNaN(athleteId)) {
    res.redirect('/');
    return;
  }

  const athlete = getAthlete(athleteId);
  if (!athlete) {
    res.clearCookie('athlete_id');
    res.redirect('/');
    return;
  }

  const analyses = getAthleteAnalyses(athleteId);

  const analysisCards = analyses.length === 0
    ? `<div class="empty">아직 분석된 수영 기록이 없습니다.<br>다음 수영 후 자동으로 분석됩니다.</div>`
    : analyses.map((a) => {
        const date = a.activity_date
          ? new Date(a.activity_date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
          : '';
        const distanceText = a.distance ? `${a.distance}m` : '';
        return `
        <div class="card">
          <div class="card-header">
            <div>
              <div class="activity-name">${a.activity_name ?? '수영'}</div>
              <div class="meta">${[date, distanceText].filter(Boolean).join(' · ')}</div>
            </div>
            <span class="badge">🏊 AI 분석</span>
          </div>
          <p class="analysis">${a.analysis.replace(/\n/g, '<br>')}</p>
        </div>`;
      }).join('');

  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fingu - 대시보드</title>
  <style>
    ${BASE_STYLE}
    body { padding: 0 0 48px; }
    header {
      background: white; border-bottom: 1px solid #e2e8f0;
      padding: 0 24px; display: flex; align-items: center;
      justify-content: space-between; height: 60px;
      position: sticky; top: 0; z-index: 10;
    }
    .logo { font-size: 20px; font-weight: 800; color: #2b6cb0; }
    .athlete { font-size: 14px; color: #718096; }
    .disconnect-form { margin: 0; }
    .disconnect-btn {
      background: none; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 6px 12px; font-size: 13px; color: #718096; cursor: pointer;
    }
    .disconnect-btn:hover { background: #fff5f5; color: #e53e3e; border-color: #feb2b2; }
    main { max-width: 680px; margin: 32px auto; padding: 0 16px; }
    h2 { font-size: 18px; font-weight: 700; margin-bottom: 20px; color: #2d3748; }
    .card {
      background: white; border-radius: 16px; padding: 24px;
      margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
    .activity-name { font-size: 16px; font-weight: 700; color: #2d3748; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #a0aec0; }
    .badge { font-size: 12px; background: #ebf8ff; color: #2b6cb0; padding: 4px 10px; border-radius: 20px; white-space: nowrap; }
    .analysis { font-size: 14px; line-height: 1.75; color: #4a5568; }
    .empty { text-align: center; color: #a0aec0; font-size: 15px; line-height: 1.8; padding: 48px 0; }
  </style>
</head>
<body>
  <header>
    <span class="logo">🏊 fingu</span>
    <div style="display:flex;align-items:center;gap:12px">
      <span class="athlete">${athlete.athlete_name ?? ''}</span>
      <form class="disconnect-form" method="POST" action="/auth/disconnect"
            onsubmit="return confirm('연동을 해제하면 모든 분석 기록이 삭제됩니다. 계속할까요?')">
        <button type="submit" class="disconnect-btn">연동 해제</button>
      </form>
    </div>
  </header>
  <main>
    <h2>수영 분석 기록</h2>
    ${analysisCards}
  </main>
</body>
</html>`);
});

export default router;
