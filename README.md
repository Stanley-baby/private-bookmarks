# Private Bookmarks

An independent Chrome and Edge bookmark extension with a private Cloudflare Worker and D1 backend.

## Deploy the Private Instance

1. Create a D1 database: `npx wrangler d1 create private-bookmarks`.
2. Put the returned `database_id` into `wrangler.toml`.
3. Create the cover bucket once: `npx wrangler r2 bucket create private-bookmarks-covers`.
4. Apply the schema: `npx wrangler d1 migrations apply private-bookmarks --remote`.
5. Set a long random access key: `npx wrangler secret put ACCESS_KEY`.
6. Deploy: `npx wrangler deploy`.

The cover editor uploads JPG, PNG, GIF, WebP, and AVIF files up to 5 MB to the configured R2 bucket. Cloud backups use the same bucket under the isolated `backups/<backup-id>/` prefix (or an optional `BACKUPS` binding). Media-enabled backups copy only this instance's uploaded `/v1/media/<uuid>` objects, verify SHA-256 checksums on restore, and can be downloaded as a store-only ZIP. If no R2 bucket is bound, media upload and server-side backups remain unavailable while the rest of the library still works.

To enable third-party cloud backup, register OAuth applications with Dropbox, Google Drive, and/or Microsoft identity, then set the corresponding Worker secrets/vars before deploying:

```text
DROPBOX_CLIENT_ID / DROPBOX_CLIENT_SECRET / DROPBOX_REDIRECT_URI (optional)
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI (optional)
ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET / ONEDRIVE_REDIRECT_URI (optional)
OAUTH_ENCRYPTION_KEY (recommended separate random secret; ACCESS_KEY is the fallback)
```

If a redirect URI is not set, use `https://<worker-host>/v1/cloud/<provider>/callback` in the provider console. OAuth refresh/access tokens are encrypted before they are stored in D1; they are never returned by the connection-status API.

The GitHub Actions deploy workflow reads these optional repository Secrets and syncs only non-empty values to the Worker: `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`, and `OAUTH_ENCRYPTION_KEY`. Add them under **Settings → Secrets and variables → Actions** (or with `gh secret set NAME`); never commit them to this repository or paste them into source files.

The Worker URL and access key are entered once in each browser installation. The key is stored only in that browser's local extension storage.

Bookmark recommendations can be enabled in **Settings → App**. “Recommended collections and tags” matches the new bookmark against existing local bookmark metadata; it does not upload data. “AI suggested tags and note” always shows editable suggestions before they are applied. The AI settings support several curated Cloudflare Workers AI models and external OpenAI-compatible APIs (`/v1` base URL plus model and API key). Cloudflare models marked “free quota” still follow the account's daily quota and are not unlimited free service. External API keys are encrypted in D1 and are never returned to the browser.

The current system Prompt is shown as the default in the AI settings. You can edit it and save it, or restore the default; custom Prompts keep a fixed JSON output contract so recommendation parsing remains safe. The static UI server (`npm run dev:ui`) cannot run the AI endpoint; use `npx wrangler dev --remote` for local Worker debugging, and keep the `[ai]` binding in `wrangler.toml` enabled. Set `OAUTH_ENCRYPTION_KEY` to a separate random secret when possible; it is used to encrypt stored external AI keys.

## Load the extension

Open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, then select `extension/`.

## Local checks

```sh
npm test
npm run check
```

## Debug the library page directly

```sh
npm run dev:ui
```

Open `http://127.0.0.1:4173/library.html`. The page stores its Worker address and access key in this browser page's local storage, separately from the extension. It accepts an `http://localhost` or `http://127.0.0.1` Worker only in this standalone debug page; the installed extension still requires HTTPS.
