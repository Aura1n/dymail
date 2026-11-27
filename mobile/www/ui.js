/* Small DOM + navigation helpers. Every overlay (drawer, sheet, page) is a "layer" tied to a
   history entry, so the Android back button always closes the top-most one first. */

import { icon } from './icons.js';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const ic = icon;

export function iconBtn(name, label, onClick, extra = '') {
  return h('button', { class: `iconbtn ${extra}`, type: 'button', 'aria-label': label, title: label, onClick }, icon(name));
}

const layers = [];
const waiting = [];
let root = null;

export function initLayers(appRoot) {
  root = appRoot;
  history.replaceState({ depth: 0 }, '');
  window.addEventListener('popstate', () => {
    const layer = layers.pop();
    if (layer) dismiss(layer);
    const resolve = waiting.shift();
    if (resolve) resolve();
  });
}

function dismiss(layer) {
  for (const el of layer.els) el.classList.remove('in');
  setTimeout(() => layer.els.forEach((el) => el.remove()), 280);
  if (layer.onClose) layer.onClose();
}

/* els: elements appended to the root that animate in together. */
export function openLayer(els, onClose) {
  const list = Array.isArray(els) ? els : [els];
  list.forEach((el) => root.append(el));
  const layer = { els: list, onClose };
  layers.push(layer);
  history.pushState({ depth: layers.length }, '');
  requestAnimationFrame(() => requestAnimationFrame(() => list.forEach((el) => el.classList.add('in'))));
  return layer;
}

export function closeTop() {
  return new Promise((resolve) => {
    if (!layers.length) return resolve();
    waiting.push(resolve);
    history.back();
  });
}

export function layerCount() {
  return layers.length;
}

/* Full-height page that slides in from the right. */
export function openPage(build, { rise = false, onClose } = {}) {
  const page = h('section', { class: `screen layer${rise ? ' rise' : ''}` });
  build(page);
  openLayer(page, onClose);
  return page;
}

export function openSheet(build, { onClose } = {}) {
  const scrim = h('div', { class: 'scrim top', onClick: () => closeTop() });
  const sheet = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grab' }));
  build(sheet);
  openLayer([scrim, sheet], onClose);
  return sheet;
}

export function actionSheet(title, items) {
  return openSheet((sheet) => {
    if (title) sheet.append(h('h3', null, title));
    for (const item of items) {
      if (!item) continue;
      sheet.append(
        h(
          'button',
          {
            class: `sheetitem${item.danger ? ' danger' : ''}`,
            type: 'button',
            onClick: async () => {
              await closeTop();
              item.run();
            }
          },
          item.icon ? icon(item.icon, 20) : null,
          h('span', null, item.label),
          item.sub ? h('span', { class: 'sub' }, item.sub) : null
        )
      );
    }
  });
}

export function confirmSheet({ title, message, ok = '确定', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openSheet(
      (sheet) => {
        sheet.append(
          h('h3', null, title),
          message ? h('p', null, message) : null,
          h(
            'div',
            { class: 'btnrow' },
            h('button', { class: 'btn', type: 'button', onClick: () => closeTop() }, '取消'),
            h(
              'button',
              {
                class: `btn ${danger ? 'danger' : 'primary'}`,
                type: 'button',
                onClick: async () => {
                  finish(true);
                  await closeTop();
                }
              },
              ok
            )
          )
        );
      },
      { onClose: () => finish(false) }
    );
  });
}

let toastTimer = 0;
export function toast(message) {
  let el = root.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    root.append(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('in'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('in'), 2400);
}

export function fmtTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (date.toDateString() === now.toDateString()) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function fmtFull(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* "今天 18:00" / "明天 09:00" / "12月1日 09:00" — for a time that is still ahead. */
export function fmtSchedule(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  if (date.toDateString() === now.toDateString()) return `今天 ${clock}`;
  if (date.toDateString() === tomorrow.toDateString()) return `明天 ${clock}`;
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

export function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function person(addr) {
  if (!addr) return { name: '', address: '', label: '' };
  const name = String(addr.name || '').trim();
  const address = String(addr.address || '').trim();
  return { name, address, label: name || address };
}
