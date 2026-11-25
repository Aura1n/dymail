(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const d = window.__dymailDemo;
  const out = {};
  const rec = (key, value) => {
    out[key] = value;
  };

  for (let i = 0; i < 40 && !el('update-dialog').open; i += 1) await wait(200);

  if (!el('update-dialog').open) {
    d.openSettings('update');
    await wait(300);
    el('update-check-now').click();
    for (let i = 0; i < 40 && !el('update-dialog').open; i += 1) await wait(200);
  }

  rec('offer', {
    open: el('update-dialog').open,
    from: el('update-from').textContent,
    to: el('update-to').textContent,
    button: el('update-download').textContent,
    progressHidden: el('update-progress').hidden
  });

  el('update-download').click();
  for (let i = 0; i < 60 && !/完成/.test(el('update-progress-text').textContent); i += 1) await wait(200);

  rec('afterDownload', {
    text: el('update-progress-text').textContent,
    fill: el('update-progress-fill').style.width,
    button: el('update-download').textContent,
    ignoreHidden: el('update-ignore').hidden,
    cancelHidden: el('update-cancel').hidden
  });

  return JSON.stringify(out);
})()
