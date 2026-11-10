# ZeroG SFTP

A standalone, two-pane SFTP client for Windows.

ZeroG SFTP drives the OpenSSH `sftp` client you already have installed, so your
existing `~/.ssh/config`, `ssh-agent`, identity files, and `known_hosts` keep
working exactly as they do from the terminal. There is no separate credential
store: passwords, passphrases, and host-key confirmations are asked for in the
app and never persisted.

## Features

- **Profile discovery** from `~/.ssh/config`, plus manual `user@host` targets.
- **Two-pane explorer** with Details, Icons, and Thumbnails views. `Ctrl` +
  mouse wheel zooms the icon and thumbnail views.
- **Image thumbnails** for remote files, fetched over SFTP and cached on disk.
- **Transfers** as a sequential queue with per-item progress, queue position,
  and cancellation. Folders transfer recursively.
- **Remote file operations**: create directory, rename, delete.
- **Selection and sorting**: click to select, `Shift`-click for a range, sort by
  name or date with directories grouped together.
- **Hidden files** are hidden by default; a toolbar toggle reveals them in both
  panes at once.

## Requirements

- Windows 10 (1809 or later) or Windows 11.
- The OpenSSH client. Windows ships `sftp.exe` at
  `%SystemRoot%\System32\OpenSSH\sftp.exe`. If it is missing, install the
  "OpenSSH Client" optional feature.
- Node.js 20 or later for development.

## Getting started

```text
npm install
npm run build
npm start
```

`npm run ci` runs the full verification used by continuous integration:
typecheck, tests, then a production build.

## Packaging

```text
npm run dist:dir
npm run dist:portable
```

`node-pty` is a native module and must be rebuilt against Electron's ABI for a
packaged build to work. Automatic rebuild is currently disabled in the
`electron-builder` configuration because it requires Visual Studio's
Spectre-mitigated libraries (`MSB8040`). Treat the generated artifacts as
structural packaging output until `node-pty` is rebuilt and a packaged transfer
has been exercised end to end.

## How it works

- The Electron main process spawns the system `sftp` binary through `node-pty`
  and writes commands once the `sftp>` prompt appears. Progress percentages are
  parsed from the PTY stream.
- The renderer is sandboxed: `contextIsolation` on, `nodeIntegration` off, a
  narrow preload bridge, and a restrictive Content Security Policy. Filesystem
  and network access only happen in the main process.
- Paths are validated in the main process before they reach the shell, rejecting
  quotes, glob characters, and control characters.

## Project layout

```text
src/main/       Electron main process and the preload bridge
src/renderer/   React UI
src/shared/     SSH config parsing and the IPC contract
tests/          Vitest suites
scripts/        Build helpers
```

## Limitations

- Packaging targets are Windows only, and the `sftp` executable discovery is
  Windows-specific.
- Transfers run one item at a time. Mutations are not queued.
- No built-in key management; use `ssh-agent` and your SSH config.

## Contributing

Issues and pull requests are welcome. Run `npm run ci` before opening a pull
request, and keep the preload bridge, the main-process handlers, and
`src/shared/types.d.ts` in sync — a test enforces that parity.

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Stephen Phillips and HappyMonkeyAI.
