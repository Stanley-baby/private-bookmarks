export async function enableAppLock(enable, pin, autoLock, connection) {
  return enable(pin, autoLock, await connection());
}
