/* In-app update check (Android).
 *
 * The desktop client checks GitHub Releases on every start and every 6 hours and offers to install
 * the new .exe itself. A phone can't silently install an APK, so this does the detection half only:
 * it finds a newer .apk (see core/update.js), tells the user, and opens the download link in the
 * system browser — Android then asks for the install confirmation. Same settings as the desktop:
 * updateCheck (on/off), updateRepo, updateSkipped, updateLastCheck. */

import { h, openSheet, closeTop, layerCount, toast, fmtSize } from './ui.js';
import { S } from './state.js';

const RECHECK_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 30 * 60 * 1000;

let busy = false;
let ticking = false;
let sheetOpen = false;
let pending = null;

export async function checkForUpdate({ silent = false } = {}) {
  if (busy) return null;
  busy = true;
  try {
    const result = await S.api.update.check();
    try {
      S.settings = { ...S.settings, ...(await S.api.settings.update({ updateLastCheck: result.checkedAt })) };
    } catch {
      /* not being able to record the time only means we may check again a bit sooner */
    }
    const skipped = result.latest === S.settings.updateSkipped;
    if (result.hasUpdate && !(silent && skipped)) {
      if (silent && layerCount() > 0) pending = result; // don't interrupt someone who is writing a mail
      else showUpdateSheet(result);
    }
    return result;
  } catch (err) {
    if (!silent) throw err;
    console.warn('[update]', err && err.message ? err.message : err);
    return null;
  } finally {
    busy = false;
  }
}

/* Called from the app's timer: shows an update that was held back while a page or dialog was open. */
export function flushPendingUpdate() {
  if (pending && layerCount() === 0 && !sheetOpen) {
    const result = pending;
    pending = null;
    showUpdateSheet(result);
  }
}

export function showUpdateSheet(result) {
  if (sheetOpen) return;
  sheetOpen = true;
  openSheet(
    (sheet) => {
      const size = result.assetSize ? ` · 安装包 ${fmtSize(result.assetSize)}` : '';
      const notes = String(result.notes || '').trim();
      sheet.append(
        h('h3', null, `发现新版本 ${result.latest}`),
        h('p', null, `当前版本 ${result.current}${size}`),
        notes ? h('div', { class: 'notes' }, notes) : null,
        result.sha256 ? h('p', { class: 'hash' }, `SHA-256  ${result.sha256.slice(0, 16)}…`) : null,
        h(
          'div',
          { class: 'btnrow' },
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              onClick: async () => {
                try {
                  await S.api.app.open(result.url);
                  toast('已在浏览器中打开，下载完成后点击安装包升级');
                } catch (err) {
                  toast(err && err.message ? err.message : '无法打开下载链接');
                }
                closeTop();
              }
            },
            '下载更新'
          )
        ),
        h(
          'div',
          { class: 'btnrow' },
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onClick: async () => {
                try {
                  S.settings = { ...S.settings, ...(await S.api.settings.update({ updateSkipped: result.latest })) };
                  toast(`已跳过 ${result.latest}`);
                } catch (err) {
                  toast(err && err.message ? err.message : '保存失败');
                }
                closeTop();
              }
            },
            '跳过此版本'
          ),
          h('button', { class: 'btn', type: 'button', onClick: () => closeTop() }, '稍后')
        )
      );
    },
    { onClose: () => { sheetOpen = false; } }
  );
}

/* Starts the background checks: shortly after launch, then whenever 6 hours have passed since the last
   successful check — the saved updateLastCheck is shared with the desktop's setting, so quick restarts
   don't hammer GitHub's unauthenticated rate limit. Off in the demo preview. */
export function scheduleUpdateCheck() {
  if (ticking || S.demo) return;
  ticking = true;
  const tick = () => {
    if (S.settings.updateCheck === false || !S.settings.updateRepo || document.hidden) return;
    if (Date.now() - (Number(S.settings.updateLastCheck) || 0) < RECHECK_MS) return;
    checkForUpdate({ silent: true });
  };
  setTimeout(tick, 4000);
  setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
}
