import { flush, hydrate, localWriteCount } from './storage';
import type { InboundEvent, JobAlertsConfig, JobLead, JobLeadStatus } from '../types';

export interface SessionUser {
  id: number;
  username: string;
}

/** The server's `{ error }` message for a failed response, or a generic one with the status. */
async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body: { error?: unknown } = await res.json().catch(() => ({}));
  return new Error(typeof body.error === 'string' ? body.error : `${fallback} (HTTP ${res.status}).`);
}

export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const res = await fetch('/api/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Server unreachable (HTTP ${res.status}).`);
  return res.json();
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw await errorFrom(res, 'Login failed');
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' });
}

/** Changes the logged-in user's password; throws with the server's message if it was refused. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw await errorFrom(res, 'Changing the password failed');
}

export interface ApiToken {
  name: string;
  scope: string;
  created_at: string;
  last_used_at: string | null;
}

export async function fetchApiTokens(): Promise<ApiToken[]> {
  const res = await fetch('/api/tokens');
  if (!res.ok) throw await errorFrom(res, 'Loading API tokens failed');
  return res.json();
}

/** Creates a token and returns its secret, which the server never shows again. */
export async function createApiToken(name: string): Promise<string> {
  const res = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw await errorFrom(res, 'Creating the token failed');
  const body: { token: string } = await res.json();
  return body.token;
}

export async function revokeApiToken(name: string): Promise<void> {
  const res = await fetch(`/api/tokens/${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) throw await errorFrom(res, 'Revoking the token failed');
}

export async function fetchUserData(): Promise<Record<string, string>> {
  const res = await fetch('/api/data');
  if (!res.ok) throw new Error(`Loading data failed (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Replaces the in-memory copy with the server's current data, e.g. after the
 * API changed it while this tab was in the background. Without this, the next
 * save here would write back the stale lists and undo those changes. Skipped
 * if anything was edited meanwhile, so local edits are never thrown away.
 */
export async function refreshUserData(): Promise<void> {
  await flush();
  const before = localWriteCount();
  const entries = await fetchUserData();
  if (localWriteCount() === before) hydrate(entries);
}

/** Saves any pending edits, ends the session, and returns to the login screen. */
export async function logoutAndReload(): Promise<void> {
  await flush().catch(() => {});
  await logout();
  window.location.reload();
}

export type KnowledgeDoc = 'about-me' | 'priorities';

/** The knowledge document's text, or null if it hasn't been written yet. */
export async function fetchKnowledge(doc: KnowledgeDoc): Promise<string | null> {
  const res = await fetch(`/api/v1/knowledge/${doc}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res, 'Loading the document failed');
  const body: { content: string } = await res.json();
  return body.content;
}

/** Replaces the knowledge document; throws with the server's message if it was refused. */
export async function saveKnowledge(doc: KnowledgeDoc, content: string): Promise<void> {
  const res = await fetch(`/api/v1/knowledge/${doc}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    // Validation errors carry the useful part (e.g. "too long") in `details`.
    const body: { error?: unknown; details?: unknown } = await res.clone().json().catch(() => ({}));
    if (Array.isArray(body.details) && body.details.length > 0) throw new Error(body.details.join(' '));
    throw await errorFrom(res, 'Saving the document failed');
  }
}

/** Job leads, newest first; filtered by status if given (up to 200). */
export async function fetchLeads(status?: JobLeadStatus): Promise<JobLead[]> {
  const query = new URLSearchParams({ limit: '200' });
  if (status) query.set('status', status);
  const res = await fetch(`/api/v1/job-leads?${query}`);
  if (!res.ok) throw await errorFrom(res, 'Loading the job leads failed');
  return res.json();
}

export async function updateLead(
  id: number,
  patch: Partial<Pick<JobLead, 'status' | 'applicationId'>>,
): Promise<JobLead> {
  const res = await fetch(`/api/v1/job-leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await errorFrom(res, 'Updating the job lead failed');
  return res.json();
}

export async function fetchJobAlerts(): Promise<JobAlertsConfig> {
  const res = await fetch('/api/v1/job-alerts');
  if (!res.ok) throw await errorFrom(res, 'Loading the job alert settings failed');
  return res.json();
}

/** Creates the user's alert address, or replaces it (the old one stops working at once). */
export async function createJobAlertAddress(): Promise<JobAlertsConfig> {
  const res = await fetch('/api/v1/job-alerts/address', { method: 'POST' });
  if (!res.ok) throw await errorFrom(res, 'Creating the alert address failed');
  return res.json();
}

export async function saveForwardingFrom(value: string | null): Promise<JobAlertsConfig> {
  const res = await fetch('/api/v1/job-alerts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forwardingFrom: value }),
  });
  if (!res.ok) {
    const body: { details?: unknown } = await res.clone().json().catch(() => ({}));
    const details = Array.isArray(body.details) ? body.details.filter((d) => typeof d === 'string') : [];
    if (details.length > 0) throw new Error(details.join(' '));
    throw await errorFrom(res, 'Saving the forwarding address failed');
  }
  return res.json();
}

/** The most recent inbound mails for the user's alert address, newest first. */
export async function fetchJobAlertEvents(): Promise<InboundEvent[]> {
  const res = await fetch('/api/v1/job-alerts/events?limit=20');
  if (!res.ok) throw await errorFrom(res, 'Loading the alert activity failed');
  return res.json();
}
