// Reads and writes the personal knowledge documents stored in the app:
//   node scripts/knowledge.ts get <doc>              markdown to stdout (exit 2 if not saved yet)
//   node scripts/knowledge.ts put <doc> <file.md>    upload a file (UTF-8, BOM removed)
//   node scripts/knowledge.ts pull                   save both docs to private/knowledge/<doc>.md
//   node scripts/knowledge.ts push <doc>             upload private/knowledge/<doc>.md
// <doc> is about-me or priorities. Credentials as in scripts/api.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { apiFetch } from './apiClient.ts';
import { DOCS, isDoc, stripBom, workingCopyPath, type Doc } from './knowledgeFiles.ts';

const USAGE = `Usage: node scripts/knowledge.ts get <doc> | put <doc> <file.md> | pull | push <doc>   (doc: ${DOCS.join(' | ')})`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** Fetches a document; null when it has not been saved yet. */
async function fetchDoc(doc: Doc): Promise<string | null> {
  const res = await apiFetch('GET', `knowledge/${doc}`);
  if (res.status === 404) return null;
  if (!res.ok) fail(`HTTP ${res.status}: ${res.text}`);
  return (JSON.parse(res.text) as { content: string }).content;
}

async function uploadFile(doc: Doc, file: string): Promise<void> {
  const content = stripBom(readFileSync(file, 'utf8'));
  const res = await apiFetch('PUT', `knowledge/${doc}`, JSON.stringify({ content }));
  if (!res.ok) fail(`HTTP ${res.status}: ${res.text}`);
  console.error(`Uploaded ${file} as ${doc} (${content.length} chars).`);
}

function requireDoc(value: string | undefined): Doc {
  return isDoc(value) ? value : fail(USAGE);
}

const [command, arg1, arg2] = process.argv.slice(2);

try {
  if (command === 'get') {
    const content = await fetchDoc(requireDoc(arg1));
    if (content === null) fail(`${arg1} is not saved in the app yet.`, 2);
    process.stdout.write(content);
  } else if (command === 'put') {
    if (!arg2) fail(USAGE);
    await uploadFile(requireDoc(arg1), arg2);
  } else if (command === 'push') {
    const doc = requireDoc(arg1);
    await uploadFile(doc, workingCopyPath(doc));
  } else if (command === 'pull') {
    for (const doc of DOCS) {
      const content = await fetchDoc(doc);
      if (content === null) {
        console.error(`${doc}: not saved in the app yet, skipped.`);
        continue;
      }
      const file = workingCopyPath(doc);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
      console.error(`${doc}: saved to ${file}.`);
    }
  } else {
    fail(USAGE);
  }
} catch (e) {
  fail((e as Error).message);
}
