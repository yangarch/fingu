import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import { getDb } from './db/index';
import authRouter from './routes/auth';
import webhookRouter from './routes/webhook';
import pagesRouter from './routes/pages';
import adminRouter from './routes/admin';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'fingu' });
});

app.use('/', pagesRouter);
app.use('/auth', authRouter);
app.use('/webhook', webhookRouter);
app.use('/admin', adminRouter);

// Initialize DB on startup
getDb();

app.listen(config.server.port, () => {
  console.log(`🏊 Fingu server running on port ${config.server.port}`);
});

export default app;
