# ZeroG SFTP

Standalone SFTP file transfer client for Windows and OpenSSH.

The first slice discovers connection aliases from `~/.ssh/config`, accepts manual SSH targets, lists remote directories using the system `sftp` client, and supports upload/download plus remote create, rename, and delete operations. Transfers expose PTY-derived progress and can be cancelled. SSH configuration, agents, identity files, and `known_hosts` remain owned by OpenSSH. Password/passphrase and host-key prompts are shown in-app and are never stored.

File navigation and selection:

- Double-click a directory to open it.
- Use the `..` row or the up-arrow beside the current path to go to the parent directory. The control is disabled at the filesystem/remote root.
- Click an item to select it; Shift-click another item to select the complete range between them.
- Upload and download operate on the selected items as a sequential queue. The progress display shows the current item and queue position.
- Selecting a folder and transferring it copies the whole tree — every subfolder and file — recursively. The connect timeout is cleared once the session is interactive, so long folder transfers are not interrupted mid-run.
- Name sorting keeps directories together: ascending puts directories first, descending puts them last. Items within each group are alphabetically sorted. Date sorting is chronological and uses the name as a tie-breaker.
- Hidden files (entries whose name starts with a dot) are hidden by default in both panes. Tick **Show hidden** in the toolbar to reveal them on both sides at once. When a folder contains only hidden entries, the pane shows "Nothing here but hidden files."


## Development

```text
npm install
npm run ci
npm start
```

## Windows packaging

```text
npm run dist:dir
npm run dist:portable
```

The current host can produce the unpacked and portable artifacts, but `node-pty` requires an Electron-native rebuild for the packaged app. The package configuration currently disables electron-builder’s automatic rebuild because this host is missing Visual Studio Spectre-mitigated libraries (`MSB8040`). Treat the generated artifacts as structural packaging evidence only until `node-pty` is rebuilt and a packaged transfer is exercised.

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Stephen Phillips and HappyMonkeyAI.

