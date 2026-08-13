# WXT and React for Private Bookmarks

## What each tool does

- WXT is a browser-extension framework/build system. It provides file-based extension entrypoints, manifest generation, dev mode, builds, packaging, and browser-specific configuration. It is UI-framework agnostic and officially supports React through modules/templates. Sources: [WXT introduction](https://wxt.dev/guide/introduction.html), [WXT entrypoints](https://wxt.dev/guide/essentials/entrypoints.html), [WXT React module](https://wxt.dev/guide/essentials/frontend-frameworks.html).
- React is a UI library. Components and hooks address rendering and shared interactive state, but React does not generate an extension manifest, define service workers, package an extension, or abstract browser targets. Sources: [React: Describing the UI](https://react.dev/learn/describing-the-ui), [React: Managing State](https://react.dev/learn/managing-state).
- They are complementary rather than alternatives: the relevant choices are vanilla/WXT, React without WXT, WXT + React, or keeping the current vanilla extension.

## Fit for this repository

The current extension already has the MV3 shell that WXT would otherwise create: `manifest.json`, a service worker, popup, side panel, full-page UI, content injection, permissions, and packaging-ready static files. Adopting WXT alone therefore improves development/build organization but does not materially improve the product UI.

The main UI is currently a roughly 5,000-line vanilla module that renders large HTML strings and manually rebinds many event handlers. The confirmed redesign adds three responsive surfaces, local-first state, synchronization status, and conflict resolution. React directly addresses this growing UI/state complexity. WXT does not.

## Recommendation

For the redesign, use **WXT + React**, but keep the backend, pure logic modules, and storage/sync code framework-independent.

- WXT owns entrypoints, manifest generation, dev/build/package, and Chrome/Edge variants.
- React owns the shared popup/side-panel/full-page management UI.
- IndexedDB, sync, WebDAV, parsing, filters, and extension messaging remain ordinary TypeScript modules, not React components.
- Migrate one vertical slice first (local bookmark list/search in all three surfaces) before removing the existing vanilla UI.

If the user wants the smallest possible diff and is willing to keep the current UI architecture, use neither. **WXT alone is not enough reason to migrate this working extension.**

## Cost and risk

- WXT alone: medium churn, low immediate product benefit.
- React alone on the current static shell: medium-high UI migration cost, meaningful maintainability benefit.
- WXT + React: highest initial migration cost, best fit if the already-confirmed UI/data redesign is proceeding now.
- A big-bang rewrite is the main risk. Preserve existing Worker APIs, background/content behavior, and pure tested modules; replace the UI and data access in slices.
