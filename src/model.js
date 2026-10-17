import { createHash } from 'node:crypto';

export class AuditError extends Error {
  constructor(code, message) { super(message); this.name = 'AuditError'; this.code = code; }
}

export const MAX_MEMBERS = 1000;
const roles = new Set(['owner', 'admin', 'member']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const fail = (code, message) => { throw new AuditError(code, message); };
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const sorted = (rows) => rows.sort((a, b) => a.userId.localeCompare(b.userId));

export function validatePolicy(raw) {
  if (!keys(raw, ['version', 'roomId', 'expectedMembers']) || raw.version !== 1 || !isUuid(raw.roomId)
    || !Array.isArray(raw.expectedMembers) || raw.expectedMembers.length < 1 || raw.expectedMembers.length > MAX_MEMBERS) {
    fail('invalid_policy', 'Policy needs version 1, a room UUID, and 1–1000 expected members.');
  }
  const seen = new Set();
  const members = raw.expectedMembers.map((row) => {
    if (!keys(row, ['userId', 'role']) || !isUuid(row.userId) || !roles.has(row.role)) {
      fail('invalid_policy', 'Every expected member needs a UUID and owner, admin, or member role.');
    }
    const userId = row.userId.toLowerCase();
    if (seen.has(userId)) fail('invalid_policy', 'Expected member UUIDs must be unique.');
    seen.add(userId);
    return { userId, role: row.role };
  });
  if (members.filter((row) => row.role === 'owner').length !== 1) fail('invalid_policy', 'Policy must name exactly one owner.');
  return { version: 1, roomId: raw.roomId.toLowerCase(), expectedMembers: sorted(members) };
}

export function normalizeRoomCode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.trim())) {
    fail('invalid_connection', 'Supply a nonblank room code, up to 64 letters, digits, underscores, or hyphens.');
  }
  return value.trim().toUpperCase();
}

/** rooms.list supplies all human member rows only for the supported private room type. */
export function readRoster(rooms, rawCode) {
  const code = normalizeRoomCode(rawCode);
  if (!Array.isArray(rooms) || rooms.length > 1000 || rooms.some((room) => !object(room) || typeof room.invite_code !== 'string')) {
    fail('invalid_roster', 'Room listing is malformed or exceeds 1000 rooms.');
  }
  const matches = rooms.filter((room) => room.invite_code.toUpperCase() === code);
  if (matches.length === 0) fail('room_unavailable', 'The configured room is absent from the granted room listing.');
  if (matches.length !== 1) fail('invalid_roster', 'The listing contains duplicate configured rooms.');
  const room = matches[0];
  if (room.type !== 'standard' || room.is_public !== false) fail('unsupported_room', 'Only standard private rooms have the supported full human roster.');
  if (!isUuid(room.id) || !isUuid(room.owner_id) || !Array.isArray(room.members)
    || room.members.length < 1 || room.members.length > MAX_MEMBERS) {
    fail('invalid_roster', 'Room identity, owner, or human roster is missing or malformed.');
  }
  const roomId = room.id.toLowerCase();
  const ownerId = room.owner_id.toLowerCase();
  const seen = new Set();
  const members = room.members.map((row) => {
    if (!object(row) || !isUuid(row.user_id) || !roles.has(row.role)
      || !isUuid(row.room_id) || row.room_id.toLowerCase() !== roomId) {
      fail('invalid_roster', 'A member UUID, room binding, or role is invalid.');
    }
    const userId = row.user_id.toLowerCase();
    if (seen.has(userId)) fail('invalid_roster', 'The roster contains a duplicate human UUID.');
    seen.add(userId);
    return { userId, role: row.role };
  });
  const owners = members.filter((row) => row.role === 'owner');
  if (owners.length !== 1 || owners[0].userId !== ownerId) fail('invalid_roster', 'The roster owner does not match the room owner.');
  return { roomId, ownerId, members: sorted(members) };
}

export function compareRoster(policy, roster) {
  if (policy.roomId !== roster.roomId) fail('room_mismatch', 'The room UUID does not match the policy.');
  const expected = new Map(policy.expectedMembers.map((row) => [row.userId, row.role]));
  const actual = new Map(roster.members.map((row) => [row.userId, row.role]));
  const missing = policy.expectedMembers.filter((row) => !actual.has(row.userId));
  const unexpected = roster.members.filter((row) => !expected.has(row.userId));
  const roleChanges = policy.expectedMembers
    .filter((row) => actual.has(row.userId) && actual.get(row.userId) !== row.role)
    .map((row) => ({ userId: row.userId, expectedRole: row.role, observedRole: actual.get(row.userId) }));
  return {
    status: missing.length + unexpected.length + roleChanges.length ? 'drift' : 'pass',
    scope: 'human_members', roomId: roster.roomId, ownerId: roster.ownerId,
    policySha256: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    expectedCount: expected.size, observedCount: actual.size,
    missing, unexpected, roleChanges, observedMembers: roster.members,
  };
}
