// Searches the Arbeitsagentur job board and prints the hits as JobLeadInput[] JSON,
// ready for `node scripts/api.ts POST job-leads <file>` (add --body to print the { "leads": [...] } request body instead).
//   node scripts/arbeitsagentur.ts --was "Backend Entwickler" --wo Hamburg --umkreis 30 --tage 1
// The API is unofficial (documented at jobsuche.api.bund.dev). Only the first page
// (100 hits) is read; the server only refreshes leads it already knows when they are submitted.
import { pathToFileURL } from 'node:url';
import type { JobLeadInput } from '#shared/types.ts';

const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs';
const API_KEY = 'jobboerse-jobsuche'; // secret-scan:allow (public Bundesagentur key, same for everyone)
const DETAIL_URL = 'https://www.arbeitsagentur.de/jobsuche/jobdetail/';

export interface AgItem {
  referenznummer?: string;
  stellenangebotsTitel?: string;
  firma?: string;
  stellenlokationen?: { adresse?: { ort?: string } }[];
}

export interface SearchParams {
  was: string;
  wo: string;
  umkreis: number;
  tage: number;
}

function clean(value: string | undefined, max: number): string | undefined {
  const text = value?.trim().slice(0, max).trim();
  return text || undefined;
}

/** Maps one search hit; returns null without reference number or title. */
function mapItem(item: AgItem): JobLeadInput | null {
  const refnr = clean(item.referenznummer, 200);
  const title = clean(item.stellenangebotsTitel, 300);
  if (!refnr || !title) return null;
  const company = clean(item.firma, 200);
  const location = clean(item.stellenlokationen?.[0]?.adresse?.ort, 200);
  return {
    source: 'arbeitsagentur',
    externalId: refnr,
    title,
    ...(company && { company }),
    ...(location && { location }),
    url: `${DETAIL_URL}${refnr}`,
  };
}

export function toLead(item: AgItem): JobLeadInput {
  const lead = mapItem(item);
  if (!lead) throw new Error('Item needs referenznummer and stellenangebotsTitel');
  return lead;
}

export function toLeads(items: AgItem[]): JobLeadInput[] {
  return items.map(mapItem).filter((lead): lead is JobLeadInput => lead !== null);
}

export function buildSearchUrl({ was, wo, umkreis, tage }: SearchParams): string {
  const params = new URLSearchParams({
    was,
    wo,
    umkreis: String(umkreis),
    veroeffentlichtseit: String(tage),
    angebotsart: '1',
    size: '100',
  });
  return `${BASE}?${params}`;
}

function parseArgs(argv: string[]): SearchParams & { body: boolean } {
  const body = argv.includes('--body');
  const rest = argv.filter((arg) => arg !== '--body');
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i] ?? '';
    if (!key.startsWith('--') || rest[i + 1] === undefined) throw new Error(`Unexpected argument: ${key}`);
    values.set(key.slice(2), rest[i + 1] as string);
  }
  const was = values.get('was');
  const wo = values.get('wo');
  const umkreis = Number(values.get('umkreis') ?? 30);
  const tage = Number(values.get('tage') ?? 1);
  if (!was || !wo || !Number.isInteger(umkreis) || !Number.isInteger(tage) || umkreis < 0 || tage < 1) {
    throw new Error(
      'Usage: node scripts/arbeitsagentur.ts --was "<term>" --wo "<place>" --umkreis <km> --tage <n> [--body]',
    );
  }
  return { was, wo, umkreis, tage, body };
}

async function main(): Promise<void> {
  const { body, ...search } = parseArgs(process.argv.slice(2));
  const res = await fetch(buildSearchUrl(search), { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`Arbeitsagentur API: HTTP ${res.status}`);
  const data = (await res.json()) as { ergebnisliste?: AgItem[] };
  const leads = toLeads(data.ergebnisliste ?? []);
  console.log(JSON.stringify(body ? { leads } : leads, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
