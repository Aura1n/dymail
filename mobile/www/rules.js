import { h, ic, iconBtn, openPage, openSheet, closeTop, actionSheet, confirmSheet, toast } from './ui.js';
import { S } from './state.js';

const FIELDS = [['from', '发件人'], ['subject', '主题'], ['to', '收件人']];
const ACTIONS = [['read', '标为已读'], ['star', '加星标'], ['archive', '归档'], ['trash', '移到已删除']];
const fieldLabel = (v) => (FIELDS.find(([k]) => k === v) || [, v])[1];
const actionLabel = (v) => (ACTIONS.find(([k]) => k === v) || [, v])[1];

function switchEl(on, onChange) {
  let value = Boolean(on);
  const el = h('button', { class: `switch${value ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(value) });
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    value = !value;
    el.classList.toggle('on', value);
    el.setAttribute('aria-checked', String(value));
    onChange(value);
  });
  return el;
}

function pickRow(options, current, onPick) {
  const wrap = h('div', { class: 'chiprow' });
  const draw = (value) => {
    wrap.replaceChildren(
      ...options.map(([val, label]) =>
        h('button', { type: 'button', class: `pillchip${val === value ? ' on' : ''}`, onClick: () => { draw(val); onPick(val); } }, label)
      )
    );
  };
  draw(current);
  return wrap;
}

function openRuleForm(rule, done) {
  const st = { field: rule ? rule.field : 'from', action: rule ? rule.action : 'read', enabled: rule ? rule.enabled !== false : true };
  openSheet((sheet) => {
    const name = h('input', { class: 'input', type: 'text', placeholder: '可选，不填则自动命名' });
    const value = h('input', { class: 'input', type: 'text', autocapitalize: 'off', spellcheck: 'false', placeholder: '例如 newsletter@example.com' });
    name.value = rule ? rule.name || '' : '';
    value.value = rule ? rule.value : '';
    const error = h('div', { class: 'error', style: 'margin:0 12px 8px' });
    const save = h('button', { class: 'btn primary', type: 'button' }, rule ? '保存修改' : '保存规则');

    save.addEventListener('click', async () => {
      error.textContent = '';
      if (!value.value.trim()) {
        error.textContent = '请填写匹配内容';
        return;
      }
      save.disabled = true;
      try {
        await S.api.rules.save({
          id: rule ? rule.id : '',
          name: name.value.trim() || undefined,
          field: st.field,
          value: value.value.trim(),
          action: st.action,
          enabled: st.enabled
        });
        await closeTop();
        toast('规则已保存');
        done();
      } catch (err) {
        error.textContent = err && err.message ? err.message : '保存失败';
        save.disabled = false;
      }
    });

    sheet.append(
      h('h3', null, rule ? '编辑规则' : '新建规则'),
      h('p', null, '新规则只处理保存之后收到的邮件。'),
      h('div', { class: 'formrow' }, h('label', null, '名称'), name),
      h('div', { class: 'formrow' }, h('label', null, '当邮件的…'), pickRow(FIELDS, st.field, (v) => { st.field = v; })),
      h('div', { class: 'formrow' }, h('label', null, '包含'), value),
      h('div', { class: 'formrow' }, h('label', null, '就…'), pickRow(ACTIONS, st.action, (v) => { st.action = v; })),
      error,
      h(
        'div',
        { class: 'btnrow' },
        rule
          ? h(
              'button',
              {
                class: 'btn danger',
                type: 'button',
                onClick: async () => {
                  try {
                    await S.api.rules.remove(rule.id);
                    await closeTop();
                    toast('规则已删除');
                    done();
                  } catch (err) {
                    toast(err && err.message ? err.message : '删除失败');
                  }
                }
              },
              '删除'
            )
          : null,
        save
      )
    );
  });
}

export function openRules() {
  openPage((page) => {
    let data = { rules: [], blacklist: [] };
    const rulesCard = h('div', { class: 'card' });
    const blackCard = h('div', { class: 'card' });
    const emailInput = h('input', { class: 'input', type: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: 'name@example.com' });
    const addBtn = h('button', { class: 'btn primary', type: 'button' }, '屏蔽');

    const load = async () => {
      try {
        const res = await S.api.rules.list();
        data = { rules: (res && res.rules) || [], blacklist: (res && res.blacklist) || [] };
      } catch (err) {
        toast(err && err.message ? err.message : '读取规则失败');
      }
      draw();
    };

    function draw() {
      rulesCard.replaceChildren(
        ...(data.rules.length
          ? data.rules.map((rule) =>
              h(
                'div',
                { class: 'cell press', role: 'button', tabindex: '0', onClick: () => openRuleForm(rule, load) },
                h('div', { class: 'cellmain' }, h('div', { class: 't' }, rule.name), h('div', { class: 's' }, `${fieldLabel(rule.field)}包含「${rule.value}」→ ${actionLabel(rule.action)}`)),
                switchEl(rule.enabled !== false, async (on) => {
                  try {
                    await S.api.rules.save({ ...rule, enabled: on });
                    rule.enabled = on;
                  } catch (err) {
                    toast(err && err.message ? err.message : '保存失败');
                    load();
                  }
                })
              )
            )
          : [h('div', { class: 'cell empty-note' }, '还没有规则')]),
        h('button', { class: 'cell press', type: 'button', onClick: () => openRuleForm(null, load) }, ic('plus', 20), h('span', { class: 'grow' }, '新建规则'))
      );

      blackCard.replaceChildren(
        ...(data.blacklist.length
          ? data.blacklist.map((entry) =>
              h(
                'div',
                { class: 'cell' },
                h('span', { class: 'grow' }, entry.email),
                h(
                  'button',
                  {
                    class: 'iconbtn',
                    type: 'button',
                    'aria-label': '移出黑名单',
                    onClick: async () => {
                      try {
                        await S.api.rules.removeBlacklist(entry.email);
                        load();
                      } catch (err) {
                        toast(err && err.message ? err.message : '操作失败');
                      }
                    }
                  },
                  ic('close', 18)
                )
              )
            )
          : [h('div', { class: 'cell empty-note' }, '黑名单是空的')]),
        h('div', { class: 'inlineadd' }, emailInput, addBtn)
      );
    }

    addBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      if (!email) return;
      addBtn.disabled = true;
      try {
        await S.api.rules.addBlacklist(email);
        emailInput.value = '';
        toast('已加入黑名单');
        await load();
      } catch (err) {
        toast(err && err.message ? err.message : '添加失败');
      }
      addBtn.disabled = false;
    });

    page.append(
      h('header', { class: 'topbar' }, iconBtn('back', '返回', () => closeTop()), h('div', { class: 'title' }, '过滤规则')),
      h(
        'div',
        { class: 'scroll' },
        h(
          'div',
          { class: 'page' },
          h('div', { class: 'section' }, '规则'),
          rulesCard,
          h('div', { class: 'note', style: 'margin-top:8px' }, '规则会在刷新邮件列表时自动应用。'),
          h('div', { class: 'section' }, '黑名单'),
          blackCard,
          h('div', { class: 'note', style: 'margin-top:8px' }, '黑名单里的发件人，新邮件会自动标为已读并移入「已删除」。')
        )
      )
    );
    draw();
    load();
  });
}
