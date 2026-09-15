# ZeroG SFTP

Standalone SFTP file transfer client for Windows and OpenSSH.

The first slice discovers connection aliases from `~/.ssh/config`, accepts manual SSH targets, lists remote directories using the system `sftp` client, and supports upload/download plus remote create, rename, and delete operations. Transfers expose PTY-derived progress and can be cancelled. SSH configuration, agents, identity files, and `known_hosts` remain owned by OpenSSH. Password/passphrase and host-key prompts are shown in-app and are never stored.

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

