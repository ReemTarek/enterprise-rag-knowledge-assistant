import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Folder for generated, git-ignored run state (credentials file from e2e-stack, storage states). */
export const AUTH_DIR = path.resolve(__dirname, '..', '.auth');
/** Written by `npm run e2e:stack` (scripts/e2e-stack.mjs). Never committed, never printed. */
export const STACK_ENV_FILE = path.join(AUTH_DIR, 'stack.env.json');
/** Admin browser session saved by global setup (refresh cookie for localhost, Path=/api/auth). */
export const ADMIN_STATE_FILE = path.join(AUTH_DIR, 'admin.json');
/** Created by the first worker that takes over ADMIN_STATE_FILE (the refresh cookie may be used by one chain only). */
export const ADMIN_STATE_CLAIM_FILE = path.join(AUTH_DIR, 'admin.claimed');

export interface E2eEnv {
  /** Angular dev server (same origin as `/api` through the proxy). */
  readonly baseUrl: string;
  /** The API itself, used only for the readiness check in global setup. */
  readonly apiUrl: string;
  readonly adminEmail: string;
  /** The seeded password (`Seed__AdminPassword`); the admin must change it at first sign-in. */
  readonly adminPassword: string;
  /** The password the admin has after global setup. */
  readonly adminNewPassword: string;
  /** Unique per `playwright test` run (set by global setup); used in generated emails and names. */
  readonly runId: string;
}

interface StackEnvFile {
  adminEmail?: string;
  adminPassword?: string;
  adminNewPassword?: string;
  apiUrl?: string;
}

function readStackFile(): StackEnvFile {
  if (!existsSync(STACK_ENV_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STACK_ENV_FILE, 'utf8')) as StackEnvFile;
  } catch {
    throw new Error(
      `${STACK_ENV_FILE} is not valid JSON. Delete it and restart \`npm run e2e:stack\`.`,
    );
  }
}

function pick(name: string, fromFile: string | undefined, fallback?: string): string {
  const value = process.env[name] || fromFile || fallback;
  if (!value) {
    throw new Error(
      `${name} is not set and ${STACK_ENV_FILE} does not provide it. Start the stack with \`npm run e2e:stack\` ` +
        '(it generates the E2E credentials) or export the variable.',
    );
  }
  return value;
}

let cached: E2eEnv | undefined;

/** Resolved lazily: env vars win over the stack file; credentials are required, URLs have defaults. */
export function loadEnv(): E2eEnv {
  if (cached) return cached;
  const file = readStackFile();
  cached = {
    baseUrl: pick('E2E_BASE_URL', undefined, 'http://localhost:4200').replace(/\/$/, ''),
    apiUrl: pick('E2E_API_URL', file.apiUrl, 'http://127.0.0.1:5180').replace(/\/$/, ''),
    adminEmail: pick('E2E_ADMIN_EMAIL', file.adminEmail, 'admin@e2e.test'),
    adminPassword: pick('E2E_ADMIN_PASSWORD', file.adminPassword),
    adminNewPassword: pick('E2E_ADMIN_NEW_PASSWORD', file.adminNewPassword),
    runId: process.env['E2E_RUN_ID'] || 'local',
  };
  return cached;
}

/** Convenience accessor for specs (`env.baseUrl`); throws on first use if credentials are missing. */
export const env: E2eEnv = new Proxy({} as E2eEnv, {
  get: (_target, prop: keyof E2eEnv) => loadEnv()[prop],
});
