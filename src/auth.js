

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';
import { info } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// Secrets live in a per-user folder outside the repo, so they can't be
// committed by accident and survive re-cloning. Override with
// GMAIL_CLEANUP_HOME.
export const CONFIG_DIR =
  process.env.GMAIL_CLEANUP_HOME || path.join(os.homedir(), '.gmail-cleanup');

// Setups from before the config folder existed keep working: if only the
// repo root holds credentials.json, keep reading (and writing) there.
function resolveSecretsDir() {
  if (existsSync(path.join(CONFIG_DIR, 'credentials.json'))) return CONFIG_DIR;
  if (existsSync(path.join(PROJECT_ROOT, 'credentials.json'))) return PROJECT_ROOT;
  return CONFIG_DIR;
}

const SECRETS_DIR = resolveSecretsDir();
export const CREDENTIALS_PATH = path.join(SECRETS_DIR, 'credentials.json');
export const TOKEN_PATH = path.join(SECRETS_DIR, 'token.json');

// gmail.modify allows reading, trashing, and label changes, but NOT
// permanent deletion (that would require the narrower/riskier
// https://mail.google.com/ scope, which this tool intentionally avoids).
export const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

class AuthError extends Error {}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertCredentialsFilePresent() {
  const exists = await fileExists(CREDENTIALS_PATH);
  if (!exists) {
    throw new AuthError(
      `Could not find credentials.json.\n\n` +
        `  Expected at: ${CREDENTIALS_PATH}\n\n` +
        `  To fix this:\n` +
        `    1. Go to https://console.cloud.google.com/apis/credentials\n` +
        `    2. Create an OAuth client ID of type "Desktop app"\n` +
        `    3. Download the JSON file it gives you\n` +
        `    4. Rename it to credentials.json\n` +
        `    5. Place it at the path shown above (create the folder if needed)\n\n` +
        `  See README.md for the full step-by-step setup.`
    );
  }
}

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch {
    // Missing, unreadable, or corrupt token -> fall through to re-auth.
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  // Restrictive permissions: this file is effectively a password to your inbox.
  await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_PATH, payload, { mode: 0o600 });
}

export async function authorize() {
  await assertCredentialsFilePresent();

  const saved = await loadSavedCredentialsIfExist();
  if (saved) {
    return saved;
  }

  info('No saved token found (or it is invalid). Opening browser for Google sign-in...');

  let client;
  try {
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
  } catch (err) {
    // Local-auth surfaces cancellations and misconfigured redirect URIs here.
    throw new AuthError(
      `Google sign-in did not complete: ${err.message || err}\n` +
        `  If you closed the browser tab or denied access, just run the command again.`
    );
  }

  if (client.credentials) {
    await saveCredentials(client);
    info(`Token saved to ${TOKEN_PATH} for future runs.`);
  }

  return client;
}

export { AuthError };
