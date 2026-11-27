import { h, ic, iconBtn, openPage, openSheet, closeTop, actionSheet, confirmSheet, toast } from './ui.js';
import { S, loadContacts } from './state.js';
import { openCompose } from './compose.js';

function openContactForm(contact, done) {
  openSheet((sheet) => {
    const name = h('input', { class: 'input', type: 'text', placeholder: '姓名（可选）' });
    const email = h('input', { class: 'input', type: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', placeholder: 'name@example.com' });
    name.value = contact && contact.name !== contact.email ? contact.name || '' : '';
    email.value = contact ? contact.email : '';
    const error = h('div', { class: 'error', style: 'margin:0 12px 8px' });
    const save = h('button', { class: 'btn primary', type: 'button' }, contact ? '保存' : '添加');

    save.addEventListener('click', async () => {
      error.textContent = '';
      if (!email.value.trim()) {
        error.textContent = '请填写邮箱地址';
        return;
      }
      save.disabled = true;
      try {
        await S.api.contacts.save({ name: name.value.trim(), email: email.value.trim(), originalEmail: contact ? contact.email : '' });
        await closeTop();
        toast(contact ? '联系人已保存' : '已添加联系人');
        done();
      } catch (err) {
        error.textContent = err && err.message ? err.message : '保存失败';
        save.disabled = false;
      }
    });

    sheet.append(
      h('h3', null, contact ? '编辑联系人' : '添加联系人'),
      h('div', { class: 'formrow' }, h('label', null, '姓名'), name),
      h('div', { class: 'formrow' }, h('label', null, '邮箱'), email),
      error,
      h('div', { class: 'btnrow' }, save)
    );
  });
}

export function openContacts() {
  openPage((page) => {
    let query = '';
    const card = h('div', { class: 'card' });

    const reload = async () => {
      await loadContacts(true);
      draw();
    };

    function draw() {
      const q = query.trim().toLowerCase();
      const list = (S.contacts || []).filter((c) => !q || c.email.toLowerCase().includes(q) || String(c.name || '').toLowerCase().includes(q));
      card.replaceChildren(
        ...(list.length
          ? list.map((c) =>
              h(
                'button',
                {
                  class: 'cell press',
                  type: 'button',
                  onClick: () =>
                    actionSheet(c.name || c.email, [
                      { label: '写邮件', icon: 'compose', run: () => openCompose({ kind: 'new', to: c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email }) },
                      { label: '编辑', icon: 'file', run: () => openContactForm(c, reload) },
                      {
                        label: '删除',
                        icon: 'trash',
                        danger: true,
                        run: async () => {
                          const yes = await confirmSheet({ title: `删除 ${c.name || c.email}？`, ok: '删除', danger: true });
                          if (!yes) return;
                          try {
                            await S.api.contacts.remove({ email: c.email });
                            toast('已删除');
                            reload();
                          } catch (err) {
                            toast(err && err.message ? err.message : '删除失败');
                          }
                        }
                      }
                    ])
                },
                h('div', { class: 'avatar' }, (c.name || c.email || '?').slice(0, 1).toUpperCase()),
                h('div', { class: 'cellmain' }, h('div', { class: 't' }, c.name || c.email), c.name && c.name !== c.email ? h('div', { class: 's' }, c.email) : null)
              )
            )
          : [h('div', { class: 'cell empty-note' }, q ? `没有找到「${query}」` : '还没有联系人')])
      );
    }

    const search = h('input', { type: 'search', placeholder: '搜索联系人', autocomplete: 'off', autocapitalize: 'off' });
    search.addEventListener('input', () => { query = search.value; draw(); });

    page.append(
      h(
        'header',
        { class: 'topbar' },
        iconBtn('back', '返回', () => closeTop()),
        h('div', { class: 'title' }, '联系人'),
        iconBtn('plus', '添加联系人', () => openContactForm(null, reload))
      ),
      h(
        'div',
        { class: 'scroll' },
        h('div', { class: 'pagesearch' }, h('div', { class: 'pill' }, ic('search', 18), search)),
        h('div', { class: 'page' }, card)
      )
    );
    draw();
    reload();
  });
}
