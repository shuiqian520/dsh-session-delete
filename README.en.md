# dsh-session-delete

English · [中文](README.md)

A DeepSeek Harness (DSH) plugin that **permanently deletes a session** from the sidebar
session menu and adds a **Retry** button right of Copy on both user messages and assistant
replies.

- **Delete means delete**: the session log directory, its workspace membership, the live
  Host instances, and the client list row are all cleared together — no ghost rows, no
  "ungrouped" leftovers, no restart required.
- **Retry resends that input**: retrying an assistant reply resends the user input right
  before it; retrying a user message resends that message. The DSH event log is
  append-only, so the old reply stays above and the new one is appended below.

## Requirements

DSH 0.2.x (Web UI or Desktop). No runtime dependencies and no `@deepseek-ai/dsh-*`
peerDependencies, so no version gating applies. Node ≥ 22 is only needed for development.

## Install

Put this directory in your workspace and run the plugin manager's
`install_bundle` with the directory's absolute path as the target. It installs the package
into the current profile, applies the bundled [`cordis.patch.yml`](cordis.patch.yml)
(`- insert: id: session-delete`), and adds `dsh-session-delete` to `dsh.profile.bundles`.
Profiles with HMR pick it up immediately; otherwise restart DSH once.

Alternatively, `npm pack` the package and install the produced `.tgz`, or junction the
directory into `<profile>/node_modules` and add the dependency + bundle entry by hand
(host changes need a restart; client changes need a restart and a page reload).

## Usage

- **Delete a session**: session row "…" → "Delete this session" → confirmation dialog.
  Running sessions are refused (the menu item is disabled and the Host re-checks); sessions
  whose log is already gone are still offered, as a list-only cleanup.
- **Retry**: the refresh icon right of Copy on an assistant reply or a user message.
  Text only — image and file attachments are not resent.

## Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/session-delete/status?sessionId=<id>` | `{ running, artifactExists, deletable, reason }` |
| POST | `/api/session-delete/delete` | body `{ sessionId, confirm: true }` → `{ ok, mode, detached, disposed, announced }` |
| POST | `/api/session-delete/sweep` | clean leftover rows whose log no longer exists |
| GET | `/api/session-delete/retry-source?sessionId=<id>&messageId=<id>` | read-only: the text that message would resend |

`mode` is one of `purge` (default, permanent), `recycle`, `quarantine` (fallback holding
area) or `ghost` (the log is already gone; only the list row is cleared).

Retry has **no** Host route: `sessionController.prompt` is a `@Remote` method whose
definition needs the gateway-provided signal, so a plugin calling it directly throws
`Cannot read properties of undefined (reading 'throwIfAborted')`. Delivery goes through the
official client session binding instead —
`sessions.using(id, { source: 'workspaceOperation' }, (ref) => ref.binding.session.prompt([{ type: 'text', text }], 'queue'))`
— and the Host only resolves the text to resend.

## Configuration

| Field | Default | Meaning |
|-------|---------|---------|
| `trashMode` | `purge` | `purge` deletes permanently; `recycle` prefers the OS recycle bin and falls back to a holding area |
| `quarantineDir` | `~/.dsh/trash/session-delete` | holding area used by the fallback path |

## Localization

Visible text goes through the Client `locale` service (`locale.register` + `locale.bind`),
with `zh` and `en` dictionaries; everything falls back to Chinese when the service or a
dictionary is missing. Manifest metadata lives in [`locale/zh.json`](locale/zh.json),
[`locale/en.json`](locale/en.json) and [`icon.svg`](icon.svg). Host-side error strings are
Chinese only, which is a known limitation.

## Safety notes

- Deletion is permanent by default and cannot be undone; set `trashMode: recycle` if you
  need a recoverable path.
- The plugin declares no hard `inject`. Every Host service it uses is soft-injected inside
  `apply`, so a missing or renamed service only means "no routes registered" — it can never
  park the bundle as `pending` and break web boot.
- `sweep` only touches sessions whose log directory does not exist; anything with a log on
  disk is reported back in `kept` and left alone.

## Development

```sh
node --test test/smoke.mjs
```

The suite uses a real temporary directory plus injected executor and store stubs; it never
touches a real session. Implementation notes and the official contracts this plugin relies
on are in [`docs/internals.md`](docs/internals.md).

## License

[MIT](LICENSE)
