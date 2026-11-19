// Setup file of the server tests (vitest.config.ts): runs before each test
// file and points the database at a throwaway file before server/db.ts opens it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'vita-test-')), 'app.db');
process.env.INBOUND_DOMAIN = 'alerts.example.org';
