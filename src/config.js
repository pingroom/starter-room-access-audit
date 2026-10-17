import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AuditError, normalizeRoomCode } from './model.js';
import { readJson } from './storage.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const credentialsPath = resolve(root, '.pingroom/credentials.json');
export const reportDirectory = resolve(root, '.audit');

export function loadEnv() {
  try { process.loadEnvFile(resolve(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw new AuditError('invalid_env', 'Could not load .env.'); }
}

export async function loadCredentials(env = process.env, path = credentialsPath) {
  let values;
  if (env.PINGROOM_TOKEN !== undefined || env.PINGROOM_ROOM !== undefined) {
    values = { token: env.PINGROOM_TOKEN, room: env.PINGROOM_ROOM };
  } else {
    try { values = await readJson(path, 16_384); }
    catch { throw new AuditError('invalid_connection', 'Run npm run connect or provide both PINGROOM_TOKEN and PINGROOM_ROOM.'); }
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)
    || typeof values.token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(values.token.trim())) {
    throw new AuditError('invalid_connection', 'Provide both nonblank PINGROOM_TOKEN and PINGROOM_ROOM. Partial pairs never borrow saved values.');
  }
  return { token: values.token.trim(), room: normalizeRoomCode(values.room) };
}

export async function loadPolicy(env = process.env) {
  const path = env.POLICY_FILE ?? 'policy.json';
  if (!path.trim()) throw new AuditError('invalid_policy', 'POLICY_FILE must name a JSON policy file.');
  return readJson(resolve(root, path), 256 * 1024);
}
