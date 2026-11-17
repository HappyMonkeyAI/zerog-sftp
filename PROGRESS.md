# ZeroG SFTP Progress

## Current state

The renderer now supports:

- Local and remote directory navigation.
- A `..` parent-directory row in each listing.
- Up-arrow controls beside each current path, disabled at the root.
- Name sorting with directories grouped before files in ascending order and after files in descending order.
- Alphabetical ordering within directory/file groups.
- Date sorting with alphabetical name tie-breaking.
- Shift-click range selection in both panes.
- Sequential upload and download queues for selected items.
- Queue position and current item in the transfer progress status.
- Single-item-only remote Rename and Delete actions.
- Recursive folder upload and download (the whole subtree, not just top-level files).
- Hidden files (dotfiles) are hidden by default in both panes, with a "Show hidden" checkbox in the toolbar that reveals them on both sides at once. Folders containing only hidden entries show a "Nothing here but hidden files." hint.
- Fixed the SFTP connect timeout so it is cleared once the session becomes interactive. Previously the 30s timer kept running during a transfer and killed long directory uploads mid-run, so only quick single-file transfers appeared to work.
- Persistent directory favourites with separate local and host-scoped remote entries, per-pane controls, normalization, and path-only storage in `favourite-directories.json` under Electron `userData`.
- Notify-only GitHub release checks with a title-bar Updates menu, startup/manual controls, skipped versions, safe release links, and no automatic download or installation.

## Documentation

- README usage documentation has been updated with navigation, selection, queue, sorting, directory favourites, update notifications, and the packaged-build limitation.

## Verification

`npm run ci` passes:

- TypeScript typecheck passed.
- Vitest: 7 test files, 42 tests passed.
- Production Vite build passed.
- `git diff --check` passed.

The favourites suite has 9 tests covering normalization, host scoping, and the JSON store. The update suite has 15 tests covering version comparison, release-link sanitization, notification policy, service behavior, and stored settings.

## Remaining limitation

The packaged Windows application still needs an Electron-native `node-pty` rebuild and a real packaged transfer exercise. The existing README documents this packaging limitation.

## Working tree

The implementation and documentation changes are uncommitted in:

- `src/main/main.ts`
- `src/main/preload.cjs`
- `src/main/favourite-store.ts`
- `src/main/update-service.ts`
- `src/renderer/main.tsx`
- `src/renderer/styles.css`
- `src/renderer/favourites-control.tsx`
- `src/renderer/update-control.tsx`
- `src/renderer/update-prompt.tsx`
- `src/renderer/update-settings.ts`
- `src/renderer/update-view.ts`
- `src/shared/types.d.ts`
- `src/shared/favourites.ts`
- `src/shared/update.ts`
- `tests/favourites.test.ts`
- `tests/update.test.ts`
- `README.md`
- `PROGRESS.md`

The pre-existing untracked `VAC-DISKSPACE-REPORT.md` is unrelated and remains untouched.
