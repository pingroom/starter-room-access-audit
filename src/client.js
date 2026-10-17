import { PingRoom } from '@pingroom/sdk';
import { AuditError } from './model.js';

export const API_URL = 'https://api.pingroom.io';
export const RESPONSE_LIMIT = 4 * 1024 * 1024;

/** Enforce the single read route, even if a future caller accidentally uses another SDK method. */
export function createReadOnlyClient({ token, fetch: transport = globalThis.fetch, baseUrl = API_URL, timeoutMs = 10_000 }) {
  const expectedUrl = `${baseUrl}/api/agent/rooms`;
  return new PingRoom({ token, baseUrl, timeoutMs,
    fetch: async (url, init) => {
      if (String(url) !== expectedUrl || init.method !== 'GET' || init.body !== undefined) {
        throw new AuditError('forbidden_request', 'Auditing permits only GET /api/agent/rooms.');
      }
      const response = await transport(url, init);
      const size = Number(response.headers.get('content-length'));
      if (Number.isFinite(size) && size > RESPONSE_LIMIT) {
        await response.body?.cancel();
        throw new AuditError('response_limit', 'Room listing exceeds 4 MiB.');
      }
      const reader = response.body?.getReader();
      if (!reader) return response;
      const chunks = [];
      let count = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          count += value.byteLength;
          if (count > RESPONSE_LIMIT) throw new AuditError('response_limit', 'Room listing exceeds 4 MiB.');
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
}
