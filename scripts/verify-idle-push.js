(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const d = window.__dymailDemo;
  const calls = () => window.dymailDemoCalls;
  const out = [];
  const rec = (key, value) =>
    out.push(`${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);

  if (el('update-dialog').open) {
    el('update-later').click();
    await wait(300);
  }

  const before = {
    view: d.state.view.kind,
    accounts: d.state.accounts.length,
    messages: d.state.messages.length,
    errors: d.state.listErrors.length,
    syncOne: calls().syncOne.length
  };
  rec('before', before);

  /* two pushes for the same account inside the debounce window must coalesce */
  d.pushMail('acc-work');
  d.pushMail('acc-work');
  await wait(1600);
  rec('afterDoublePush', {
    syncOne: calls().syncOne.slice(),
    messages: d.state.messages.length,
    errors: d.state.listErrors.length
  });

  /* a second account must get its own refresh */
  d.pushMail('acc-gmail');
  await wait(1400);
  rec('afterSecondAccount', {
    syncOne: calls().syncOne.slice(),
    messages: d.state.messages.length,
    errors: d.state.listErrors.length
  });

  /* three pushes across two accounts arriving at once -> one sync per account */
  const mark = calls().syncOne.length;
  d.pushMail('acc-work');
  d.pushMail('acc-qq');
  d.pushMail('acc-work');
  await wait(1600);
  rec('afterBurst', { added: calls().syncOne.length - mark, syncOne: calls().syncOne.slice(mark) });

  /* unknown account must not crash the renderer */
  d.pushMail('acc-missing');
  await wait(1200);
  rec('afterUnknown', {
    messages: d.state.messages.length,
    errors: d.state.listErrors.length,
    accounts: d.state.accounts.length,
    statusText: d.state.accounts.every((account) => !account.id || typeof account.id === 'string')
  });

  rec('viewUnchanged', d.state.view.kind === before.view);
  rec('accountsUnchanged', d.state.accounts.length === before.accounts);
  return out.join('\n');
})()
