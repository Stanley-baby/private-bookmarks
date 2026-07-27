import { createApi } from "./src/core.js";
import { D1Store } from "./src/d1-store.js";
import { runHealthChecks } from "./src/health.js";

function app(env) {
  const store = new D1Store(env.DB);
  return createApi({
    key: env.ACCESS_KEY,
    store,
    healthCheck: (collectionId) => runHealthChecks(store, fetch, collectionId),
  });
}

export default {
  fetch(request, env) {
    return app(env).fetch(request);
  },

  scheduled(_controller, env, context) {
    const store = new D1Store(env.DB);
    context.waitUntil(Promise.all([
      runHealthChecks(store),
      store.purgeTrash(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString()),
    ]));
  },
};
