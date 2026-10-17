import { createReadOnlyClient } from './client.js';
import { loadCredentials, loadEnv } from './config.js';
import { readRoster } from './model.js';

try {
  if (process.argv.length !== 2) throw new Error('No arguments accepted.');
  loadEnv();
  const { token, room } = await loadCredentials();
  const roster = readRoster(await createReadOnlyClient({ token }).rooms.list(), room);
  console.error('Observed human roster, not an approved policy. Review identities and roles before copying this to policy.json.');
  console.log(JSON.stringify({ version: 1, roomId: roster.roomId, expectedMembers: roster.members }, null, 2));
} catch {
  console.error('Could not inspect the granted standard private room. Check connection and room access.');
  process.exitCode = 1;
}
