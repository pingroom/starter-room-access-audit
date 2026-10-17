import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials } from '../src/config.js';
import { validatePolicy } from '../src/model.js';
import { parseJson, readJson } from '../src/storage.js';
import { samplePolicy, MEMBER_ID, OWNER_ID } from '../src/offline.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'access-audit-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'input.json');
}

test('complete environment pair overrides even corrupt saved credentials', async (t) => {
  const path = await fixture(t); await writeFile(path, '{broken');
  assert.deepEqual(await loadCredentials({ PINGROOM_TOKEN: ' token ', PINGROOM_ROOM: ' demo ' }, path), { token: 'token', room: 'DEMO' });
});

test('partial or blank environment pairs never borrow saved credentials', async (t) => {
  const path = await fixture(t); await writeFile(path, JSON.stringify({ token: 'saved', room: 'SAVED' }));
  for (const env of [{ PINGROOM_TOKEN: 'token' }, { PINGROOM_ROOM: 'DEMO' },
    { PINGROOM_TOKEN: '', PINGROOM_ROOM: 'DEMO' }, { PINGROOM_TOKEN: 'token', PINGROOM_ROOM: ' ' }]) {
    await assert.rejects(loadCredentials(env, path));
  }
});

test('saved credentials reject nonobjects, invalid tokens, and invalid room codes', async (t) => {
  const path = await fixture(t);
  for (const value of [null, [], { token: '', room: 'DEMO' }, { token: 'bad\nheader', room: 'DEMO' },
    { token: 'token', room: 'https://example.com' }, { token: 'token', room: 'x'.repeat(65) }]) {
    await writeFile(path, JSON.stringify(value)); await assert.rejects(loadCredentials({}, path));
  }
  await writeFile(path, JSON.stringify({ token: 'saved-token', room: 'demo' }));
  assert.deepEqual(await loadCredentials({}, path), { token: 'saved-token', room: 'DEMO' });
});

test('policy rejects extra keys, invalid UUIDs, duplicates, unsupported roles, and owner ambiguity', () => {
  const member = { userId: MEMBER_ID, role: 'member' };
  for (const policy of [null, [], { ...samplePolicy, unused: true }, { ...samplePolicy, version: 2 },
    { ...samplePolicy, roomId: 'wrong' }, { ...samplePolicy, expectedMembers: [member] },
    { ...samplePolicy, expectedMembers: [...samplePolicy.expectedMembers, member] },
    { ...samplePolicy, expectedMembers: [{ userId: OWNER_ID, role: 'owner', label: 'owner' }] },
    { ...samplePolicy, expectedMembers: [{ userId: OWNER_ID, role: 'owner' }, { userId: MEMBER_ID, role: 'owner' }] },
    { ...samplePolicy, expectedMembers: [{ userId: OWNER_ID, role: 'manager' }] },
    { ...samplePolicy, expectedMembers: Array.from({ length: 1001 }, () => member) },
  ]) assert.throws(() => validatePolicy(policy));
});

test('strict JSON detects duplicate escaped keys and respects key-looking string content', () => {
  assert.throws(() => parseJson('{"version":1,"version":2}'), /Duplicate/);
  assert.throws(() => parseJson('{"value":1,"v\\u0061lue":2}'), /Duplicate/);
  assert.throws(() => parseJson('{"rows":[{"role":"member","role":"owner"}]}'), /Duplicate/);
  assert.deepEqual(parseJson('{"literal":"{\\\"role\\\":1}","rows":[{"role":"owner"},{"role":"member"}]}'),
    { literal: '{"role":1}', rows: [{ role: 'owner' }, { role: 'member' }] });
  assert.throws(() => parseJson('{broken'), /valid JSON/);
  assert.throws(() => parseJson('['.repeat(21) + '0' + ']'.repeat(21)), /nesting/);
});

test('bounded file reading rejects oversized, invalid UTF-8, and malformed JSON input', async (t) => {
  const path = await fixture(t);
  await writeFile(path, 'x'.repeat(1025)); await assert.rejects(readJson(path, 1024), /byte limit/);
  await writeFile(path, Buffer.from([0x22, 0xff, 0x22])); await assert.rejects(readJson(path, 1024), /UTF-8/);
  await writeFile(path, '{'); await assert.rejects(readJson(path, 1024), /valid JSON/);
  await writeFile(path, JSON.stringify(samplePolicy)); assert.deepEqual(await readJson(path, 1024), samplePolicy);
});

test('local policy input does not follow symlinks on supported POSIX platforms', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows link creation needs separate permissions.');
  const path = await fixture(t); await writeFile(path, JSON.stringify(samplePolicy));
  await symlink(path, `${path}.link`); await assert.rejects(readJson(`${path}.link`, 1024));
});
