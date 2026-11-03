(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const d = window.__dymailDemo;
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  const openUpdateTab = async () => {
    d.openSettings();
    await wait(300);
    document.querySelector('.settings-tab[data-tab="update"]').click();
    await wait(200);
  };
  const closeSettings = async () => {
    document.querySelector('[data-close="settings"]').click();
    await wait(200);
  };
  const linkState = () => ({
    hidden: el('update-repo-link').hidden,
    text: el('update-repo-link').textContent,
    url: el('update-repo-link').dataset.url || ''
  });

  if (el('update-dialog').open) {
    el('update-later').click();
    await wait(250);
  }

  rec('inputRemoved', !el('update-repo-input'));

  await openUpdateTab();
  rec('savedRepo', d.state.settings.updateRepo);
  rec('link', linkState());

  const openedBefore = window.dymailDemoCalls.opened.length;
  el('update-repo-link').click();
  await wait(200);
  rec('clickOpens', window.dymailDemoCalls.opened.slice(openedBefore));

  /* the switch still saves on its own */
  el('update-check-input').click();
  await wait(400);
  rec('checkToggleSaved', d.state.settings.updateCheck);
  el('update-check-input').click();
  await wait(400);
  rec('checkToggleRestored', d.state.settings.updateCheck);

  /* an unusable repo value hides the link instead of building a broken URL */
  await closeSettings();
  d.state.settings.updateRepo = '';
  await openUpdateTab();
  rec('emptyRepoHidesLink', linkState());
  d.state.settings.updateRepo = 'not-a-repo';
  await closeSettings();
  await openUpdateTab();
  rec('badRepoHidesLink', linkState());
  d.state.settings.updateRepo = 'Aura1n/dymail';
  await closeSettings();
  await openUpdateTab();
  rec('linkBack', linkState());

  const scroll = document.querySelector('.settings-panel[data-panel="update"] .settings-scroll');
  rec('updatePaneFit', { scrollH: scroll.scrollHeight, clientH: scroll.clientHeight, fits: scroll.scrollHeight <= scroll.clientHeight });

  await closeSettings();

  return out.join('\n');
})()
