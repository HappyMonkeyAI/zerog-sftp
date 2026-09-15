# ZeroG SFTP

Standalone SFTP file transfer client for Windows and OpenSSH.

The first slice discovers connection aliases from `~/.ssh/config`, accepts manual SSH targets, and lists a remote directory using the system `sftp` client. SSH configuration, agents, identity files, and `known_hosts` remain owned by OpenSSH.

## Development

```text
npm install
npm run ci
npm start
```

Interactive password/passphrase and host-key prompts, file transfer operations, and packaging are subsequent slices.
