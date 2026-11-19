import type { InferResponseType } from 'hono/client';
import { flush, hydrate, localWriteCount } from './storage';
import type { JobLead, JobLeadStatus } from '#shared/types.ts';
import { client, detailedErrorFrom, errorFrom } from './apiClient';

/** The logged-in user; `admin` decides which token scopes the account page offers. */
export type SessionUser = InferResponseType<typeof client.api.me.$get, 200>;

export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const res = await client.api.me.$get();
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Server unreachable (HTTP ${res.status}).`);
  return res.json();
}

export async function login(username: string, password: string): Promise<void> {
  const res = await client.api.login.$post({ json: { username, password } });
  if (!res.ok) throw await errorFrom(res, 'Login failed');
}

export async function logout(): Promise<void> {
  await client.api.logout.$post();
}

/** Changes the logged-in user's password; throws with the server's message if it was refused. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await client.api.password.$post({ json: { currentPassword, newPassword } });
  if (!res.ok) throw await errorFrom(res, 'Changing the password failed');
}

// Mirrors server/auth.ts: the worker scopes are only offered to admins (the server checks again).
export const USER_TOKEN_SCOPES = ['full', 'job-leads:radar'] as const;
export const ADMIN_TOKEN_SCOPES = [...USER_TOKEN_SCOPES, 'job-leads:ingest', 'inbound:deliver'] as const;
export type UserTokenScope = (typeof ADMIN_TOKEN_SCOPES)[number];

/** The scopes the account page offers to this user. */
export const tokenScopesFor = (admin: boolean): readonly UserTokenScope[] =>
  admin ? ADMIN_TOKEN_SCOPES : USER_TOKEN_SCOPES;

/** What a token of each scope may do, as shown on the account page. */
export const TOKEN_SCOPE_INFO: Record<string, { label: string; description: string }> = {
  full: {
    label: 'full access',
    description: 'Reads and edits everything under /api/v1. For scripts and assistants you run yourself.',
  },
  'job-leads:ingest': {
    label: 'add leads',
    description:
      'Can only add job leads to your own list (POST /api/v1/job-leads). For a script or worker that ' +
      'collects jobs; the job alert mails no longer need it.',
  },
  'job-leads:radar': {
    label: 'job radar',
    description:
      'Adds, lists and rates job leads and reads your priorities and about-me. Nothing else, so an ' +
      'unattended agent reading untrusted job ads cannot touch your applications or change your knowledge.',
  },
  'inbound:deliver': {
    label: 'mail delivery',
    description:
      "For the mail worker (APP_TOKEN): delivers forwarded job alert mails to every user's alert address. " +
      'Keep it only in the worker.',
  },
};

export type ApiToken = InferResponseType<typeof client.api.tokens.$get, 200>[number];

export async function fetchApiTokens(): Promise<ApiToken[]> {
  const res = await client.api.tokens.$get();
  if (!res.ok) throw await errorFrom(res, 'Loading API tokens failed');
  return res.json();
}

/** Creates a token and returns its secret, which the server never shows again. */
export async function createApiToken(name: string, scope: UserTokenScope = 'full'): Promise<string> {
  const res = await client.api.tokens.$post({ json: { name, scope } });
  if (res.status !== 201) throw await errorFrom(res, 'Creating the token failed');
  return (await res.json()).token;
}

export async function revokeApiToken(name: string): Promise<void> {
  const res = await client.api.tokens[':name'].$delete({ param: { name: encodeURIComponent(name) } });
  if (!res.ok) throw await errorFrom(res, 'Revoking the token failed');
}

/** Gives a token a new secret, keeping its name and scope; the old secret stops working at once. */
export async function rotateApiToken(name: string): Promise<string> {
  const res = await client.api.tokens[':name'].rotate.$post({ param: { name: encodeURIComponent(name) } });
  if (!res.ok) throw await errorFrom(res, 'Rotating the token failed');
  return (await res.json()).token;
}

export async function fetchUserData(): Promise<Record<string, string>> {
  const res = await client.api.data.$get();
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

const applicationRoutes = client.api.v1.applications[':id'];

/** An application's version history, newest first. */
export async function fetchVersions(appId: string) {
  await flush();
  const res = await applicationRoutes.versions.$get({ param: { id: encodeURIComponent(appId) } });
  if (!res.ok) throw await errorFrom(res, 'Loading the history failed');
  return res.json();
}

/** Makes an older version the application's current content (itself recorded as a new version). */
export async function restoreVersion(appId: string, versionId: number): Promise<void> {
  await flush();
  const res = await applicationRoutes.versions[':versionId'].restore.$post({
    param: { id: encodeURIComponent(appId), versionId: String(versionId) },
  });
  if (!res.ok) throw await errorFrom(res, 'Restoring the version failed');
  await refreshUserData();
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
  const res = await client.api.v1.knowledge[':doc'].$get({ param: { doc } });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res, 'Loading the document failed');
  return (await res.json()).content;
}

/** Replaces the knowledge document; throws with the server's message if it was refused. */
export async function saveKnowledge(doc: KnowledgeDoc, content: string): Promise<void> {
  const res = await client.api.v1.knowledge[':doc'].$put({ param: { doc }, json: { content } });
  if (!res.ok) throw await detailedErrorFrom(res, 'Saving the document failed');
}

/** Job leads, newest first; filtered by status if given (up to 200). */
export async function fetchLeads(status?: JobLeadStatus): Promise<JobLead[]> {
  const res = await client.api.v1['job-leads'].$get({ query: { limit: '200', ...(status && { status }) } });
  if (!res.ok) throw await errorFrom(res, 'Loading the job leads failed');
  return res.json();
}

export async function updateLead(
  id: number,
  patch: Partial<Pick<JobLead, 'status' | 'applicationId'>>,
): Promise<JobLead> {
  const res = await client.api.v1['job-leads'][':id'].$patch({ param: { id: String(id) }, json: patch });
  if (!res.ok) throw await errorFrom(res, 'Updating the job lead failed');
  return res.json();
}

const jobAlertRoutes = client.api.v1['job-alerts'];

export type JobAlertsConfig = InferResponseType<typeof jobAlertRoutes.$get, 200>;

export async function fetchJobAlerts(): Promise<JobAlertsConfig> {
  const res = await jobAlertRoutes.$get();
  if (!res.ok) throw await errorFrom(res, 'Loading the job alert settings failed');
  return res.json();
}

/** Creates the user's alert address, or replaces it (the old one stops working at once). */
export async function createJobAlertAddress(): Promise<JobAlertsConfig> {
  const res = await jobAlertRoutes.address.$post();
  if (!res.ok) throw await errorFrom(res, 'Creating the alert address failed');
  return res.json();
}

export async function saveForwardingFrom(value: string | null): Promise<JobAlertsConfig> {
  const res = await jobAlertRoutes.$put({ json: { forwardingFrom: value } });
  if (!res.ok) throw await detailedErrorFrom(res, 'Saving the forwarding address failed');
  return res.json();
}

/** How many inbound mails one events request fetches. */
export const JOB_ALERT_EVENTS_LIMIT = 20;

/** The most recent inbound mails for the user's alert address, newest first. */
export async function fetchJobAlertEvents() {
  const res = await jobAlertRoutes.events.$get({ query: { limit: String(JOB_ALERT_EVENTS_LIMIT) } });
  if (!res.ok) throw await errorFrom(res, 'Loading the alert activity failed');
  return res.json();
}
