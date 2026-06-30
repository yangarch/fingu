import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  strava: {
    clientId: requireEnv('STRAVA_CLIENT_ID'),
    clientSecret: requireEnv('STRAVA_CLIENT_SECRET'),
    verifyToken: requireEnv('STRAVA_VERIFY_TOKEN'),
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
  },
  server: {
    baseUrl: requireEnv('BASE_URL'),
    port: parseInt(process.env.PORT || '3000', 10),
  },
  database: {
    url: process.env.DATABASE_URL || './data/swim-analyzer.db',
  },
  notifications: {
    // Discord or Slack incoming webhook URL. Leave unset to disable failure alerts.
    webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL || '',
  },
  admin: {
    // Token guarding the /admin/backfill endpoint. Falls back to the Strava
    // verify token so it works without extra setup; override to separate them.
    token: process.env.ADMIN_TOKEN || requireEnv('STRAVA_VERIFY_TOKEN'),
  },
};
