import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyClient, RESPONSE_LIMIT } from '../src/client.js';
import { offlineClient, sampleRoom } from '../src/offline.js';

test('read-only wrapper blocks room detail and sends before reaching transport', async () => {
  const { client, calls } = offlineClient();
  await assert.rejects(client.rooms.get('DEMO'), /only GET/);
  await assert.rejects(client.broadcast('DEMO', { message: 'Must not be sent' }), /only GET/);
  await assert.rejects(client.rooms.create({ name: 'Must not be created' }));
  assert.equal(calls.length, 0);
});

test('SDK request uses explicit origin, bearer token, redirect refusal, and bounded deadline', async () => {
  let captured;
  const client = createReadOnlyClient({ token: 'test-token', baseUrl: 'https://audit-test.invalid',
    fetch: async (url, init) => { captured = { url, ...init }; return Response.json([sampleRoom]); } });
  assert.deepEqual(await client.rooms.list(), [sampleRoom]);
  assert.equal(captured.url, 'https://audit-test.invalid/api/agent/rooms');
  assert.equal(captured.headers.Authorization, 'Bearer test-token');
  assert.equal(captured.redirect, 'error');
  assert.ok(captured.signal instanceof AbortSignal);
});

test('transport rejects advertised and streamed responses exceeding 4 MiB', async () => {
  const responseFactories = [
    () => new Response('[]', { headers: { 'content-length': String(RESPONSE_LIMIT + 1) } }),
    () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(RESPONSE_LIMIT));
      controller.enqueue(new Uint8Array(1)); controller.close();
    } })),
  ];
  for (const make of responseFactories) {
    const client = createReadOnlyClient({ token: 'test-token', fetch: async () => make() });
    await assert.rejects(client.rooms.list(), /4 MiB/);
  }
});

test('SDK timeout interrupts a hanging mock without retrying', async () => {
  let calls = 0;
  const client = createReadOnlyClient({ token: 'test-token', timeoutMs: 30,
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      calls++;
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }) });
  await assert.rejects(client.rooms.list());
  assert.equal(calls, 1);
});
