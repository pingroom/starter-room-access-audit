import { randomUUID } from 'node:crypto';
import { AuditError, compareRoster, readRoster, validatePolicy } from './model.js';
import { atomicJson, withReportLock } from './storage.js';

export const exitCodeFor = (status) => status === 'pass' ? 0 : status === 'drift' ? 2 : 1;

/** Initialize latest.json before setup: missing credentials or bad policy cannot leave a stale pass. */
export async function runAudit({ directory, prepare, now = () => new Date() }) {
  return withReportLock(directory, async () => {
    const base = { version: 1, runId: randomUUID(), startedAt: now().toISOString(), scope: 'human_members' };
    await atomicJson(directory, 'latest.json', { ...base, status: 'running' });
    let report;
    try {
      const { client, room, policy: rawPolicy } = await prepare();
      const policy = validatePolicy(rawPolicy);
      const rooms = await client.rooms.list();
      const roster = readRoster(rooms, room);
      report = { ...base, ...compareRoster(policy, roster), completedAt: now().toISOString() };
    } catch (error) {
      // API errors can contain returned room content; only local fixed messages enter reports.
      report = { ...base, status: 'error', completedAt: now().toISOString(),
        error: error instanceof AuditError
          ? { code: error.code, message: error.message }
          : { code: 'audit_failed', message: 'Could not finish a fresh audit. Check setup, network, and room access, then run again.' } };
    }
    await atomicJson(directory, 'latest.json', report);
    return report;
  });
}
