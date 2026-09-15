# ZeroG SFTP

Standalone SFTP file transfer client for Windows and OpenSSH.

The first slice discovers connection aliases from `~/.ssh/config`, accepts manual SSH targets, lists remote directories using the system `sftp` client, and supports upload/download plus remote create, rename, and delete operations. Transfers expose PTY-derived progress and can be cancelled. SSH configuration, agents, identity files, and `known_hosts` remain owned by OpenSSH. Password/passphrase and host-key prompts are shown in-app and are never stored.

## Development

```text
npm install
npm run ci
npm start
```

Interactive password/passphrase and host-key prompts, file transfer operations, and packaging are subsequent slices.
