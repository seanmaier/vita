// Import this first in every test file: it points the database at a throwaway
// file before server/db.ts opens it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'vita-test-')), 'app.db');
