// Starts Vitest with an upper-case drive letter on Windows. A terminal opened
// at `c:\…` (VS Code does that) otherwise makes Vitest load itself twice, once
// per spelling, and every file fails with "failed to find the current suite".
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const upperDrive = (p: string) => p.replace(/^[a-z]:/, (drive) => drive.toUpperCase());

const cwd = upperDrive(process.cwd());
const entry = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
const { status } = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(status ?? 1);
