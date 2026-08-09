import { AI_DEFAULT_MODEL, automaticBackupRetention, createApi, createCloudBackup, deleteCloudBackup } from "./src/core.js";
import { D1Store } from "./src/d1-store.js";
import { runHealthChecks } from "./src/health.js";

function app(env) {
  const store = new D1Store(env.DB);
  return createApi({
    key: env.ACCESS_KEY,
    store,
    mediaBucket: env.COVERS,
    backupBucket: env.BACKUPS || env.COVERS,
    ai: env.AI,
    aiModel: env.AI_MODEL || AI_DEFAULT_MODEL,
    oauth: {
      encryptionKey: env.OAUTH_ENCRYPTION_KEY || env.ACCESS_KEY,
      dropbox: { clientId: env.DROPBOX_CLIENT_ID, clientSecret: env.DROPBOX_CLIENT_SECRET, redirectUri: env.DROPBOX_REDIRECT_URI },
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
      onedrive: { clientId: env.ONEDRIVE_CLIENT_ID, clientSecret: env.ONEDRIVE_CLIENT_SECRET, redirectUri: env.ONEDRIVE_REDIRECT_URI },
    },
    healthCheck: (collectionId) => runHealthChecks(store, fetch, collectionId),
  });
}

export async function runScheduledTasks({ store, bucket, now = new Date() } = {}) {
  if (bucket) {
    try {
      await createCloudBackup({ store, bucket, kind: "automatic" });
      const old = automaticBackupRetention(await store.listBackups({ kind: "automatic" }), now);
      for (const item of old) await deleteCloudBackup({ store, bucket, id: item.id });
    } catch (reason) {
      console.error(reason);
    }
  }
  const [health, purge] = await Promise.all([
    runHealthChecks(store),
    store.purgeTrash(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString()),
  ]);
  return { health, purge };
}

export default {
  fetch(request, env) {
    return app(env).fetch(request);
  },

  scheduled(_controller, env, context) {
    const store = new D1Store(env.DB);
    context.waitUntil(runScheduledTasks({ store, bucket: env.BACKUPS || env.COVERS }));
  },
};
