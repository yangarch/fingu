import express from 'express';
import { config } from './config/env';
import { getDb } from './db/index';
import authRouter from './routes/auth';
import webhookRouter from './routes/webhook';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fingu' });
});

app.use('/auth', authRouter);
app.use('/webhook', webhookRouter);

// Initialize DB on startup
getDb();

app.listen(config.server.port, () => {
  console.log(`🏊 Fingu server running on port ${config.server.port}`);
});

export default app;
