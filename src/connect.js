import { PingRoom } from '@pingroom/sdk';
import { dirname } from 'node:path';
import { API_URL, createReadOnlyClient } from './client.js';
import { credentialsPath } from './config.js';
import { normalizeRoomCode, readRoster } from './model.js';
import { atomicJson, privateDirectory } from './storage.js';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--room')) throw new Error('Invalid arguments.');
  const requestedRoom = args.length ? normalizeRoomCode(args[1]) : undefined;
  console.log('Install or open PingRoom and sign in: https://pingroom.io/i');
  console.log('Grant access to the standard private room you want to audit.');
  const client = new PingRoom({ baseUrl: API_URL, timeoutMs: 10_000 });
  const pairing = await client.auth.startPairing({ agent_label: 'Room access audit' });
  console.log(`Approve this connection: ${pairing.pair_browser_url ?? pairing.pair_url}`);
  const active = await client.auth.waitForPairing(pairing, { signal: controller.signal });
  controller.signal.throwIfAborted();
  const room = requestedRoom ?? normalizeRoomCode((active.home_room ?? active.room)?.invite_code);
  readRoster(await createReadOnlyClient({ token: active.credential }).rooms.list(), room);
  controller.signal.throwIfAborted();
  const directory = dirname(credentialsPath);
  await privateDirectory(directory);
  await atomicJson(directory, 'credentials.json', { token: active.credential, room });
  console.log('Connection saved privately in .pingroom/credentials.json. Run npm run inspect, then prepare policy.json.');
} catch {
  console.error('Connection did not complete. Check network and room access. Use npm run connect -- --room ROOM_CODE to select a granted room instead of the home room.');
  process.exitCode = 1;
}
