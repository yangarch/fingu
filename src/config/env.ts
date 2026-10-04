import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// Strava is optional since 2026-09-30, when Strava made its API subscriber-only
// and the app went Inactive. The code is kept for a possible re-subscription:
// set all three STRAVA_* vars to re-enable OAuth + webhook routes.
function loadStrava(): { clientId: string; clientSecret: string; verifyToken: string } | null {
  const keys = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_VERIFY_TOKEN'];
  if (keys.every((k) => !process.env[k])) return null;
  return {
    clientId: requireEnv('STRAVA_CLIENT_ID'),
    clientSecret: requireEnv('STRAVA_CLIENT_SECRET'),
    verifyToken: requireEnv('STRAVA_VERIFY_TOKEN'),
  };
}

function loadIntervals() {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) return null;
  const ownerId = process.env.INTERVALS_OWNER_ATHLETE_ID;
  return {
    apiKey,
    // Swims on/after this local date come from intervals.icu. Earlier ones were
    // analyzed via Strava under different ids, so this prevents double analysis.
    since: process.env.INTERVALS_SINCE || '2026-09-30',
    pollMinutes: Math.max(1, parseInt(process.env.INTERVALS_POLL_MINUTES || '15', 10)),
    // DB athlete the analyses are stored under (dashboard owner). Defaults to the
    // only athlete in the DB when unset.
    ownerAthleteId: ownerId ? parseInt(ownerId, 10) : null,
  };
}

const strava = loadStrava();
const intervals = loadIntervals();
if (!strava && !intervals) {
  throw new Error('No activity source configured: set INTERVALS_API_KEY (or STRAVA_* vars)');
}

export const config = {
  strava,
  intervals,
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
    // Discord or Slack incoming webhook URL. Leave unset to disable alerts.
    webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL || '',
  },
  admin: {
    // Token guarding /admin/* and /login. Falls back to the Strava verify token
    // for older setups. Empty = admin endpoints and token login are disabled.
    token: process.env.ADMIN_TOKEN || process.env.STRAVA_VERIFY_TOKEN || '',
  },
};

/** Strava config, for code paths that only run when Strava routes are mounted. */
export function stravaConfig(): NonNullable<typeof config.strava> {
  if (!config.strava) throw new Error('Strava is not configured (STRAVA_* env vars unset)');
  return config.strava;
}
