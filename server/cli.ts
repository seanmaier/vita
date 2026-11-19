// User administration, run inside the container:
//   node server/cli.ts add <username> [password]   (random password if omitted)
//   node server/cli.ts passwd <username> [password]
//   node server/cli.ts remove <username>
//   node server/cli.ts list
//   node server/cli.ts admin <username> on|off   (admins may create the worker token scopes in the app)
//   node server/cli.ts token-add <username> <name> [--scope job-leads:ingest|job-leads:radar|inbound:deliver]    (prints the token once)
//   node server/cli.ts token-list <username>
//   node server/cli.ts token-revoke <username> <name>
//   node server/cli.ts token-rotate <username> <name>   (prints the new token once; the old one stops working)
import { randomBytes } from 'node:crypto';
import {
  createApiToken,
  hashPassword,
  isTokenScope,
  listApiTokens,
  MIN_PASSWORD_LENGTH,
  revokeApiToken,
  rotateApiToken,
  setAdmin,
  setPassword,
  TOKEN_SCOPES,
  type TokenScope,
} from './auth.ts';
import { db } from './db.ts';

// The third argument is the password for add/passwd, the token name for token-* and on|off for admin.
const rawArgs = process.argv.slice(2);
// `--scope <value>` may appear anywhere after the command.
const scopeFlag = rawArgs.indexOf('--scope');
const givenScope = scopeFlag === -1 ? undefined : (rawArgs[scopeFlag + 1] ?? '');
if (scopeFlag !== -1) rawArgs.splice(scopeFlag, 2);
const [command, username, givenPassword] = rawArgs;
const tokenName = givenPassword?.trim();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function passwordOrGenerated(): { password: string; generated: boolean } {
  if (givenPassword) {
    if (givenPassword.length < MIN_PASSWORD_LENGTH)
      fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return { password: givenPassword, generated: false };
  }
  return { password: randomBytes(15).toString('base64url'), generated: true };
}

function userIdOrFail(name: string): number {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(name) as { id: number } | undefined;
  if (!user) fail(`No user "${name}".`);
  return user.id;
}

switch (command) {
  case 'add': {
    if (!username) fail('Usage: add <username> [password]');
    const { password, generated } = passwordOrGenerated();
    try {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
        username,
        await hashPassword(password),
      );
    } catch {
      fail(`User "${username}" already exists.`);
    }
    console.log(`Created user "${username}".${generated ? ` Password: ${password}` : ''}`);
    break;
  }
  case 'passwd': {
    if (!username) fail('Usage: passwd <username> [password]');
    const { password, generated } = passwordOrGenerated();
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (!user) fail(`No user "${username}".`);
    await setPassword(user.id, password);
    console.log(`Updated password for "${username}".${generated ? ` Password: ${password}` : ''}`);
    break;
  }
  case 'remove': {
    if (!username) fail('Usage: remove <username>');
    const { changes } = db.prepare('DELETE FROM users WHERE username = ?').run(username);
    if (!changes) fail(`No user "${username}".`);
    console.log(`Removed user "${username}" and all of their data.`);
    break;
  }
  case 'list': {
    const rows = db.prepare('SELECT username, role, created_at FROM users ORDER BY username').all() as {
      username: string;
      role: string;
      created_at: string;
    }[];
    if (!rows.length) console.log('No users yet.');
    for (const r of rows) {
      console.log(`${r.username}${r.role === 'admin' ? '\t[admin]' : ''}\t(created ${r.created_at})`);
    }
    break;
  }
  case 'admin': {
    if (!username || (givenPassword !== 'on' && givenPassword !== 'off')) fail('Usage: admin <username> on|off');
    if (!setAdmin(username, givenPassword === 'on')) fail(`No user "${username}".`);
    console.log(givenPassword === 'on' ? `"${username}" is now an admin.` : `"${username}" is no longer an admin.`);
    break;
  }
  case 'token-add': {
    const usage = `Usage: token-add <username> <name> [--scope ${TOKEN_SCOPES.join('|')}]`;
    if (!username || !tokenName) fail(usage);
    if (givenScope !== undefined && !isTokenScope(givenScope)) fail(usage);
    const result = createApiToken(userIdOrFail(username), tokenName, givenScope as TokenScope | undefined);
    if (!result.ok) fail(result.error);
    console.log(`Created API token "${tokenName}" for "${username}". It is shown only this once:\n${result.token}`);
    break;
  }
  case 'token-list': {
    if (!username) fail('Usage: token-list <username>');
    const tokens = listApiTokens(userIdOrFail(username));
    if (!tokens.length) console.log('No API tokens.');
    for (const t of tokens)
      console.log(`${t.name}\t[${t.scope}]\t(created ${t.created_at}, last used ${t.last_used_at ?? 'never'})`);
    break;
  }
  case 'token-revoke': {
    if (!username || !tokenName) fail('Usage: token-revoke <username> <name>');
    if (!revokeApiToken(userIdOrFail(username), tokenName)) fail(`"${username}" has no token named "${tokenName}".`);
    console.log(`Revoked API token "${tokenName}" for "${username}".`);
    break;
  }
  case 'token-rotate': {
    if (!username || !tokenName) fail('Usage: token-rotate <username> <name>');
    const result = rotateApiToken(userIdOrFail(username), tokenName);
    if (!result.ok) fail(`"${username}" has no token named "${tokenName}".`);
    console.log(
      `Rotated API token "${tokenName}" for "${username}". The new token is shown only this once:\n${result.token}`,
    );
    break;
  }
  default:
    fail(
      'Commands: add <username> [password] | passwd <username> [password] | remove <username> | list\n' +
        '          admin <username> on|off\n' +
        '          token-add <username> <name> [--scope ...] | token-list <username> | token-revoke <username> <name>\n' +
        '          token-rotate <username> <name>',
    );
}
