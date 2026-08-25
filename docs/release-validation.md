# Release validation — 0.1.0

Date: 2026-08-24

## Artifacts and rollback

- `npm run build:extension` produces `.output/chrome-mv3/` and `.output/private-bookmarks-0.1.0-chrome.zip`.
- The archival vanilla extension remains in `extension/`; it is not a production runtime or formal-test path. No legacy directory was deleted because final deletion requires explicit user confirmation.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | Passed; the command discovers every top-level formal test |
| `npm run typecheck` | Passed |
| `npm run check` | Passed |
| `npm run build:extension` | Passed; MV3 directory and versioned Chrome ZIP generated |

## Browser matrix

| Surface | Chrome/Chromium evidence | Edge evidence |
| --- | --- | --- |
| WXT library | Loaded the built library in Chromium, created an empty local library, and verified navigation, search, settings, import/export, health, and sync controls render without a runtime exception when the extension API bridge is present. | Not run: Microsoft Edge is not installed in this environment. |
| Cloud backup | Loaded the built cloud-backups page in Chromium and verified the local-only capability-gating message. | Not run: Microsoft Edge is not installed in this environment. |
| Manifest | MV3 build contains background worker, content script, optional `tabs` permission, and all six React entrypoints. | Same MV3 artifact is intended for Edge; manual load is still required. |

## Recovery evidence

- Replacement and merge restoration create and validate a migration safety snapshot before writes.
- Failed writes roll back to the prior library; if that rollback fails, sync remains paused and writes stay locked.
- Conflict resolution emits recovery copies into the outbox, including both original records for mixed field choices.

## Known limitations

- Third-party OAuth live smoke tests require provider credentials and were not run.
- Chrome was checked against the built UI with an extension-API bridge; loading the unpacked MV3 directory in Chrome and Edge remains the final manual release gate.
