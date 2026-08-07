# Private Bookmarks

An independent Chrome and Edge bookmark extension with a private Cloudflare Worker and D1 backend.

## Deploy the Private Instance

1. Create a D1 database: `npx wrangler d1 create private-bookmarks`.
2. Put the returned `database_id` into `wrangler.toml`.
3. Create the cover bucket once: `npx wrangler r2 bucket create private-bookmarks-covers`.
4. Apply the schema: `npx wrangler d1 migrations apply private-bookmarks --remote`.
5. Set a long random access key: `npx wrangler secret put ACCESS_KEY`.
6. Deploy: `npx wrangler deploy`.

The cover editor uploads JPG, PNG, GIF, WebP, and AVIF files up to 5 MB to the configured R2 bucket. If `COVERS` is not bound, the rest of the library still works and the upload action remains unavailable.

The Worker URL and access key are entered once in each browser installation. The key is stored only in that browser's local extension storage.

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
