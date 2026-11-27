import { h, toast } from './ui.js';
import { S, UI, saveUi } from './state.js';
import {
  backgroundAvailable,
  backgroundStatus,
  enableBackground,
  disableBackground,
  requestNotifications,
  requestBatteryExemption,
  openNotificationSettings,
  openAppSettings
} from './background.js';

const INTERVALS = [
  [5, '每 5 分钟'],
  [10, '每 10 分钟'],
  [15, '每 15 分钟'],
  [30, '每 30 分钟']
];

function switchRow(label, on, onChange) {
  let value = Boolean(on);
  const sw = h('button', { class: `switch${value ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(value), 'aria-label': label });
  const flip = () => {
    value = !value;
    sw.classList.toggle('on', value);
    sw.setAttribute('aria-checked', String(value));
    onChange(value);
  };
  sw.addEventListener('click', (event) => {
    event.stopPropagation();
    flip();
  });
  return h('div', { class: 'cell press', role: 'button', tabindex: '0', onClick: flip }, h('span', { class: 'grow' }, label), sw);
}

function infoRow(label, sub, bad) {
  return h('div', { class: 'cell' }, h('span', { class: 'grow' }, label), h('span', { class: `sub${bad ? ' err' : ''}` }, sub));
}

function linkRow(label, sub, bad, onClick) {
  return h('button', { class: 'cell press', type: 'button', onClick }, h('span', { class: 'grow' }, label), h('span', { class: `sub${bad ? ' err' : ''}` }, sub));
}

function selectRow(label, options, current, onPick) {
  const select = h('select', null, options.map(([value, text]) => h('option', { value: String(value), selected: String(value) === String(current) }, text)));
  select.addEventListener('change', () => onPick(Number(select.value)));
  return h('label', { class: 'cell' }, h('span', { class: 'grow' }, label), select);
}

/* "后台收信" block of the settings page. Returns null where background mail can't exist (browser, demo). */
export function backgroundSection() {
  if (!backgroundAvailable()) return null;

  let status = null;
  let busy = false;
  const card = h('div', { class: 'card' });
  const note = h('div', { class: 'note', style: 'margin-top:8px' });
  const root = h('div', null, h('div', { class: 'section' }, '后台收信'), card, note);

  const interval = () => Number(UI.bgInterval) || 10;

  async function refresh() {
    status = await backgroundStatus();
    draw();
  }

  async function turnOn() {
    if (busy) return;
    busy = true;
    try {
      let current = await backgroundStatus();
      if (!current || !current.notifications) current = await requestNotifications();
      if (!current || !current.notifications) {
        toast('需要允许通知，才能在后台提醒新邮件');
        await openNotificationSettings().catch(() => {});
        return;
      }
      current = await enableBackground(interval());
      if (!current.batteryExempt) {
        toast('请在接下来的对话框里选择“允许”，否则熄屏后系统可能暂停联网');
        await requestBatteryExemption();
      } else {
        toast('后台收信已开启');
      }
    } catch (err) {
      toast(err && err.message ? err.message : '开启失败');
    } finally {
      busy = false;
      refresh();
    }
  }

  async function turnOff() {
    if (busy) return;
    busy = true;
    try {
      await disableBackground();
      toast('后台收信已关闭');
    } catch (err) {
      toast(err && err.message ? err.message : '关闭失败');
    } finally {
      busy = false;
      refresh();
    }
  }

  async function fixNotifications() {
    try {
      const current = await requestNotifications();
      if (!current || !current.notifications) await openNotificationSettings();
    } catch (err) {
      toast(err && err.message ? err.message : '无法打开设置');
    }
    refresh();
  }

  async function changeInterval(minutes) {
    UI.bgInterval = minutes;
    saveUi();
    try {
      await enableBackground(minutes); // restarts the service with the new interval
      toast(`兜底检查间隔已改为 ${minutes} 分钟`);
    } catch (err) {
      toast(err && err.message ? err.message : '保存失败');
    }
    refresh();
  }

  async function changeNotify(on) {
    try {
      S.settings = { ...S.settings, ...(await S.api.settings.update({ notifyNewMail: on })) };
    } catch (err) {
      toast(err && err.message ? err.message : '保存失败');
    }
    draw();
  }

  function draw() {
    const on = Boolean(status && status.enabled);
    const rows = [switchRow('后台收信与新邮件通知', on, (value) => (value ? turnOn() : turnOff()))];
    if (on && status) {
      rows.push(
        infoRow('运行状态', status.running ? (status.connected ? '运行中' : '正在连接…') : '未运行', !status.running),
        linkRow('通知权限', status.notifications ? '已允许' : '未允许 · 点按设置', !status.notifications, fixNotifications),
        linkRow('电池优化', status.batteryExempt ? '已取消限制' : '受限制 · 点按设置', !status.batteryExempt, async () => {
          try {
            await requestBatteryExemption();
          } catch (err) {
            toast(err && err.message ? err.message : '无法打开设置');
          }
        }),
        selectRow('兜底检查间隔', INTERVALS, interval(), changeInterval),
        switchRow('显示新邮件通知', S.settings.notifyNewMail !== false, changeNotify),
        linkRow('应用设置', '自启动、后台运行等', false, () => openAppSettings().catch(() => toast('无法打开应用设置')))
      );
    }
    card.replaceChildren(...rows);

    if (!on) {
      note.textContent = '开启后，应用会在通知栏常驻一条提示，并在后台保持与邮箱的连接，收到新邮件时提醒你。';
    } else if (status && !status.batteryExempt) {
      note.textContent = '电池优化未取消：熄屏一段时间后，系统可能暂停联网，新邮件要等到亮屏才会收到。';
    } else {
      note.textContent =
        '小米、华为、OPPO、vivo 等系统还需要在「应用设置」里允许自启动和后台运行，并在最近任务里锁定本应用，否则可能被系统清理。被清理后需要打开一次应用才能恢复。';
    }
  }

  /* Coming back from a system dialog (battery, notification settings) the page becomes visible again. */
  const onVisible = () => {
    if (!root.isConnected) {
      document.removeEventListener('visibilitychange', onVisible);
      return;
    }
    if (!document.hidden) refresh();
  };
  document.addEventListener('visibilitychange', onVisible);

  draw();
  refresh();
  return root;
}
