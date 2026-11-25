'use strict';
/* Runs in Electron: scheduled drafts, rules, blacklist and filter bookkeeping
   survive a store reopen instead of only living in renderer memory. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const userData = path.join(os.tmpdir(), 'dymail-tests', 'store-features');
fs.rmSync(userData, { recursive: true, force: true });
app.setPath('userData', userData);

app.whenReady().then(async () => {
  try {
    const { Store } = require('../../src/main/store');
    const store = new Store();
    const account = store.saveAccount(
      {
        email: 'tester@example.com',
        name: 'Tester',
        imap: { host: 'imap.example.com', port: 993, secure: true },
        smtp: { host: 'smtp.example.com', port: 465, secure: true }
      },
      'secret'
    );

    const baseDraft = {
      accountId: account.id,
      kind: 'new',
      to: 'a@example.com',
      cc: '',
      bcc: '',
      subject: 'future mail',
      html: '<p>later</p>',
      inReplyTo: '',
      references: '',
      attachments: []
    };
    const future = new Date(Date.now() + 3600000).toISOString();
    const scheduled = await store.saveDraft({ ...baseDraft, sendAt: future });
    assert.equal(scheduled.sendAt, future);
    assert.equal(store.draftCount(account.id), 0);
    assert.equal((await store.listDrafts(account.id)).length, 0);
    const scheduledList = await store.listScheduled(account.id);
    assert.equal(scheduledList.length, 1);
    assert.equal(scheduledList[0].subject, 'future mail');
    assert.equal((await store.getDraft(scheduled.id)).sendAt, future);

    await store.markScheduledError(scheduled.id, 'SMTP down', Date.now() + 60000);
    const withError = await store.getDraft(scheduled.id);
    assert.equal(withError.attempts, 1);
    assert.match(withError.lastError, /SMTP down/);

    await store.clearSchedule(scheduled.id);
    assert.equal(store.draftCount(account.id), 1);
    assert.equal((await store.listScheduled(account.id)).length, 0);
    assert.equal((await store.listDrafts(account.id)).length, 1);

    const rule = store.saveRule({
      name: 'GitHub archive',
      field: 'from',
      value: 'github.com',
      action: 'archive',
      enabled: true
    });
    assert.ok(rule.id);
    assert.ok(rule.since > 0);
    assert.equal(store.listRules().length, 1);

    store.addBlacklist('spam@example.com');
    assert.throws(() => store.addBlacklist('spam@example.com'), /黑名单/);
    assert.equal(store.listBlacklist()[0].email, 'spam@example.com');

    store.markFilterApplied(['acc\u0000INBOX\u00001', 'acc\u0000INBOX\u00002']);
    assert.equal(store.isFilterApplied('acc\u0000INBOX\u00001'), true);

    const reopened = new Store();
    assert.equal(reopened.listRules().length, 1);
    assert.equal(reopened.listBlacklist().length, 1);
    assert.equal(reopened.isFilterApplied('acc\u0000INBOX\u00002'), true);
    assert.equal((await reopened.listDrafts(account.id)).length, 1);

    console.log('store scheduled/rules persistence OK');
    app.exit(0);
  } catch (err) {
    console.error('FAILED:', err);
    app.exit(1);
  }
});
