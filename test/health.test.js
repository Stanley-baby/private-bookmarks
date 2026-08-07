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

test("health levels match the reference broken-link thresholds", async () => {
  const links = ["https://example.test/missing", "https://example.test/dns", "https://example.test/server"];
  const run = async (brokenLevel, fetcher) => {
    const updates = [];
    const store = {
      async getPreferences() { return { brokenLevel }; },
      async healthCandidates() { return links.map((link) => ({ id: link, link })); },
      async updateHealth(id, health) { updates.push([id, health]); },
    };
    const result = await runHealthChecks(store, fetcher);
    return { result, updates };
  };
  const fetcher = async (link) => {
    if (link.endsWith("missing")) return new Response(null, { status: 404 });
    if (link.endsWith("dns")) {
      const error = new Error("getaddrinfo ENOTFOUND example.test");
      error.code = "ENOTFOUND";
      throw error;
    }
    return new Response(null, { status: 503 });
  };

  assert.deepEqual((await run("basic", fetcher)).updates.map(([, health]) => health.status), ["broken", "unknown", "unknown"]);
  assert.deepEqual((await run("default", fetcher)).updates.map(([, health]) => health.status), ["broken", "broken", "unknown"]);
  assert.deepEqual((await run("strict", fetcher)).updates.map(([, health]) => health.status), ["broken", "broken", "broken"]);

  let calls = 0;
  const off = await run("off", async () => { calls += 1; return new Response(null, { status: 200 }); });
  assert.deepEqual(off.result, { checked: 0 });
  assert.deepEqual(off.updates, []);
  assert.equal(calls, 0);
});

test("strict health checks mark more than five redirects as broken", async () => {
  const updates = [];
  const store = {
    async getPreferences() { return { brokenLevel: "strict" }; },
    async healthCandidates() { return [{ id: "loop", link: "https://example.test/0" }]; },
    async updateHealth(id, health) { updates.push([id, health]); },
  };
  const fetcher = async (link) => new Response(null, { status: 302, headers: { location: `${new URL(link).origin}/${Number(new URL(link).pathname.slice(1)) + 1}` } });

  assert.deepEqual(await runHealthChecks(store, fetcher), { checked: 1 });
  assert.deepEqual(updates, [["loop", { status: "broken", finalUrl: "https://example.test/5" }]]);
});
