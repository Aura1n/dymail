/* Chooses the data layer for the mobile UI.
 *
 *   1. Android app  - the native shell runs the core inside the app (capacitor-nodejs). dist/glue.js (built by
 *                     scripts/build-www.js) puts the Capacitor plugins on window.__dymail; we ask the Node side
 *                     where its local bridge listens and talk to that. See connectNativeCore().
 *   2. Real core    - ?core=http://127.0.0.1:PORT&token=...  (desktop testing against mobile/core)
 *                     or window.__DYMAIL_CORE__ = {url, token} injected by a native shell.
 *   3. Demo data    - plain browser, or forced with ?demo=1. Shares the sample mailbox with the desktop build.
 */

import { setCore } from './background.js';

const CORE_TIMEOUT_MS = 45000;
const ASK_EVERY_MS = 700;

/* glue.js only exists in the packaged app, so it is imported by a variable path: a plain browser (dev.js, demo)
   gets a 404 here, which just means "not running inside the app". */
async function loadNativeGlue() {
  if (window.__dymail) return window.__dymail;
  try {
    const glue = './glue.js';
    await import(glue);
  } catch {
    return null;
  }
  return window.__dymail || null;
}

function isNative(glue) {
  try {
    return Boolean(glue && glue.Capacitor && glue.Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

/* The Node side starts with the app. We keep asking until it answers, because we can't know whether
   it is already up (page reload) or still booting (cold start). */
function connectNativeCore(NodeJS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const handles = [];
    const stop = () => {
      settled = true;
      clearInterval(timer);
      clearTimeout(deadline);
      for (const handle of handles) {
        try {
          if (handle && typeof handle.remove === 'function') Promise.resolve(handle.remove()).catch(() => {});
        } catch {
          /* best effort */
        }
      }
    };
    const fail = (message) => {
      if (settled) return;
      stop();
      reject(new Error(message));
    };
    const deadline = setTimeout(() => fail('本地邮件服务启动超时，请完全关闭应用后重新打开'), CORE_TIMEOUT_MS);

    (async () => {
      handles.push(
        await NodeJS.addListener('core-ready', (event) => {
          const info = event && Array.isArray(event.args) ? event.args[0] : null;
          if (settled || !info || !info.port || !info.token) return;
          stop();
          resolve({ url: `http://127.0.0.1:${info.port}`, token: info.token });
        })
      );
      handles.push(
        await NodeJS.addListener('core-failed', (event) => {
          fail(`本地邮件服务启动失败：${(event && event.args && event.args[0]) || '未知错误'}`);
        })
      );
      await NodeJS.whenReady();
      const ask = () => {
        if (settled) return;
        Promise.resolve(NodeJS.send({ eventName: 'get-core', args: [] })).catch(() => {
          /* the Node side is not listening yet; the next tick asks again */
        });
      };
      ask();
      timer = setInterval(ask, ASK_EVERY_MS);
    })().catch((err) => fail(`无法连接本地邮件服务：${err && err.message ? err.message : err}`));
  });
}

export async function getApi() {
  const params = new URLSearchParams(location.search);
  const forceDemo = params.get('demo') === '1';
  const injected = window.__DYMAIL_CORE__ || {};
  let url = params.get('core') || injected.url;
  let token = params.get('token') || injected.token;

  if (!forceDemo && !(url && token)) {
    const glue = await loadNativeGlue();
    if (isNative(glue)) ({ url, token } = await connectNativeCore(glue.NodeJS));
  }

  if (url && token && !forceDemo) {
    setCore({ url, token });
    const { createNativeApi } = await import('./native.js');
    return { api: createNativeApi({ url, token }), demo: false };
  }

  if (!window.dymail) {
    window.dymail = {
      app: { info: async () => ({ version: '0.1.0', platform: 'android', packaged: false }) }
    };
  }
  const { createDemoApi } = await import('./shared/demo.js');
  return { api: createDemoApi(), demo: true };
}
