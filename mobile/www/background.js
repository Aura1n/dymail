/* The page's side of background mail: a thin wrapper over the DymailBackground plugin
 * (native/DymailBackgroundPlugin.java.tpl), which window.__dymail provides inside the packaged app.
 * In a plain browser and in demo mode there is no plugin and backgroundAvailable() is false. */

let core = null;

/* bridge.js tells us where the local core listens; the service needs the same address and token. */
export function setCore(info) {
  core = info && info.url && info.token ? { url: info.url, token: info.token } : null;
}

function plugin() {
  const glue = window.__dymail;
  try {
    return glue && glue.Capacitor && glue.Capacitor.isNativePlatform() ? glue.DymailBackground : null;
  } catch {
    return null;
  }
}

export const backgroundAvailable = () => Boolean(plugin());

async function call(name, args) {
  const p = plugin();
  if (!p) throw new Error('当前环境不支持后台收信');
  return p[name](args);
}

export async function backgroundStatus() {
  try {
    return await call('status');
  } catch {
    return null;
  }
}

export async function enableBackground(intervalMin) {
  if (!core) throw new Error('本地邮件服务还没有就绪');
  return call('enable', { ...core, intervalMin });
}

export const disableBackground = () => call('disable');

/* Runs on every launch: the core has a new port and token, so a service that was switched on earlier
   has to be started again with them. A no-op when background mail is off. */
export async function syncBackground(intervalMin) {
  if (!core || !backgroundAvailable()) return null;
  try {
    return await call('sync', { ...core, intervalMin });
  } catch (err) {
    console.warn('[background]', err && err.message ? err.message : err);
    return null;
  }
}

export const requestNotifications = () => call('requestNotifications');
export const requestBatteryExemption = () => call('requestBatteryExemption');
export const openNotificationSettings = () => call('openNotificationSettings');
export const openAppSettings = () => call('openAppSettings');
