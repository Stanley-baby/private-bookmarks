import assert from "node:assert/strict";
import test from "node:test";
import { runHealthChecks } from "../src/health.js";

test("weekly health checks follow a 405 response and preserve uncertain failures", async () => {
  const updates = [];
  const store = {
    async healthCandidates() {
      return [{ id: "gone", link: "https://example.test/gone" }, { id: "blocked", link: "https://example.test/blocked" }];
    },
    async updateHealth(id, health) {
      updates.push([id, health]);
    },
  };
  const fetcher = async (link, options) => {
    if (link.endsWith("blocked")) throw new Error("network unavailable");
    return options.method === "HEAD" ? new Response(null, { status: 405 }) : new Response(null, { status: 410 });
  };

  assert.deepEqual(await runHealthChecks(store, fetcher), { checked: 2 });
  assert.deepEqual(updates, [
    ["gone", { status: "broken", finalUrl: "https://example.test/gone" }],
    ["blocked", { status: "unknown", finalUrl: "https://example.test/blocked" }],
  ]);
});
