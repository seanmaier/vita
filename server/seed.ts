// Development seed: a test user with sample applications, one of them with a
// version history, so features like the history dialog can be tried in
// `npm run dev:all` right away. Runs before the dev servers start and does
// nothing once the user exists; `npm run seed -- --reset` rebuilds it.
// Never runs in production.
//
//   user:     dev
//   password: devpassword
import type { ApplicationConfig, CoverLetter, FitCriterion, SkillGroup } from '#shared/types.ts';
import { hashPassword } from './auth.ts';
import { db, transaction } from './db.ts';
import { BROWSER_AUTHOR, type VersionContent } from './history.ts';
import { KEYS, setJson, setValue } from './store.ts';

const USERNAME = 'dev';
const PASSWORD = 'devpassword'; // secret-scan:allow (dev-only seed password, never used in production)

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed test data in production.');
  process.exit(1);
}

const reset = process.argv.includes('--reset');
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME) as { id: number } | undefined;
if (existing && !reset) {
  console.log(`Seed: user "${USERNAME}" already exists (npm run seed -- --reset rebuilds it).`);
  process.exit(0);
}

// ---- Sample content ---------------------------------------------------------

const APP_ID = 'nordlicht-software';
const DAY = 24 * 60 * 60 * 1000;

const skills = (backend: string[], devops?: string[]): SkillGroup[] => [
  { label: 'Backend', skills: backend },
  ...(devops ? [{ label: 'DevOps', skills: devops }] : []),
  { label: 'Frontend', skills: ['TypeScript', 'React'] },
];

const letter = (overrides: Partial<CoverLetter>): CoverLetter => ({
  recipientOrg: 'Nordlicht Software GmbH',
  date: '3. November 2026',
  subjectRole: '.NET Backend Developer (m/w/d)',
  paragraphs: [
    'mit großem Interesse habe ich Ihre Stellenanzeige gelesen und bewerbe mich hiermit.',
    'In meiner aktuellen Position entwickle ich Web-APIs mit ASP.NET Core und betreue deren Betrieb.',
    'Ich freue mich auf ein persönliches Gespräch.',
  ],
  ...overrides,
});

const base: VersionContent = {
  id: APP_ID,
  company: 'Nordlicht Software GmbH',
  role: '.NET Backend Developer (m/w/d)',
  language: 'de',
  font: 'sans',
  url: 'https://example.com/jobs/nordlicht-dotnet',
  featuredProjectIds: ['example-project'],
  skillGroupsOverride: skills(['C#', '.NET', 'PHP', 'SQL']),
  coverLetter: letter({}),
};

// Oldest first: what the assistant and the user changed over a few days.
const history: { daysAgo: number; author: string; message: string | null; content: VersionContent }[] = [
  { daysAgo: 6, author: 'claude', message: 'Bewerbung aus der Stellenanzeige angelegt', content: base },
  {
    daysAgo: 5.9,
    author: 'claude',
    message: 'Summary auf .NET und Azure zugeschnitten, Docker und Kubernetes ergänzt, PHP entfernt',
    content: {
      ...base,
      summaryOverride: 'Backend-Entwickler mit Schwerpunkt auf .NET, Azure und automatisierten Deployments.',
      skillGroupsOverride: skills(['.NET', 'C#', 'SQL'], ['Docker', 'Kubernetes', 'Azure DevOps']),
    },
  },
  {
    daysAgo: 4,
    author: BROWSER_AUTHOR,
    message: 'Ansprechpartnerin ergänzt',
    content: {
      ...base,
      summaryOverride: 'Backend-Entwickler mit Schwerpunkt auf .NET, Azure und automatisierten Deployments.',
      skillGroupsOverride: skills(['.NET', 'C#', 'SQL'], ['Docker', 'Kubernetes', 'Azure DevOps']),
      coverLetter: letter({ recipientName: 'Frau Jansen' }),
    },
  },
  {
    daysAgo: 3,
    author: BROWSER_AUTHOR,
    message: null,
    content: {
      ...base,
      role: 'Software Developer .NET / DevOps (m/w/d)',
      font: 'serif',
      summaryOverride: 'Backend-Entwickler mit Schwerpunkt auf .NET, Azure und automatisierten Deployments.',
      skillGroupsOverride: skills(['.NET', 'C#', 'SQL'], ['Docker', 'Kubernetes', 'Azure DevOps']),
      coverLetter: letter({ recipientName: 'Frau Jansen' }),
    },
  },
  {
    daysAgo: 1,
    author: 'claude',
    message: 'Anschreiben überarbeitet: Projektbeispiel konkreter, Schlussabsatz gekürzt',
    content: {
      ...base,
      role: 'Software Developer .NET / DevOps (m/w/d)',
      font: 'serif',
      summaryOverride: 'Backend-Entwickler mit Schwerpunkt auf .NET, Azure und automatisierten Deployments.',
      skillGroupsOverride: skills(['.NET', 'C#', 'SQL', 'Entity Framework'], ['Docker', 'Kubernetes', 'Azure DevOps']),
      coverLetter: letter({
        recipientName: 'Frau Jansen',
        date: '9. November 2026',
        paragraphs: [
          'mit großem Interesse habe ich Ihre Stellenanzeige gelesen und bewerbe mich hiermit.',
          'In meiner aktuellen Position entwickle ich Web-APIs mit ASP.NET Core und habe deren Deployment auf Kubernetes mit Azure DevOps automatisiert.',
          'Die Kombination aus Entwicklung und Betrieb, die Sie beschreiben, entspricht genau dem, was ich in den letzten Jahren gemacht habe.',
          'Ich freue mich auf Ihre Rückmeldung.',
        ],
      }),
    },
  },
];

// A second application without history, to try how the first change gets one.
const withoutHistory: ApplicationConfig = {
  id: 'fjordbyte',
  company: 'Fjordbyte AB',
  role: 'Fullstack Developer',
  status: 'drafting',
  language: 'en',
};

// Job checks with their per-criterion breakdown (weights as in the priorities
// template of /stellencheck), to try the breakdown on leads and fit badges.
const rate = (...fulfilled: number[]): FitCriterion[] =>
  [
    ['Anstellung & Arbeitsmodell', 15],
    ['Rollenfokus', 20],
    ['Stack-Passung', 20],
    ['Erfüllbarkeit / Seniorität', 15],
    ['Themen & Domäne', 10],
    ['Standort & Pendeln', 10],
    ['Lernumfeld & Team', 5],
    ['Gehalt', 5],
  ].map(([name, weight], i) => ({ name: name as string, weight: weight as number, fulfilled: fulfilled[i] }));

const evaluated: ApplicationConfig = {
  id: 'hafenwerk-digital',
  company: 'Hafenwerk Digital GmbH',
  role: 'C# Backend Entwickler (m/w/d)',
  status: 'evaluated',
  language: 'de',
  url: 'https://example.com/jobs/hafenwerk-csharp',
  fit: {
    score: 79,
    recommendation: 'apply',
    reason: 'Stack und Rolle passen genau, hybrid in Hamburg.',
    evaluatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    criteria: rate(100, 75, 90, 75, 50, 100, 50, 50),
  },
};

const leads: {
  externalId: string;
  title: string;
  company: string;
  score: number | null;
  verdict: string | null;
  criteria?: FitCriterion[];
  exclusion?: string;
}[] = [
  {
    externalId: 'seed-1',
    title: 'Backend Entwickler .NET (m/w/d)',
    company: 'Elbtech Solutions',
    score: 78,
    verdict: 'Passt gut: .NET-Backend, 2 Tage Büro in Hamburg.',
    criteria: rate(100, 75, 100, 75, 50, 75, 50, 50),
  },
  {
    externalId: 'seed-2',
    title: 'Softwareentwickler Java/Kotlin',
    company: 'Alster Logistik AG',
    score: 52,
    verdict: 'Bewerben, wenn C#-Erfahrung für Kotlin zählt.',
    criteria: rate(100, 50, 25, 75, 50, 50, 50, 50),
  },
  {
    externalId: 'seed-3',
    title: 'Freelance .NET Consultant',
    company: 'Projektwerk Nord',
    score: 18,
    verdict: 'Freelance ist ausgeschlossen.',
    criteria: rate(0, 75, 100, 50, 50, 50, 50, 50),
    exclusion: 'Freelance / keine Festanstellung',
  },
  {
    externalId: 'seed-4',
    title: 'IT-Systemadministrator',
    company: 'Stadtwerke Beispiel',
    score: 35,
    verdict: 'Anzeige nicht lesbar; nur aus dem Titel geschätzt.',
  },
  { externalId: 'seed-5', title: 'Junior Fullstack Developer', company: 'Kaiwerk Studio', score: null, verdict: null },
];

// ---- Write ------------------------------------------------------------------

const passwordHash = await hashPassword(PASSWORD);
transaction(() => {
  if (existing) db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(USERNAME, passwordHash);
  const userId = Number(lastInsertRowid);

  const current = history[history.length - 1].content;
  setJson(userId, KEYS.localApps, [{ ...base, status: 'drafting' }, withoutHistory, evaluated]);
  setJson(userId, KEYS.statusHistory(evaluated.id), [{ to: 'evaluated', date: null, recordedAt: null }]);
  const insertLead = db.prepare(
    `INSERT INTO job_leads (user_id, source, external_id, title, company, location, url, status, score, verdict, rated_at, rating)
     VALUES (?, 'arbeitsagentur', ?, ?, ?, 'Hamburg', ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of leads) {
    const rating = l.criteria
      ? JSON.stringify({ criteria: l.criteria, ...(l.exclusion && { exclusion: l.exclusion }) })
      : null;
    const rated = l.score !== null;
    insertLead.run(
      userId,
      l.externalId,
      l.title,
      l.company,
      `https://example.com/jobs/${l.externalId}`,
      rated ? 'rated' : 'new',
      l.score,
      l.verdict,
      rated ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      rating,
    );
  }
  setJson(userId, KEYS.appConfig(APP_ID), current);
  setJson(userId, KEYS.statusHistory(APP_ID), [{ to: 'drafting', date: null, recordedAt: null }]);
  setValue(userId, KEYS.tourSeen, '1');

  const insert = db.prepare(
    'INSERT INTO app_versions (user_id, app_id, created_at, author, message, content) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const now = Date.now();
  for (const v of history) {
    insert.run(userId, APP_ID, Math.round(now - v.daysAgo * DAY), v.author, v.message, JSON.stringify(v.content));
  }
});

console.log(`Seed: created user "${USERNAME}" (password "${PASSWORD}") with sample applications.`);
console.log(`      History demo: http://localhost:5173/application/${APP_ID}/edit → History`);
console.log('      Criteria breakdown: http://localhost:5173/leads → Breakdown; fit badge tooltip on the dashboard');
