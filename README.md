# PingRoom room access audit

Compare a private room's human members and roles with a reviewed JSON policy. Each run saves missing members, unexpected members, and role changes to a private local report. Use it before sharing sensitive material or in a scheduled access-review job.

The audit reads PingRoom through the official SDK. It does not change membership, revoke access, send pings, or mark notifications read.

## Try it offline

Requires Node.js 22 or newer. Choose **Use this template**, clone your repository, then:

```sh
npm ci
npm run demo
npm test
```

The demo uses the real pinned SDK with an in-memory HTTP transport and temporary files. It shows a matching policy, membership drift, and an API failure that replaces the earlier report. It reads no credentials and contacts no services. Package installation requires npm access.

Uses `@pingroom/sdk` 0.6.0, pinned with a lockfile and a 14-day npm release-age policy. CI runs the tests and demo on Node 22 and 24.

## Connect and prepare a policy

1. Install or open [PingRoom](https://pingroom.io/i), sign in, and choose a **standard private room**.
2. Run `npm run connect`. Approve the printed link and grant the connection access to that room. Keep using the same link while pairing is pending.
3. Run `npm run inspect` to print the room UUID and observed human UUIDs and roles. Review these identities in PingRoom; the observed roster is not automatically approved.
4. Copy `policy.example.json` to `policy.json` and replace its sample UUIDs and roles with your reviewed expectations. Then run `npm start`.

If the audit room differs from the robot's home room, pair with an explicit granted room code:

```sh
npm run connect -- --room YOUR_ROOM_CODE
npm run inspect
cp policy.example.json policy.json
```

The policy has version `1`, a `roomId` UUID, and an `expectedMembers` array of `{ "userId": "UUID", "role": "member" }` entries. Supported roles are `owner`, `admin`, and `member`; exactly one expected member must be the owner. UUIDs must be unique. Extra fields and duplicate JSON keys are rejected. The sample UUIDs are fictional; there is no automatic baseline adoption or policy update.

Pairing saves `.pingroom/credentials.json` with POSIX directory/file permissions `0700`/`0600`. Keep this directory private on Windows. Pairing again replaces that saved connection. For unattended use, supply **both** `PINGROOM_TOKEN` and `PINGROOM_ROOM` through your secret store or the ignored `.env` file. A complete environment pair overrides saved credentials; partial or blank pairs fail. The audit uses the production API and needs `pingroom:rooms:read` plus access to the room. Pairing grants are controlled by PingRoom and may be broader than this audit's read-only behavior.

`POLICY_FILE` optionally selects a different policy path, relative to this project or absolute. Policies are limited to 256 KiB and 1000 members. Default credentials, policy, and reports are ignored by Git. If you choose another policy filename, keep it private and add it to `.gitignore`.

## Read and use the result

```sh
npm start
cat .audit/latest.json
```

| Exit code | Report status | Meaning |
| --- | --- | --- |
| `0` | `pass` | The observed human roster matches this policy. |
| `2` | `drift` | Review `missing`, `unexpected`, and `roleChanges`. |
| `1` | `error` or incomplete | The run could not finish a fresh audit. |

The report includes a unique run ID, timestamps, room UUID, normalized policy hash, counts, and observed UUIDs/roles. Names, email addresses, tokens, and room messages are not copied into it. Reports use owner-only POSIX permissions.

Every run first writes `running`, then replaces it atomically with its result. Invalid policy, missing credentials, unavailable room, malformed roster, and API failure produce an error rather than reusing a previous pass. If the process dies, `running` can remain. If the report directory cannot be written or another run owns the lock, the command exits nonzero and an older report may remain. **Use the command's exit status and current run's timestamps; never treat an older report as the failed run's result.**

Run the command from your existing scheduler. For example, a shell job can allow subsequent work only after a successful audit:

```sh
npm start && printf 'Roster matched the reviewed policy for this run.\n'
```

Replace the sample print with your application step. This starter does not install a scheduler, deploy anything, or perform external actions. For a Node application, import `runAudit` from `src/audit.js` and provide `directory` plus a `prepare` callback returning `{ client, room, policy }`; use `createReadOnlyClient` from `src/client.js`. Keep rule evaluation and any resulting action in application code.

## Scope and limits

Only standard private rooms are supported because their room-list response exposes the full human roster. Public and personal rooms can filter members and are rejected. The room must be visible to the connected account and granted to the robot. The audit validates owner identity, member UUID uniqueness, room bindings, and known roles. Unrecognized or inconsistent data fails closed.

This checks **human membership and roles only**. Robot registrations, token grants, devices, effective notification delivery, room passwords, and other access mechanisms are outside its scope. It does not certify that a room is secure. `rooms.list` also returns other room data in memory; the starter discards it and saves only the minimal roster. Responses over 4 MiB or 1000 rooms are rejected.

Membership can change during or immediately after the API read. A pass describes that observation; it does not lock the room or guarantee access will remain unchanged. Set your application's freshness requirement and handle later access changes independently.

`.audit/latest.json` retains only the latest attempt. Archive reports privately if your process needs history. A local `.audit/run.lock/` prevents overlapping writers. After a crash, inspect its `owner.json`, confirm the old process has stopped, and remove only the lock directory before rerunning. PIDs can be reused. Use one persistent local filesystem; this is not a distributed lock.

[SDK](https://github.com/pingroom/sdk) · [Room blueprint](https://github.com/pingroom/starter-room-blueprint) · [Room archive](https://github.com/pingroom/starter-room-archive)

MIT licensed. See [LICENSE](LICENSE).
