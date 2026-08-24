import assert from "node:assert/strict";
import test from "node:test";
import { webdavFailure } from "../src/backup/webdav.ts";

test("WebDAV failures expose distinct authentication, path, and network codes", () => {
  assert.equal(webdavFailure(401).code, "webdav_auth_failed");
  assert.equal(webdavFailure(404, "PUT").code, "webdav_path_not_writable");
  assert.equal(webdavFailure(0).code, "webdav_network_error");
});
