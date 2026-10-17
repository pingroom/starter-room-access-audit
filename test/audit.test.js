import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAudit, exitCodeFor } from '../src/audit.js';
import { offlineClient, samplePolicy, sampleRoom, ROOM_ID, MEMBER_ID, OWNER_ID, OTHER_ID } from '../src/offline.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'access-audit-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const latest = async () => JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
  const run = (options = {}, policy = samplePolicy, room = 'DEMO') => {
    const mock = offlineClient(options);
    return { ...mock, result: runAudit({ directory, prepare: async () => ({ client: mock.client, policy, room }) }) };
  };
  return { directory, latest, run };
}

test('matching policy uses only the SDK room-list GET and persists a private minimal report', async (t) => {
  const f = await fixture(t);
  const run = f.run();
  const result = await run.result;
  assert.equal(result.status, 'pass');
  assert.deepEqual(run.calls, [{ url: 'https://audit-demo.invalid/api/agent/rooms', method: 'GET', body: undefined }]);
  assert.deepEqual(await f.latest(), result);
  assert.equal(result.observedCount, 2);
  assert.equal(result.missing.length + result.unexpected.length + result.roleChanges.length, 0);
  const json = JSON.stringify(result);
  for (const privateValue of ['offline-token', 'email', 'private@example.com', 'Private message', 'Sample human']) assert.equal(json.includes(privateValue), false);
  assert.match(result.policySha256, /^[a-f0-9]{64}$/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(f.directory, 'latest.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
  }
});

test('fresh runs detect unexpected members, missing members, and changed roles', async (t) => {
  const f = await fixture(t);
  await f.run().result;
  const room = structuredClone(sampleRoom);
  room.members[1].role = 'admin';
  room.members.push({ user_id: OTHER_ID, role: 'member', room_id: ROOM_ID });
  const changed = await f.run({ rooms: [room] }).result;
  assert.equal(changed.status, 'drift');
  assert.deepEqual(changed.unexpected, [{ userId: OTHER_ID, role: 'member' }]);
  assert.deepEqual(changed.roleChanges, [{ userId: MEMBER_ID, expectedRole: 'member', observedRole: 'admin' }]);
  room.members.splice(1, 1);
  const missing = await f.run({ rooms: [room] }).result;
  assert.deepEqual(missing.missing, [{ userId: MEMBER_ID, role: 'member' }]);
  assert.equal(missing.roleChanges.length, 0);
  assert.notEqual(missing.runId, changed.runId);
});

test('a consistent ownership transfer is reported as role drift, never silently accepted', async (t) => {
  const f = await fixture(t);
  const room = structuredClone(sampleRoom);
  room.owner_id = MEMBER_ID;
  room.members[0].role = 'member';
  room.members[1].role = 'owner';
  const result = await f.run({ rooms: [room] }).result;
  assert.equal(result.status, 'drift');
  assert.equal(result.roleChanges.length, 2);
});

test('running report replaces an earlier pass before setup or fetch completes', async (t) => {
  const f = await fixture(t);
  const earlier = await f.run().result;
  let release, entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const result = runAudit({ directory: f.directory, prepare: async () => {
    entered(); await waiting;
    throw new Error('Simulated setup failure with secret-token');
  } });
  await started;
  const during = await f.latest();
  assert.equal(during.status, 'running');
  assert.notEqual(during.runId, earlier.runId);
  assert.equal('observedMembers' in during, false);
  release();
  const failed = await result;
  assert.equal(failed.status, 'error');
  assert.equal(JSON.stringify(failed).includes('secret-token'), false);
  assert.deepEqual(await f.latest(), failed);
});

test('API denial, unavailable service, malformed JSON, and transport failures replace stale pass', async (t) => {
  const f = await fixture(t);
  for (const options of [
    { status: 403, body: JSON.stringify({ message: 'Denied private secret-token' }) },
    { status: 503, body: JSON.stringify({ message: 'Unavailable secret-token' }) },
    { body: '{broken secret-token' },
    { failure: new Error('connection failed secret-token') },
  ]) {
    await f.run().result;
    const failed = await f.run(options).result;
    assert.equal(failed.status, 'error');
    assert.equal(JSON.stringify(failed).includes('secret-token'), false);
    assert.equal((await f.latest()).status, 'error');
    assert.equal('observedMembers' in failed, false);
  }
});

test('absent and duplicate configured rooms fail instead of treating absence as no members', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run({ rooms: [] }).result).error.code, 'room_unavailable');
  assert.equal((await f.run({ rooms: [sampleRoom, sampleRoom] }).result).error.code, 'invalid_roster');
});

test('public, personal, unknown-type, and missing-privacy rooms fail', async (t) => {
  const f = await fixture(t);
  for (const change of [{ is_public: true }, { type: 'personal' }, { type: 'unknown' }, { is_public: undefined }]) {
    const result = await f.run({ rooms: [{ ...sampleRoom, ...change }] }).result;
    assert.equal(result.error.code, 'unsupported_room');
  }
});

test('invalid member UUIDs, roles, duplicates, and wrong room bindings fail', async (t) => {
  const f = await fixture(t);
  const second = sampleRoom.members[1];
  const variants = [
    [sampleRoom.members[0], { ...second, user_id: '00000000-0000-0000-0000-000000000000' }],
    [sampleRoom.members[0], { ...second, role: 'superuser' }],
    [...sampleRoom.members, { ...second, user_id: MEMBER_ID.toUpperCase() }],
    [sampleRoom.members[0], { ...second, room_id: OTHER_ID }],
    [sampleRoom.members[0], { user_id: MEMBER_ID, role: 'member' }],
    [sampleRoom.members[0], null],
  ];
  for (const members of variants) assert.equal((await f.run({ rooms: [{ ...sampleRoom, members }] }).result).error.code, 'invalid_roster');
});

test('missing, multiple, or inconsistent owners cannot produce a pass', async (t) => {
  const f = await fixture(t);
  const variants = [
    { owner_id: undefined }, { owner_id: OTHER_ID }, { members: [sampleRoom.members[1]] },
    { members: sampleRoom.members.map((row) => ({ ...row, role: 'owner' })) },
    { members: [] }, { members: null },
  ];
  for (const change of variants) assert.equal((await f.run({ rooms: [{ ...sampleRoom, ...change }] }).result).error.code, 'invalid_roster');
});

test('policy room UUID prevents auditing the wrong room despite a valid code', async (t) => {
  const f = await fixture(t);
  const result = await f.run({}, { ...samplePolicy, roomId: OTHER_ID }).result;
  assert.equal(result.error.code, 'room_mismatch');
});

test('malformed policies fail before any request, replacing an earlier pass', async (t) => {
  const f = await fixture(t);
  await f.run().result;
  const run = f.run({}, { ...samplePolicy, expectedMembers: [] });
  assert.equal((await run.result).error.code, 'invalid_policy');
  assert.equal(run.calls.length, 0);
  assert.equal((await f.latest()).status, 'error');
});

test('overlapping audits cannot replace an active run, and a leftover lock fails', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.directory, 'run.lock'));
  await writeFile(join(f.directory, 'run.lock', 'owner.json'), JSON.stringify({ pid: 123 }));
  await assert.rejects(f.run().result, /report lock/);
  await assert.rejects(f.latest(), { code: 'ENOENT' });
});

test('each audit fetches again; recovered access gives a fresh report without cached data', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run({ rooms: [] }).result).status, 'error');
  const retry = f.run();
  assert.equal((await retry.result).status, 'pass');
  assert.equal(retry.calls.length, 1);
});

test('stable policy hash ignores ordering and UUID case', async (t) => {
  const f = await fixture(t);
  const first = await f.run().result;
  const policy = { ...samplePolicy, roomId: ROOM_ID.toUpperCase(),
    expectedMembers: [...samplePolicy.expectedMembers].reverse().map((row) => ({ ...row, userId: row.userId.toUpperCase() })) };
  const second = await f.run({}, policy, 'demo').result;
  assert.equal(second.status, 'pass');
  assert.equal(second.policySha256, first.policySha256);
});

test('exit statuses distinguish pass, drift, and incomplete audits', () => {
  assert.equal(exitCodeFor('pass'), 0);
  assert.equal(exitCodeFor('drift'), 2);
  for (const status of ['error', 'running', undefined]) assert.equal(exitCodeFor(status), 1);
});
