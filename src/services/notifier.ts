import axios from 'axios';
import { config } from '../config/env';

/**
 * Sends a failure alert to the configured Discord/Slack webhook.
 * Never throws — notification problems must not break the caller.
 * No-op when NOTIFICATION_WEBHOOK_URL is unset.
 */
export async function notifyFailure(context: string, error: unknown): Promise<void> {
  const webhookUrl = config.notifications.webhookUrl;
  if (!webhookUrl) return;

  const detail = error instanceof Error ? error.stack || error.message : String(error);
  await post(webhookUrl, `🚨 fingu AI 분석 실패\n${context}\n\`\`\`\n${detail}\n\`\`\``);
}

/**
 * Delivers a finished analysis to the same webhook. Since Strava's API went
 * subscriber-only, this (plus the dashboard) is where the feedback ends up —
 * nothing is written back to the activity. Never throws; no-op when unset.
 */
export async function notifyAnalysis(title: string, analysis: string): Promise<void> {
  const webhookUrl = config.notifications.webhookUrl;
  if (!webhookUrl) return;
  await post(webhookUrl, `🏊 ${title}\n${analysis}`);
}

// Discord rejects messages over 2000 chars.
const MAX_MESSAGE_CHARS = 1900;

async function post(webhookUrl: string, message: string): Promise<void> {
  const text = message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;
  try {
    // Discord reads `content`, Slack reads `text`. Sending both keeps one
    // webhook URL compatible with either service.
    await axios.post(webhookUrl, { content: text, text }, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}
