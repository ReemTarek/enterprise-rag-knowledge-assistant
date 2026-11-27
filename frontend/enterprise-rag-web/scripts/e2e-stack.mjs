#!/usr/bin/env node
// Starts the backend half of the E2E stack: SQL Server (Docker Compose) -> migrations -> API in Release.
// The Angular dev server is started by Playwright (`webServer` in playwright.config.ts).
//
//   npm run e2e:stack                 local: start SQL if needed, migrate, run the API until Ctrl+C
//   npm run e2e:stack -- --down       also stop the SQL container on exit (the data volume is kept)
//   npm run e2e:stack -- --fresh      drop the SQL data volume first (docker compose down -v) and new credentials
//   npm run e2e:stack -- --ci         CI: no Docker; SQL must be reachable; Database__ConnectionString from env
//
// Secrets (SA password, JWT key, E2E admin passwords) are generated per machine/run and never printed. The E2E
// credentials go to the git-ignored e2e/.auth/stack.env.json so the Playwright run can read them.
// No dependencies: Node built-ins only; works on Windows and Linux.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..', '..');
const apiProjectDir = path.join(repoRoot, 'src', 'EnterpriseRag.API');
const authDir = path.join(webRoot, 'e2e', '.auth');
const stackEnvFile = path.join(authDir, 'stack.env.json');
const dotEnvFile = path.join(repoRoot, '.env');
const isWindows = process.platform === 'win32';

const args = new Set(process.argv.slice(2));
const ci = args.has('--ci');
const down = args.has('--down');
const fresh = args.has('--fresh');
for (const a of args) {
  if (!['--ci', '--down', '--fresh'].includes(a))
    fail(`Unknown option ${a}. Use --ci, --down or --fresh.`);
}
if (ci && fresh) fail('--fresh needs Docker and cannot be combined with --ci.');

const apiUrl = (process.env.E2E_API_URL || 'http://127.0.0.1:5180').replace(/\/$/, '');
const sqlHost = process.env.E2E_SQL_HOST || '127.0.0.1';
const sqlPort = Number(process.env.E2E_SQL_PORT || 1433);
/** A dedicated database, so the suite never touches the developer's `EnterpriseRag` data on the same server. */
const dbName = process.env.E2E_DB_NAME || 'EnterpriseRagE2e';

function log(message) {
  console.log(`[e2e-stack] ${message}`);
}

function fail(message) {
  console.error(`[e2e-stack] ERROR: ${message}`);
  process.exit(1);
}

/** Strong random password: base64url body plus guaranteed upper/lower/digit/symbol (SQL Server and app policy). */
function strongPassword(bytes = 24) {
  return `Aa1!${randomBytes(bytes).toString('base64url')}`;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) return { ok: false, stdout: '', stderr: String(result.error.message) };
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function tcpReachable(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function readDotEnv() {
  if (!existsSync(dotEnvFile)) return {};
  const values = {};
  for (const line of readFileSync(dotEnvFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function readStackEnv() {
  if (!existsSync(stackEnvFile)) return null;
  try {
    return JSON.parse(readFileSync(stackEnvFile, 'utf8'));
  } catch {
    fail(
      `${stackEnvFile} is not valid JSON; delete it (and use --fresh if the database already has users).`,
    );
  }
}

function dockerAvailable() {
  return run('docker', ['info', '--format', '{{.ServerVersion}}'], { capture: true }).ok;
}

function sqlContainerId() {
  const r = run('docker', ['compose', 'ps', '-q', 'sqlserver'], { capture: true });
  return r.ok ? r.stdout.trim() : '';
}

async function waitForSqlHealthy(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = sqlContainerId();
    if (id) {
      const r = run('docker', ['inspect', '--format', '{{.State.Health.Status}}', id], {
        capture: true,
      });
      if (r.ok && r.stdout.trim() === 'healthy') return;
    }
    await delay(2000);
  }
  fail(
    'SQL Server container did not become healthy within 180 s (see `docker compose logs sqlserver`).',
  );
}

/** Number of rows in Users of the E2E database, via sqlcmd inside the container; null if unknown. */
function countUsers(saPassword) {
  const id = sqlContainerId();
  if (!id) return null;
  const query = `SET NOCOUNT ON; IF DB_ID('${dbName}') IS NULL SELECT -1 ELSE IF OBJECT_ID('${dbName}.dbo.Users') IS NULL SELECT -1 ELSE SELECT COUNT(*) FROM [${dbName}].dbo.Users`;
  // The password travels in the environment (SQLCMDPASSWORD), not on a command line.
  const r = run(
    'docker',
    [
      'exec',
      '-e',
      'SQLCMDPASSWORD',
      id,
      '/opt/mssql-tools18/bin/sqlcmd',
      '-C',
      '-S',
      'localhost',
      '-U',
      'sa',
      '-h',
      '-1',
      '-W',
      '-Q',
      query,
    ],
    { capture: true, env: { ...process.env, SQLCMDPASSWORD: saPassword } },
  );
  if (!r.ok) return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

async function ensureSql() {
  if (ci) {
    if (!(await tcpReachable(sqlHost, sqlPort)))
      fail(`--ci: SQL Server is not reachable on ${sqlHost}:${sqlPort}.`);
    if (!process.env.Database__ConnectionString)
      fail('--ci: Database__ConnectionString must be set.');
    log(`SQL Server reachable on ${sqlHost}:${sqlPort}.`);
    return { connectionString: process.env.Database__ConnectionString, saPassword: null };
  }

  const docker = dockerAvailable();
  if (fresh) {
    if (!docker) fail('--fresh needs Docker.');
    log('--fresh: removing the SQL container and its data volume (docker compose down -v).');
    if (!run('docker', ['compose', 'down', '-v']).ok) fail('docker compose down -v failed.');
    rmSync(stackEnvFile, { force: true });
  }

  if (!existsSync(dotEnvFile)) {
    if (process.env.Database__ConnectionString) {
      // The developer runs their own SQL Server and passes the connection string.
    } else {
      writeFileSync(dotEnvFile, `MSSQL_SA_PASSWORD=${strongPassword()}\n`, { mode: 0o600 });
      log(
        `Created ${dotEnvFile} with a generated MSSQL_SA_PASSWORD (git-ignored; delete it after \`docker compose down -v\`).`,
      );
    }
  }
  const saPassword = readDotEnv().MSSQL_SA_PASSWORD || null;

  if (!(await tcpReachable(sqlHost, sqlPort))) {
    if (!docker)
      fail(
        `SQL Server is not reachable on ${sqlHost}:${sqlPort} and Docker is not available. Start Docker Desktop.`,
      );
    if (!saPassword) fail(`MSSQL_SA_PASSWORD missing in ${dotEnvFile}.`);
    log('Starting SQL Server (docker compose up -d sqlserver)...');
    if (!run('docker', ['compose', 'up', '-d', 'sqlserver']).ok)
      fail('docker compose up -d sqlserver failed.');
  } else {
    log(`SQL Server reachable on ${sqlHost}:${sqlPort}.`);
  }
  if (docker && sqlContainerId()) await waitForSqlHealthy();

  const connectionString =
    process.env.Database__ConnectionString ||
    (saPassword
      ? `Server=${sqlHost},${sqlPort};Database=${dbName};User Id=sa;Password=${saPassword};TrustServerCertificate=True`
      : fail(`Set Database__ConnectionString or MSSQL_SA_PASSWORD in ${dotEnvFile}.`));
  return { connectionString, saPassword };
}

/** Env vars win, then e2e/.auth/stack.env.json (so reruns against the same database keep working), then random. */
function resolveCredentials(saPassword) {
  const saved = readStackEnv();
  if (!saved && !ci && saPassword) {
    const users = countUsers(saPassword);
    if (users !== null && users > 0 && !process.env.E2E_ADMIN_PASSWORD) {
      fail(
        `The database ${dbName} already has ${users} user(s) but ${stackEnvFile} is missing, so the E2E admin ` +
          'credentials are unknown (the API seeds the admin only into an empty Users table). ' +
          'Run `npm run e2e:stack -- --fresh` to drop the SQL data volume (docker compose down -v) and start over, ' +
          'or export E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_ADMIN_NEW_PASSWORD.',
      );
    }
  }
  const creds = {
    adminEmail: process.env.E2E_ADMIN_EMAIL || saved?.adminEmail || 'admin@e2e.test',
    adminPassword: process.env.E2E_ADMIN_PASSWORD || saved?.adminPassword || strongPassword(),
    adminNewPassword:
      process.env.E2E_ADMIN_NEW_PASSWORD || saved?.adminNewPassword || strongPassword(),
    apiUrl,
  };
  mkdirSync(authDir, { recursive: true });
  writeFileSync(stackEnvFile, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  log(
    `E2E credentials in ${path.relative(webRoot, stackEnvFile)} (admin ${creds.adminEmail}; passwords not shown).`,
  );
  return creds;
}

function migrate(connectionString) {
  log('dotnet tool restore');
  if (!run('dotnet', ['tool', 'restore']).ok) fail('dotnet tool restore failed.');
  log('Applying migrations (dotnet ef database update, Release)...');
  const r = run(
    'dotnet',
    [
      'ef',
      'database',
      'update',
      '--configuration',
      'Release',
      '--startup-project',
      'src/EnterpriseRag.Infrastructure',
      '--project',
      'src/EnterpriseRag.Infrastructure',
    ],
    { env: { ...process.env, Database__ConnectionString: connectionString } },
  );
  if (!r.ok) fail('dotnet ef database update failed.');
}

async function apiReady() {
  try {
    const res = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(3000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM'); // the whole process group (dotnet run + the API)
    } catch {
      child.kill('SIGTERM');
    }
  }
}

async function main() {
  if (await apiReady()) {
    fail(
      `Something already answers ${apiUrl}/health/ready. Stop that API first (this script owns the E2E API process).`,
    );
  }
  const { connectionString, saPassword } = await ensureSql();
  const creds = resolveCredentials(saPassword);
  migrate(connectionString);

  const port = new URL(apiUrl).port || '80';
  const apiEnv = {
    ...process.env,
    ASPNETCORE_URLS: `http://127.0.0.1:${port}`,
    ASPNETCORE_ENVIRONMENT: process.env.ASPNETCORE_ENVIRONMENT || 'Production',
    Database__ConnectionString: connectionString,
    Jwt__SigningKey: process.env.Jwt__SigningKey || randomBytes(48).toString('base64'),
    Seed__AdminEmail: creds.adminEmail,
    Seed__AdminPassword: creds.adminPassword,
  };
  log(
    `Building and starting the API in Release on ${apiUrl} (dotnet run -c Release --no-launch-profile)...`,
  );
  const child = spawn('dotnet', ['run', '-c', 'Release', '--no-launch-profile'], {
    cwd: apiProjectDir, // content root: appsettings.json is found
    env: apiEnv,
    stdio: 'inherit',
    detached: !isWindows, // own process group on Linux so the whole tree can be stopped
  });

  let stopping = false;
  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    log('Stopping the API...');
    stopTree(child);
    if (down && !ci) {
      log('--down: stopping the SQL container (docker compose down; data volume kept).');
      run('docker', ['compose', 'down']);
    }
    process.exit(code);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  if (isWindows) process.on('SIGBREAK', () => shutdown(0));
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[e2e-stack] ERROR: the API exited with code ${code}.`);
      shutdown(1);
    }
  });

  const deadline = Date.now() + 120_000;
  while (!(await apiReady())) {
    if (Date.now() > deadline) {
      console.error(`[e2e-stack] ERROR: ${apiUrl}/health/ready did not answer 200 within 120 s.`);
      shutdown(1);
      return;
    }
    await delay(1000);
  }
  log(
    `API PID ${child.pid} (dotnet run). stack ready: ${apiUrl} — now run \`npm run e2e\` in another shell. Ctrl+C stops the API.`,
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
