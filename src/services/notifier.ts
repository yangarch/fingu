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
  const text = `🚨 fingu AI 분석 실패\n${context}\n\`\`\`\n${detail}\n\`\`\``;

  try {
    // Discord reads `content`, Slack reads `text`. Sending both keeps one
    // webhook URL compatible with either service.
    await axios.post(webhookUrl, { content: text, text }, { timeout: 5000 });
  } catch (err) {
    console.error('Failed to send failure notification:', err);
  }
}
