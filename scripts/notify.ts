// Sends one push message through ntfy.
//   node scripts/notify.ts <title> <message.txt> [click-url]
// A click URL without http(s):// (e.g. leads) is a path resolved against JOB_APPS_URL.
// Reads NTFY_URL (default https://ntfy.sh) and NTFY_TOPIC from the environment or
// .env.assistant. The topic is the only secret, so it must be long and random
// (at least 20 characters).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import './apiClient.ts'; // loads .env.assistant as a side effect

const MIN_TOPIC_LENGTH = 20;

export interface NtfyConfig {
  baseUrl: string;
  topic: string;
}

// HTTP headers must be Latin-1 safe, so non-ASCII text goes out RFC 2047 encoded,
// which ntfy decodes.
function headerValue(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

export function buildNotification(
  { baseUrl, topic }: NtfyConfig,
  title: string,
  message: string,
  clickUrl?: string,
): { url: string; init: RequestInit } {
  if (topic.length < MIN_TOPIC_LENGTH) {
    throw new Error(
      `NTFY_TOPIC must be at least ${MIN_TOPIC_LENGTH} characters (use a random one, e.g. openssl rand -hex 16).`,
    );
  }
  const headers: Record<string, string> = { Title: headerValue(title), Tags: 'briefcase' };
  if (clickUrl) headers.Click = clickUrl;
  return { url: `${baseUrl.replace(/\/+$/, '')}/${topic}`, init: { method: 'POST', headers, body: message } };
}

/** Absolute URLs pass through; a path like leads or /leads is resolved against the app URL. */
export function resolveClickUrl(clickUrl: string | undefined, appUrl: string | undefined): string | undefined {
  if (!clickUrl || /^https?:\/\//i.test(clickUrl)) return clickUrl;
  const base = appUrl?.replace(/\/+$/, '');
  if (!base) throw new Error(`Set JOB_APPS_URL to use the relative click URL ${clickUrl}.`);
  return `${base}/${clickUrl.replace(/^\/+/, '')}`;
}

async function main(): Promise<void> {
  const [title, messageFile, clickUrl] = process.argv.slice(2);
  if (!title || !messageFile) throw new Error('Usage: node scripts/notify.ts <title> <message.txt> [click-url]');
  const config = { baseUrl: process.env.NTFY_URL || 'https://ntfy.sh', topic: process.env.NTFY_TOPIC ?? '' };
  const click = resolveClickUrl(clickUrl, process.env.JOB_APPS_URL);
  const { url, init } = buildNotification(config, title, readFileSync(messageFile, 'utf8'), click);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
