// Job postings collected from alerts (e.g. a Cloudflare Email Worker), to be
// rated later against the user's priorities.
import { Hono } from 'hono';
import type { JobLead, JobLeadInput } from '#shared/types.ts';
import type { User } from './auth.ts';
import { db, transaction } from './db.ts';
import { invalid, jsonBody } from './http.ts';
import { LEAD_STATUSES, PATCH_FIELDS, validateLeadInput, validatePatch } from './jobLeadsValidation.ts';

const MAX_BATCH = 100;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface LeadRow {
  id: number;
  source: JobLead['source'];
  external_id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  received_at: string;
  status: JobLead['status'];
  score: number | null;
  verdict: string | null;
  rated_at: string | null;
  application_id: string | null;
  /** JSON `{ criteria, exclusion? }`, the breakdown of the rating. */
  rating: string | null;
}

function toLead(r: LeadRow): JobLead {
  const lead: JobLead = {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    title: r.title,
    url: r.url,
    receivedAt: r.received_at,
    status: r.status,
    score: r.score,
    verdict: r.verdict,
    ratedAt: r.rated_at,
    applicationId: r.application_id,
  };
  if (r.company !== null) lead.company = r.company;
  if (r.location !== null) lead.location = r.location;
  if (r.rating !== null) Object.assign(lead, JSON.parse(r.rating) as Pick<JobLead, 'criteria' | 'exclusion'>);
  return lead;
}

function findLead(userId: number, id: number): JobLead | null {
  const row = db.prepare('SELECT * FROM job_leads WHERE id = ? AND user_id = ?').get(id, userId) as LeadRow | undefined;
  return row ? toLead(row) : null;
}

export interface InsertCounts {
  created: number;
  /** Leads that were already known (updated or not). */
  duplicates: number;
  /** Known leads whose title, url, company or location changed. */
  updated: number;
}

/**
 * Stores leads for a user in one transaction. A known lead takes the new title and url, and the
 * new company and location where given, so a re-sent alert repairs what an older parser stored.
 * Status, score and rating stay as they are.
 */
export function insertLeads(userId: number, leads: JobLeadInput[]): InsertCounts {
  const exists = db.prepare('SELECT 1 FROM job_leads WHERE user_id = ? AND source = ? AND external_id = ?');
  const upsert = db.prepare(
    `INSERT INTO job_leads (user_id, source, external_id, title, company, location, url)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, source, external_id) DO UPDATE SET
       title = excluded.title,
       company = COALESCE(excluded.company, company),
       location = COALESCE(excluded.location, location),
       url = excluded.url
     WHERE title IS NOT excluded.title
        OR url IS NOT excluded.url
        OR (excluded.company IS NOT NULL AND company IS NOT excluded.company)
        OR (excluded.location IS NOT NULL AND location IS NOT excluded.location)`,
  );
  return transaction(() => {
    const counts: InsertCounts = { created: 0, duplicates: 0, updated: 0 };
    for (const l of leads) {
      const known = exists.get(userId, l.source, l.externalId) !== undefined;
      const r = upsert.run(userId, l.source, l.externalId, l.title, l.company ?? null, l.location ?? null, l.url);
      if (!known) counts.created += 1;
      else {
        counts.duplicates += 1;
        counts.updated += Number(r.changes);
      }
    }
    return counts;
  });
}

export const jobLeads = new Hono<{ Variables: { user: User } }>()
  .post('/', jsonBody(['leads']), async (c) => {
    const body = c.req.valid('json');
    const { leads } = body;
    if (!Array.isArray(leads)) return invalid(c, ['"leads" must be an array.']);
    if (leads.length < 1 || leads.length > MAX_BATCH)
      return invalid(c, [`"leads" must contain 1-${MAX_BATCH} entries.`]);

    const parsed: JobLeadInput[] = [];
    const errors: string[] = [];
    leads.forEach((entry, i) => {
      const result = validateLeadInput(entry);
      if (result.ok) parsed.push(result.value);
      else errors.push(...result.errors.map((e) => `leads[${i}].${e}`));
    });
    if (errors.length) return invalid(c, errors);

    return c.json(insertLeads(c.get('user').id, parsed), 201);
  })
  .get('/', (c) => {
    const { status, limit: rawLimit } = c.req.query();
    const errors: string[] = [];
    if (status !== undefined && !(LEAD_STATUSES as readonly string[]).includes(status)) {
      errors.push(`"status" must be one of: ${LEAD_STATUSES.join(', ')}.`);
    }
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      limit = Number(rawLimit);
      if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > MAX_LIMIT)
        errors.push(`"limit" must be an integer 1-${MAX_LIMIT}.`);
    }
    if (errors.length) return invalid(c, errors);

    const userId = c.get('user').id;
    const rows = (status === undefined
      ? db.prepare('SELECT * FROM job_leads WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit)
      : db
          .prepare('SELECT * FROM job_leads WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT ?')
          .all(userId, status, limit)) as unknown as LeadRow[];
    return c.json(rows.map(toLead));
  })
  .patch('/:id', jsonBody(PATCH_FIELDS), async (c) => {
    const body = c.req.valid('json');
    const result = validatePatch(body);
    if (!result.ok) return invalid(c, result.errors);

    const userId = c.get('user').id;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || !findLead(userId, id)) return c.json({ error: 'No such job lead.' }, 404);

    const { status, score, verdict, applicationId, criteria, exclusion } = result.value;
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (clause: string, value: string | number | null) => {
      sets.push(clause);
      params.push(value);
    };
    if (status !== undefined) set('status = ?', status);
    if (score !== undefined) {
      set('score = ?', score);
      sets.push(score === null ? 'rated_at = NULL' : "rated_at = datetime('now')");
    }
    if (verdict !== undefined) set('verdict = ?', verdict);
    // A new score without its breakdown leaves the old one stale, so it goes too.
    if (criteria) set('rating = ?', JSON.stringify({ criteria, ...(exclusion && { exclusion }) }));
    else if (score !== undefined || criteria === null) sets.push('rating = NULL');
    if (applicationId !== undefined) set('application_id = ?', applicationId);
    db.prepare(`UPDATE job_leads SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params, id, userId);
    const updated = findLead(userId, id);
    return updated ? c.json(updated) : c.json({ error: 'No such job lead.' }, 404);
  });
