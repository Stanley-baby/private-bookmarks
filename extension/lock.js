const LOCK_KEY = "privateBookmarksLock";
const CONNECTION_KEY = "instanceConnection";
const SESSION_KEY = "privateBookmarksUnlocked";
const PBKDF2_ITERATIONS = 210000;
const extensionStorage = globalThis.chrome?.storage?.local;
const extensionSession = globalThis.chrome?.storage?.session;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let viewOpened = false;
let monitorStarted = false;
let monitorNotified = false;
let monitorCallback = null;

function localStorageValue(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

async function getLocal(key) {
  if (extensionStorage) return (await extensionStorage.get(key))[key] ?? null;
  return localStorageValue(key);
}

async function setLocal(key, value) {
  if (extensionStorage) return extensionStorage.set({ [key]: value });
  localStorage.setItem(key, JSON.stringify(value));
}

async function removeLocal(key) {
  if (extensionStorage) return extensionStorage.remove(key);
  localStorage.removeItem(key);
}

async function getSession() {
  if (extensionSession) return (await extensionSession.get(SESSION_KEY))[SESSION_KEY] ?? null;
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

async function setSession(value) {
  if (extensionSession) return extensionSession.set({ [SESSION_KEY]: value });
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

async function removeSession() {
  if (extensionSession) return extensionSession.remove(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function pinError(message, code, details = {}) {
  return Object.assign(new TypeError(message), { code, ...details });
}

function validPin(pin) {
  return /^\d{6,12}$/.test(String(pin || ""));
}

function autoLockValue(value) {
  const allowed = new Set(["open", "1", "5", "15", "30", "60", "never"]);
  return allowed.has(String(value)) ? String(value) : "15";
}

function autoLockMs(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

async function derivePin(pin, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 512));
  return { key: await crypto.subtle.importKey("raw", bits.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]), verifier: bits.slice(32) };
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function lockConfig() {
  const config = await getLocal(LOCK_KEY);
  if (!config) return null;
  return config.version === 1 && config.salt && config.verifier && config.iv && config.ciphertext && Number(config.iterations) > 0 ? config : { invalid: true };
}

export async function legacyConnection() {
  const value = await getLocal(CONNECTION_KEY);
  return value && typeof value.endpoint === "string" && typeof value.key === "string" ? value : null;
}

export async function activeConnection() {
  const config = await lockConfig();
  if (!config) return legacyConnection();
  const status = await lockState();
  if (status.locked) return null;
  const session = await getSession();
  return session?.connection || null;
}

export async function prepareLock() {
  if (viewOpened) return;
  viewOpened = true;
  const config = await lockConfig();
  if (config?.autoLock === "open") await removeSession();
}

export async function lockState() {
  const config = await lockConfig();
  if (!config) return { enabled: false, locked: false, autoLock: "15", cooldownUntil: 0 };
  if (config.invalid) return { enabled: true, locked: true, autoLock: "15", cooldownUntil: 0 };
  const now = Date.now();
  const cooldownUntil = Number(config.cooldownUntil) || 0;
  const session = await getSession();
  const timeout = autoLockMs(config.autoLock);
  if (session?.connection && timeout && now - Number(session.lastActivityAt || 0) >= timeout) {
    await removeSession();
    return { enabled: true, locked: true, autoLock: autoLockValue(config.autoLock), cooldownUntil };
  }
  return {
    enabled: true,
    locked: !session?.connection || cooldownUntil > now,
    autoLock: autoLockValue(config.autoLock),
    cooldownUntil,
  };
}

export async function touchActivity() {
  const config = await lockConfig();
  if (!config) return { enabled: false, locked: false };
  const status = await lockState();
  if (status.locked) return status;
  const session = await getSession();
  if (session?.connection) await setSession({ ...session, lastActivityAt: Date.now() });
  return status;
}

export async function unlock(pin) {
  const config = await lockConfig();
  if (!config) throw pinError("应用锁尚未启用", "pin_not_enabled");
  if (config.invalid) throw pinError("应用锁配置已损坏，请忘记 PIN 后重新连接", "pin_corrupt");
  const now = Date.now();
  const cooldownUntil = Number(config.cooldownUntil) || 0;
  if (cooldownUntil > now) throw pinError(`请在 ${Math.ceil((cooldownUntil - now) / 1000)} 秒后重试`, "pin_cooldown", { retryAfter: cooldownUntil - now });
  if (!validPin(pin)) throw pinError("PIN 码必须是 6–12 位数字", "invalid_pin_format");
  const { key, verifier } = await derivePin(pin, base64ToBytes(config.salt), config.iterations);
  if (!equalBytes(verifier, base64ToBytes(config.verifier))) {
    const attempts = Number(config.failedAttempts) || 0;
    const nextAttempts = attempts + 1;
    const delay = nextAttempts >= 5 ? Math.min(30_000, 2 ** Math.min(nextAttempts - 5, 5) * 1000) : 0;
    await setLocal(LOCK_KEY, { ...config, failedAttempts: nextAttempts, cooldownUntil: delay ? now + delay : 0 });
    throw pinError("PIN 码不正确", "invalid_pin", { attempts: nextAttempts, retryAfter: delay });
  }
  let connection;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(config.iv) }, key, base64ToBytes(config.ciphertext));
    connection = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw pinError("无法解锁本地连接，请忘记 PIN 后重新连接", "pin_corrupt");
  }
  await setLocal(LOCK_KEY, { ...config, failedAttempts: 0, cooldownUntil: 0 });
  await setSession({ connection, lastActivityAt: now });
  monitorNotified = false;
  return connection;
}

export async function enablePin(pin, autoLock = "15", connection) {
  if (!validPin(pin)) throw pinError("PIN 码必须是 6–12 位数字", "invalid_pin_format");
  if (!connection?.endpoint || !connection?.key) throw pinError("请先连接私有实例", "connection_required");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { key, verifier } = await derivePin(pin, salt);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify({ endpoint: connection.endpoint, key: connection.key }))));
  await setLocal(LOCK_KEY, { version: 1, salt: bytesToBase64(salt), verifier: bytesToBase64(verifier), iterations: PBKDF2_ITERATIONS, iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext), autoLock: autoLockValue(autoLock), failedAttempts: 0, cooldownUntil: 0 });
  await removeLocal(CONNECTION_KEY);
  await setSession({ connection: { endpoint: connection.endpoint, key: connection.key }, lastActivityAt: Date.now() });
}

export async function setAutoLock(value) {
  const config = await lockConfig();
  if (!config) throw pinError("应用锁尚未启用", "pin_not_enabled");
  await setLocal(LOCK_KEY, { ...config, autoLock: autoLockValue(value) });
}

export async function lockNow() {
  await removeSession();
  monitorNotified = true;
}

export async function disablePin(pin) {
  const connection = await unlock(pin);
  await setLocal(CONNECTION_KEY, connection);
  await removeLocal(LOCK_KEY);
  await removeSession();
  monitorNotified = false;
}

export async function forgetPin() {
  await removeLocal(LOCK_KEY);
  await removeLocal(CONNECTION_KEY);
  await removeSession();
  monitorNotified = false;
}

export function startLockMonitor(onLock) {
  monitorCallback = onLock;
  if (monitorStarted || typeof document === "undefined") return;
  monitorStarted = true;
  const check = async () => {
    const status = await touchActivity();
    if (status.enabled && status.locked && !monitorNotified) {
      monitorNotified = true;
      await monitorCallback?.();
    }
  };
  for (const event of ["pointerdown", "keydown", "wheel", "touchstart"]) document.addEventListener(event, check, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  window.setInterval(check, 5_000);
}
