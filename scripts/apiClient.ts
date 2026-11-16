// Shared HTTP client for /api/v1, used by scripts/api.ts and scripts/knowledge.ts.
// Reads JOB_APPS_URL and JOB_APPS_TOKEN from the environment or from
// .env.assistant (gitignored).
import { existsSync } from 'node:fs';

export const ENV_FILE = '.env.assistant';
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export interface ApiResponse {
  status: number;
  ok: boolean;
  text: string;
}

export function getConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.JOB_APPS_URL?.replace(/\/+$/, '');
  const token = process.env.JOB_APPS_TOKEN;
  if (!baseUrl || !token) {
    throw new Error(`Set JOB_APPS_URL and JOB_APPS_TOKEN (e.g. in ${ENV_FILE}, see .env.assistant.example).`);
  }
  return { baseUrl, token };
}

/** Sends a request and returns the raw response; does not throw on HTTP errors. */
export async function apiFetch(method: string, path: string, body?: string): Promise<ApiResponse> {
  const { baseUrl, token } = getConfig();
  const res = await fetch(`${baseUrl}/api/v1${path.replace(/^\/*/, '/')}`, {
    method: method.toUpperCase(),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body,
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

/** Sends a JSON request and returns the parsed response; throws `HTTP <status>: <body>` on errors. */
export async function apiRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await apiFetch(method, path, body === undefined ? undefined : JSON.stringify(body));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text}`);
  return res.text ? JSON.parse(res.text) : undefined;
}
