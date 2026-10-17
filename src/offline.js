import { createReadOnlyClient } from './client.js';

export const ROOM_ID = '3d60c74a-925f-4c23-a13a-1cb3bf0396d8';
export const OWNER_ID = 'a89fbac6-a02f-4848-a3b7-94c47184a537';
export const MEMBER_ID = 'e1d0375b-9042-42d8-82ac-c61b6c4b7738';
export const OTHER_ID = '8b097b6f-3d3f-435d-bae2-ae0145aa6023';
export const samplePolicy = { version: 1, roomId: ROOM_ID,
  expectedMembers: [{ userId: OWNER_ID, role: 'owner' }, { userId: MEMBER_ID, role: 'member' }] };
export const sampleRoom = { id: ROOM_ID, invite_code: 'DEMO', type: 'standard', is_public: false, owner_id: OWNER_ID,
  members: samplePolicy.expectedMembers.map(({ userId, role }) => ({ user_id: userId, role, room_id: ROOM_ID,
    user: { id: userId, name: 'Sample human', email: 'private@example.com' } })),
  notifications: [{ message: 'Private message content must never enter the audit.' }],
};

/** Exercises the installed official SDK, with an in-memory HTTP transport only. */
export function offlineClient({ rooms = [sampleRoom], status = 200, body, failure } = {}) {
  const calls = [];
  const client = createReadOnlyClient({ token: 'offline-token', baseUrl: 'https://audit-demo.invalid',
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (failure) throw failure;
      return new Response(body ?? JSON.stringify(rooms), { status, headers: { 'content-type': 'application/json' } });
    },
  });
  return { client, calls };
}
