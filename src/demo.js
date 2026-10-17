import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAudit } from './audit.js';
import { offlineClient, samplePolicy, sampleRoom, OTHER_ID, ROOM_ID } from './offline.js';

const directory = await mkdtemp(join(tmpdir(), 'pingroom-access-audit-demo-'));
try {
  const changed = structuredClone(sampleRoom);
  changed.members[1].role = 'admin';
  changed.members.push({ user_id: OTHER_ID, room_id: ROOM_ID, role: 'member' });
  for (const [name, options] of [ ['Matching policy', {}], ['New member and promoted role', { rooms: [changed] }],
    ['Unavailable API', { status: 503, body: JSON.stringify({ message: 'Temporary offline demo failure' }) }] ]) {
    const { client } = offlineClient(options);
    const report = await runAudit({ directory, prepare: async () => ({ client, room: 'DEMO', policy: samplePolicy }) });
    console.log(`${name}: ${report.status}${report.status === 'drift' ? ` (${report.unexpected.length} unexpected, ${report.roleChanges.length} role change)` : ''}`);
  }
  console.log('All requests stayed in the local mock. The failed run replaced the earlier report; no stale pass was returned.');
} finally { await rm(directory, { recursive: true, force: true }); }
