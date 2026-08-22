const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function retainedBackupNames(names, keep = 10) {
  return [...names].filter((name) => /^private-bookmarks-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.(json|pbe)$/.test(name)).sort().reverse().slice(0, Math.max(3, Math.min(50, Number(keep) || 10)));
}

export async function encodeBackup(value, password = "", cryptoImpl = crypto) {
  const plain = encoder.encode(JSON.stringify(value));
  if (!password) return { extension: "json", contentType: "application/json", body: plain };
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const material = await cryptoImpl.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await cryptoImpl.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { extension: "pbe", contentType: "application/json", body: encoder.encode(JSON.stringify({ format: "private-bookmarks/encrypted-v1", salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) })) };
}

export async function decodeBackup(value, password = "", cryptoImpl = crypto) {
  const text = typeof value === "string" ? value : decoder.decode(value);
  const parsed = JSON.parse(text);
  if (parsed?.format !== "private-bookmarks/encrypted-v1") return parsed;
  if (!password) throw new TypeError("此备份需要密码");
  const salt = base64ToBytes(parsed.salt), iv = base64ToBytes(parsed.iv), ciphertext = base64ToBytes(parsed.ciphertext);
  const material = await cryptoImpl.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await cryptoImpl.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 210_000 }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return JSON.parse(decoder.decode(await cryptoImpl.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)));
}
