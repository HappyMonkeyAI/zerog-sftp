# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately
through GitHub's [private vulnerability reporting][advisories] on this
repository (Security tab → "Report a vulnerability").

Please include the affected version or commit, a description of the issue, and
steps to reproduce if you can. You can expect an initial response within a few
days.

[advisories]: https://github.com/HappyMonkeyAI/zerog-sftp/security/advisories/new

## Supported versions

This project is pre-1.0 and ships from `main`. Security fixes land on `main`
only; there are no maintained release branches yet.

## Security model

ZeroG SFTP is a front end for the OpenSSH `sftp` client. It is worth being
explicit about what that means:

- **No credentials are stored.** Passwords and passphrases are typed into the
  app, written to the PTY for the current session, and never persisted to disk
  or logs. Host-key confirmation is likewise passed through to OpenSSH.
- **OpenSSH owns the trust decisions.** Host keys, `known_hosts`, agent
  forwarding, and identity files are all handled by `sftp`. This app does not
  implement its own host-key verification, so an SSH configuration that skips
  verification stays skipped.
- **The renderer is sandboxed.** `contextIsolation` is enabled,
  `nodeIntegration` is disabled, the preload bridge exposes a fixed set of IPC
  calls, and a Content Security Policy restricts what the page may load.
- **Paths are validated in the main process** before being interpolated into
  SFTP commands. Quotes, glob characters, and control characters are rejected.

## Out of scope

- Vulnerabilities in OpenSSH, Electron, or `node-pty` themselves. Report those
  upstream, though a note here is welcome if the app needs to work around one.
- Anything that requires an attacker to already control the local machine or the
  user's SSH configuration.
