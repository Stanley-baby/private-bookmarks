# Private Bookmarks

An independent Chrome and Edge bookmark extension with a private Cloudflare Worker and D1 backend.

## Deploy the Private Instance

1. Create a D1 database: `npx wrangler d1 create private-bookmarks`.
2. Put the returned `database_id` into `wrangler.toml`.
3. Apply the schema: `npx wrangler d1 migrations apply private-bookmarks --remote`.
4. Set a long random access key: `npx wrangler secret put ACCESS_KEY`.
5. Deploy: `npx wrangler deploy`.

The Worker URL and access key are entered once in each browser installation. The key is stored only in that browser's local extension storage.

## Load the extension

Open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, then select `extension/`.

## Local checks

```sh
npm test
npm run check
```
