(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const d = window.__dymailDemo;
  const calls = () => window.dymailDemoCalls;
  const out = {};
  const rec = (key, value) => {
    out[key] = value;
  };

  if (el('update-dialog').open) {
    el('update-later').click();
    await wait(220);
  }

  document.querySelector('[data-nav="contacts"]').click();
  await wait(350);

  rec('view', {
    contactsHidden: el('contacts-view').hidden,
    dialogGone: !el('contacts-dialog'),
    mailHidden: document.querySelector('.list-pane').offsetParent === null,
    workspaceMode: Boolean(document.querySelector('.workspace.is-contacts'))
  });
  rec('count', el('contacts-view-count').textContent);
  rec('rows', document.querySelectorAll('#contacts-view-list [data-contact]').length);

  document.querySelector('#contacts-view-list [data-contact="wangting@northwind.cn"]').click();
  await wait(200);
  rec('selected', {
    name: document.querySelector('.contact-detail-name').textContent,
    active: Boolean(el('contacts-view-list').querySelector('.contact-row.is-active')),
    compose: Boolean(document.querySelector('[data-contact-action="compose"]')),
    copy: Boolean(document.querySelector('[data-contact-action="copy"]'))
  });

  document.querySelector('[data-contact-action="copy"]').click();
  await wait(200);
  rec('copy', calls().copied.slice(-1)[0]);

  document.querySelector('[data-contact-action="edit"]').click();
  await wait(120);
  rec('editForm', {
    form: Boolean(el('contact-form')),
    name: el('contact-name').value,
    deleteVisible: Boolean(document.querySelector('[data-contact-action="delete"]')),
    submit: el('contact-submit').textContent
  });

  el('contact-name').value = '王婷（测试）';
  el('contact-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await wait(320);
  rec('saved', {
    name: document.querySelector('.contact-detail-name').textContent,
    stored: calls().contacts.find((item) => item.email === 'wangting@northwind.cn').name,
    formGone: !el('contact-form')
  });

  el('contact-new').click();
  await wait(120);
  rec('newForm', {
    form: Boolean(el('contact-form')),
    deleteHidden: !document.querySelector('[data-contact-action="delete"]'),
    submit: el('contact-submit').textContent
  });
  document.querySelector('[data-contact-action="cancel"]').click();
  await wait(120);
  rec('afterCancel', { formGone: !el('contact-form') });

  el('toast').hidden = true;

  document.querySelector('[data-nav="unified"]').click();
  await wait(400);
  rec('backToMail', {
    contactsHidden: el('contacts-view').hidden,
    listVisible: document.querySelector('.list-pane').offsetParent !== null,
    placeholder: el('search-input').placeholder
  });

  document.querySelector('[data-nav="contacts"]').click();
  await wait(320);
  document.querySelector('#contacts-view-list [data-contact="wangting@northwind.cn"]').click();
  await wait(200);
  rec('finalView', {
    formGone: !el('contact-form'),
    name: document.querySelector('.contact-detail-name').textContent,
    compose: Boolean(document.querySelector('[data-contact-action="compose"]')),
    copy: Boolean(document.querySelector('[data-contact-action="copy"]'))
  });

  document.documentElement.dataset.theme = 'light';
  await wait(260);
  rec('light', { theme: document.documentElement.dataset.theme });

  return JSON.stringify(out, null, 1);
})()
