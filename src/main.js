import { runAudit, exitCodeFor } from './audit.js';
import { createReadOnlyClient } from './client.js';
import { loadCredentials, loadEnv, loadPolicy, reportDirectory } from './config.js';

try {
  const report = await runAudit({ directory: reportDirectory, prepare: async () => {
    if (process.argv.length !== 2) throw new Error('No arguments accepted.');
    loadEnv();
    const policy = await loadPolicy();
    const { token, room } = await loadCredentials();
    return { client: createReadOnlyClient({ token }), room, policy };
  } });
  console.log(`Audit ${report.status}. Fresh report: .audit/latest.json`);
  if (report.status === 'drift') console.log(`${report.missing.length} missing, ${report.unexpected.length} unexpected, ${report.roleChanges.length} role changes.`);
  if (report.status === 'error') console.error(report.error.message);
  process.exitCode = exitCodeFor(report.status);
} catch {
  console.error('Audit could not write its report or acquire its lock. This run did not pass; do not use an older latest.json as its result.');
  process.exitCode = 1;
}
